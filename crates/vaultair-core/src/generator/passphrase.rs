//! Memorable passphrases from the EFF large wordlist (7776 words, CC BY 3.0 US,
//! Electronic Frontier Foundation; see the README).

use std::sync::OnceLock;

use serde::Deserialize;
use zeroize::Zeroizing;

use super::random::{self, Uniform};
use super::{rng_err, strength, Generated};
use crate::crypto::CryptoResult;
use crate::AppError;

pub const MIN_WORDS: u8 = 3;
pub const MAX_WORDS: u8 = 12;
pub const DEFAULT_WORDS: u8 = 5;
pub const WORDLIST_LEN: usize = 7776;

/// `<dice roll>\t<word>` per line, as published by the EFF.
const EFF_LARGE_WORDLIST: &str = include_str!("eff_large_wordlist.txt");

fn wordlist() -> &'static [&'static str] {
    static WORDS: OnceLock<Vec<&'static str>> = OnceLock::new();
    WORDS.get_or_init(|| {
        EFF_LARGE_WORDLIST
            .lines()
            .filter_map(|line| line.split_once('\t').map(|(_, word)| word.trim()))
            .collect()
    })
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct PassphraseOptions {
    /// 3–12 words.
    pub words: u8,
    /// One ASCII punctuation character or a space. Letters and digits would
    /// blur the word boundaries.
    pub separator: String,
    /// Capitalizes the first letter of every word.
    pub capitalize: bool,
    /// Appends one random digit to one randomly chosen word.
    pub include_number: bool,
}

impl Default for PassphraseOptions {
    fn default() -> Self {
        Self {
            words: DEFAULT_WORDS,
            separator: "-".into(),
            capitalize: false,
            include_number: false,
        }
    }
}

impl PassphraseOptions {
    fn separator(&self) -> Result<char, AppError> {
        let mut chars = self.separator.chars();
        match (chars.next(), chars.next()) {
            (Some(c), None) if c == ' ' || c.is_ascii_punctuation() => Ok(c),
            _ => Err(AppError::InvalidInput { field: "separator" }),
        }
    }
}

pub fn generate_passphrase(options: &PassphraseOptions) -> Result<Generated, AppError> {
    if !(MIN_WORDS..=MAX_WORDS).contains(&options.words) {
        return Err(AppError::InvalidInput { field: "words" });
    }
    let separator = options.separator()?;
    let value = compose(options, separator, &mut random::os()).map_err(rng_err)?;
    let words = usize::from(options.words);
    Ok(Generated {
        entropy_bits: strength::passphrase_entropy_bits(
            words,
            WORDLIST_LEN,
            options.include_number,
        ),
        score: strength::score(&value),
        value: String::clone(&value),
    })
}

fn compose<S: FnMut(&mut [u8]) -> CryptoResult<()>>(
    options: &PassphraseOptions,
    separator: char,
    uniform: &mut Uniform<S>,
) -> CryptoResult<Zeroizing<String>> {
    let list = wordlist();
    let words = u32::from(options.words);
    let number_at = if options.include_number {
        Some((uniform.below(words)?, uniform.below(10)?))
    } else {
        None
    };
    let mut value = Zeroizing::new(String::new());
    for i in 0..words {
        if i > 0 {
            value.push(separator);
        }
        let word = uniform.pick(list)?;
        let mut chars = word.chars();
        if let (true, Some(first)) = (options.capitalize, chars.next()) {
            value.push(first.to_ascii_uppercase());
            value.push_str(chars.as_str());
        } else {
            value.push_str(word);
        }
        if let Some((at, digit)) = number_at {
            if at == i {
                // digit < 10, so this is always Some.
                value.extend(char::from_digit(digit, 10));
            }
        }
    }
    Ok(value)
}

#[cfg(test)]
mod tests {
    use std::collections::HashSet;

    use proptest::prelude::*;

    use super::*;

    #[test]
    fn wordlist_is_the_full_eff_large_list() {
        let list = wordlist();
        assert_eq!(list.len(), WORDLIST_LEN);
        assert_eq!(
            list.iter().collect::<HashSet<_>>().len(),
            WORDLIST_LEN,
            "duplicates"
        );
        assert_eq!(list.first(), Some(&"abacus"));
        assert_eq!(list.last(), Some(&"zoom"));
        assert!(list
            .iter()
            .all(|w| !w.is_empty() && w.chars().all(|c| c.is_ascii_lowercase() || c == '-')));
    }

    fn options() -> impl Strategy<Value = PassphraseOptions> {
        (
            MIN_WORDS..=MAX_WORDS,
            prop::sample::select(vec!["-", " ", ".", "_", ",", "~"]),
            any::<bool>(),
            any::<bool>(),
        )
            .prop_map(
                |(words, sep, capitalize, include_number)| PassphraseOptions {
                    words,
                    separator: sep.into(),
                    capitalize,
                    include_number,
                },
            )
    }

    proptest! {
        #![proptest_config(ProptestConfig::with_cases(256))]

        #[test]
        fn output_always_satisfies_the_options(opts in options()) {
            let g = generate_passphrase(&opts).unwrap();
            let sep = opts.separator.chars().next().unwrap();
            let digits = g.value.chars().filter(char::is_ascii_digit).count();
            prop_assert_eq!(digits, usize::from(opts.include_number));
            // Hyphenated list words ("t-shirt") add tokens when the separator is '-'.
            if sep != '-' {
                let parts: Vec<&str> = g.value.split(sep).collect();
                prop_assert_eq!(parts.len(), usize::from(opts.words));
                let list: HashSet<&str> = wordlist().iter().copied().collect();
                for part in parts {
                    let bare = part.trim_end_matches(|c: char| c.is_ascii_digit()).to_ascii_lowercase();
                    prop_assert!(list.contains(bare.as_str()), "{bare} not in the list");
                    let first = part.chars().next().unwrap();
                    prop_assert_eq!(first.is_ascii_uppercase(), opts.capitalize);
                }
            }
            prop_assert!(g.score <= 4);
        }
    }

    #[test]
    fn rejects_bad_word_counts() {
        for words in [0, 2, 13, 255] {
            let opts = PassphraseOptions {
                words,
                ..PassphraseOptions::default()
            };
            assert_eq!(
                generate_passphrase(&opts),
                Err(AppError::InvalidInput { field: "words" })
            );
        }
    }

    #[test]
    fn rejects_bad_separators() {
        for sep in ["", "--", "a", "7", "é", "\t"] {
            let opts = PassphraseOptions {
                separator: sep.into(),
                ..PassphraseOptions::default()
            };
            assert_eq!(
                generate_passphrase(&opts),
                Err(AppError::InvalidInput { field: "separator" }),
                "{sep:?}"
            );
        }
    }

    #[test]
    fn default_is_five_words() {
        let g = generate_passphrase(&PassphraseOptions::default()).unwrap();
        assert!((g.entropy_bits - 5.0 * 7776f64.log2()).abs() < 1e-9);
        assert!(g.value.split('-').count() >= 5);
    }

    #[test]
    fn number_adds_entropy() {
        let plain = generate_passphrase(&PassphraseOptions::default()).unwrap();
        let numbered = generate_passphrase(&PassphraseOptions {
            include_number: true,
            ..PassphraseOptions::default()
        })
        .unwrap();
        assert!(numbered.entropy_bits > plain.entropy_bits);
    }
}
