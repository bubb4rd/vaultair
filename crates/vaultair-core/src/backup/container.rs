//! The backup container (`*.vaultair-backup`). See `docs/vault-format.md`.
//!
//! ```text
//! "VAIRBKUP" (8) | version u16 LE
//! | created_at: u16 LE length + UTF-8 (RFC 3339 UTC)
//! | vault_id:   u16 LE length + UTF-8
//! | header:     u32 LE length + a complete `vault.vhdr`
//! | database:   u64 LE length + a complete `vault.vdb` (SQLCipher pages)
//! | HMAC-SHA256(BACKUP_KEY, every byte before it) (32)
//! ```
//!
//! Nothing in the file is plaintext vault data: the header holds no user data
//! and the database is the SQLCipher file as it is on disk. The MAC key comes
//! from the DEK, so a backup can only be checked by someone who can unlock it.

use std::fs::File;
use std::io::{self, Read, Write};
use std::path::Path;

use hmac::{Hmac, KeyInit, Mac};
use sha2::Sha256;

use crate::vault::error::VaultError;
use crate::vault::header::VaultHeader;

pub const MAGIC: &[u8; 8] = b"VAIRBKUP";
/// The container version this build writes, and the newest it reads.
pub const VERSION: u16 = 1;
/// File extension, without the dot.
pub const EXTENSION: &str = "vaultair-backup";

const MAC_LEN: usize = 32;
/// Timestamps and vault ids are a few dozen bytes.
const MAX_TEXT_LEN: usize = 64;
/// A vault header is about 1 KB; `header.rs` caps its body at 64 KiB.
const MAX_HEADER_LEN: usize = 128 * 1024;
const CHUNK: usize = 64 * 1024;

type HmacSha256 = Hmac<Sha256>;

fn mac(key: &[u8; 32]) -> HmacSha256 {
    <HmacSha256 as KeyInit>::new_from_slice(key).expect("HMAC accepts keys of any length")
}

fn invalid() -> VaultError {
    VaultError::InvalidBackup
}

/// Everything before the database bytes.
fn prefix(created_at: &str, vault_id: &str, header: &[u8], db_len: u64) -> io::Result<Vec<u8>> {
    let too_long = || io::Error::from(io::ErrorKind::InvalidInput);
    let mut out = Vec::with_capacity(8 + 2 + 2 + 2 + 4 + 8 + header.len() + 2 * MAX_TEXT_LEN);
    out.extend_from_slice(MAGIC);
    out.extend_from_slice(&VERSION.to_le_bytes());
    for text in [created_at, vault_id] {
        if text.len() > MAX_TEXT_LEN {
            return Err(too_long());
        }
        let len = u16::try_from(text.len()).map_err(|_| too_long())?;
        out.extend_from_slice(&len.to_le_bytes());
        out.extend_from_slice(text.as_bytes());
    }
    if header.len() > MAX_HEADER_LEN {
        return Err(too_long());
    }
    let len = u32::try_from(header.len()).map_err(|_| too_long())?;
    out.extend_from_slice(&len.to_le_bytes());
    out.extend_from_slice(header);
    out.extend_from_slice(&db_len.to_le_bytes());
    Ok(out)
}

/// Writes a container to `out` and returns its size. `db` must yield exactly
/// `db_len` bytes.
pub(crate) fn write(
    out: &mut impl Write,
    key: &[u8; 32],
    created_at: &str,
    vault_id: &str,
    header: &[u8],
    db: &mut impl Read,
    db_len: u64,
) -> io::Result<u64> {
    let prefix = prefix(created_at, vault_id, header, db_len)?;
    let mut mac = mac(key);
    mac.update(&prefix);
    out.write_all(&prefix)?;

    let mut buf = vec![0u8; CHUNK];
    let mut left = db_len;
    while left > 0 {
        let want = usize::try_from(left).map_or(CHUNK, |l| l.min(CHUNK));
        let n = db.read(&mut buf[..want])?;
        if n == 0 {
            return Err(io::ErrorKind::UnexpectedEof.into());
        }
        mac.update(&buf[..n]);
        out.write_all(&buf[..n])?;
        left -= n as u64;
    }
    out.write_all(&mac.finalize().into_bytes())?;
    Ok(prefix.len() as u64 + db_len + MAC_LEN as u64)
}

/// A backup file whose layout has been checked, positioned at the database
/// bytes. Nothing in it is trusted until [`Container::extract_db`] has
/// verified the MAC.
#[derive(Debug)]
pub(crate) struct Container {
    file: File,
    /// The bytes before the database, exactly as read (they are MACed again).
    prefix: Vec<u8>,
    header: VaultHeader,
    header_bytes: Vec<u8>,
    pub created_at: String,
    pub vault_id: String,
    pub db_len: u64,
    pub size: u64,
}

/// Reads `n` bytes, treating a short file as "not a backup".
fn take(file: &mut File, prefix: &mut Vec<u8>, n: usize) -> Result<Vec<u8>, VaultError> {
    let mut buf = vec![0u8; n];
    file.read_exact(&mut buf).map_err(|e| match e.kind() {
        io::ErrorKind::UnexpectedEof => invalid(),
        kind => VaultError::Io(kind),
    })?;
    prefix.extend_from_slice(&buf);
    Ok(buf)
}

fn take_text(file: &mut File, prefix: &mut Vec<u8>) -> Result<String, VaultError> {
    let len = take(file, prefix, 2)?;
    let len = usize::from(u16::from_le_bytes([len[0], len[1]]));
    if len > MAX_TEXT_LEN {
        return Err(invalid());
    }
    String::from_utf8(take(file, prefix, len)?).map_err(|_| invalid())
}

impl Container {
    /// Opens `path` and checks its structure: magic, version, lengths that
    /// add up to the file size, and a well-formed vault header.
    pub fn open(path: &Path) -> Result<Self, VaultError> {
        let mut file = File::open(path)?;
        let size = file.metadata()?.len();
        let mut prefix = Vec::new();

        if take(&mut file, &mut prefix, MAGIC.len())? != MAGIC {
            return Err(invalid());
        }
        let version = take(&mut file, &mut prefix, 2)?;
        if u16::from_le_bytes([version[0], version[1]]) > VERSION {
            return Err(VaultError::TooNew);
        }
        let created_at = take_text(&mut file, &mut prefix)?;
        let vault_id = take_text(&mut file, &mut prefix)?;

        let len = take(&mut file, &mut prefix, 4)?;
        let header_len = u32::from_le_bytes([len[0], len[1], len[2], len[3]]) as usize;
        if header_len > MAX_HEADER_LEN {
            return Err(invalid());
        }
        let header_bytes = take(&mut file, &mut prefix, header_len)?;
        let header = VaultHeader::decode(&header_bytes).map_err(|e| match e {
            VaultError::TooNew => VaultError::TooNew,
            _ => invalid(),
        })?;
        if header.vault_id != vault_id {
            return Err(invalid());
        }

        let len = take(&mut file, &mut prefix, 8)?;
        let mut db_len = [0u8; 8];
        db_len.copy_from_slice(&len);
        let db_len = u64::from_le_bytes(db_len);
        let expected = (prefix.len() as u64)
            .checked_add(db_len)
            .and_then(|n| n.checked_add(MAC_LEN as u64));
        if expected != Some(size) || db_len == 0 {
            return Err(invalid());
        }

        Ok(Self {
            file,
            prefix,
            header,
            header_bytes,
            created_at,
            vault_id,
            db_len,
            size,
        })
    }

    pub fn header(&self) -> &VaultHeader {
        &self.header
    }

    /// The `vault.vhdr` bytes inside the backup.
    pub fn header_bytes(&self) -> &[u8] {
        &self.header_bytes
    }

    /// Copies the database bytes to `out` and checks the MAC over the whole
    /// file. On `InvalidBackup` whatever reached `out` must be discarded.
    pub fn extract_db(mut self, key: &[u8; 32], out: &mut impl Write) -> Result<(), VaultError> {
        let mut mac = mac(key);
        mac.update(&self.prefix);

        let mut buf = vec![0u8; CHUNK];
        let mut left = self.db_len;
        while left > 0 {
            let want = usize::try_from(left).map_or(CHUNK, |l| l.min(CHUNK));
            let n = self.file.read(&mut buf[..want])?;
            if n == 0 {
                return Err(invalid());
            }
            mac.update(&buf[..n]);
            out.write_all(&buf[..n])?;
            left -= n as u64;
        }

        let mut tag = [0u8; MAC_LEN];
        self.file.read_exact(&mut tag).map_err(|_| invalid())?;
        // Constant-time comparison.
        mac.verify_slice(&tag).map_err(|_| invalid())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::crypto::aead::{NONCE_LEN, TAG_LEN};
    use crate::crypto::kdf::{KdfParams, KEY_LEN, SALT_LEN};

    const KEY: [u8; 32] = [7; 32];
    const CREATED: &str = "2026-10-05T12:00:00Z";

    fn header() -> VaultHeader {
        let mut h = VaultHeader::new(
            uuid::Uuid::now_v7().to_string(),
            CREATED.into(),
            KdfParams::MINIMUM,
            &[7; SALT_LEN],
            false,
        );
        h.set_wrap(&[1; NONCE_LEN], &[2; KEY_LEN + TAG_LEN]);
        h
    }

    fn sample(db: &[u8]) -> (VaultHeader, Vec<u8>) {
        let h = header();
        let mut out = Vec::new();
        let size = write(
            &mut out,
            &KEY,
            CREATED,
            &h.vault_id,
            &h.encode(),
            &mut &db[..],
            db.len() as u64,
        )
        .unwrap();
        assert_eq!(size, out.len() as u64);
        (h, out)
    }

    fn open(bytes: &[u8]) -> Result<Container, VaultError> {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("b.vaultair-backup");
        std::fs::write(&path, bytes).unwrap();
        Container::open(&path)
    }

    fn extract(bytes: &[u8], key: &[u8; 32]) -> Result<Vec<u8>, VaultError> {
        let mut db = Vec::new();
        open(bytes)?.extract_db(key, &mut db)?;
        Ok(db)
    }

    #[test]
    fn round_trip() {
        let db = vec![0xA5u8; 3 * CHUNK + 17];
        let (h, bytes) = sample(&db);
        let c = open(&bytes).unwrap();
        assert_eq!(c.created_at, CREATED);
        assert_eq!(c.vault_id, h.vault_id);
        assert_eq!(c.header(), &h);
        assert_eq!(c.header_bytes(), h.encode());
        assert_eq!(c.size, bytes.len() as u64);
        assert_eq!(extract(&bytes, &KEY).unwrap(), db);
    }

    #[test]
    fn any_changed_byte_fails() {
        let (_, bytes) = sample(&[3u8; 4096]);
        // One byte in each region: version, created_at, header, database, MAC.
        // (The magic and vault-id cases are in `structural_damage`.)
        let header_at = 8 + 2 + 2 + CREATED.len() + 2 + 36 + 4 + 40;
        for at in [9, 14, header_at, bytes.len() - 2000, bytes.len() - 1] {
            let mut b = bytes.clone();
            b[at] ^= 0x01;
            let result = extract(&b, &KEY);
            assert!(
                matches!(result, Err(VaultError::InvalidBackup | VaultError::TooNew)),
                "byte {at}: {result:?}"
            );
        }
    }

    #[test]
    fn wrong_key_fails() {
        let (_, bytes) = sample(&[3u8; 4096]);
        assert_eq!(extract(&bytes, &[8; 32]), Err(VaultError::InvalidBackup));
    }

    #[test]
    fn structural_damage() {
        let (_, bytes) = sample(&[3u8; 4096]);
        let cases: Vec<(&str, Vec<u8>)> = vec![
            ("empty", vec![]),
            ("garbage", b"not a backup at all".repeat(40)),
            ("bad magic", [b"VAIRBKUX".as_slice(), &bytes[8..]].concat()),
            ("truncated", bytes[..bytes.len() - 1].to_vec()),
            ("cut in the header", bytes[..60].to_vec()),
            ("trailing byte", [bytes.as_slice(), &[0]].concat()),
            ("another vault's id", {
                let mut b = bytes.clone();
                let at = 8 + 2 + 2 + CREATED.len() + 2;
                b[at] = if b[at] == b'0' { b'1' } else { b'0' };
                b
            }),
        ];
        for (name, case) in cases {
            assert_eq!(open(&case).err(), Some(VaultError::InvalidBackup), "{name}");
        }
    }

    #[test]
    fn a_newer_container_is_too_new() {
        let (_, mut bytes) = sample(&[3u8; 64]);
        bytes[8..10].copy_from_slice(&(VERSION + 1).to_le_bytes());
        assert_eq!(open(&bytes).err(), Some(VaultError::TooNew));
    }
}
