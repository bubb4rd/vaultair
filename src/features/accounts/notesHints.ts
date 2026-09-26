import type { NotesSuggestions } from "@/ipc/client";

/*
 * The form's live copy of `domain::notes_hints::scan` in Rust (ADR-0006), so
 * a hint can show while sensitive notes are being typed. Rust's result, set
 * when the notes are saved, is what the account page shows. Keep the lists
 * in step with notes_hints.rs; `notesHints.test.ts` checks the same cases.
 */

const IDENTIFIER_LABELS = [
  "username",
  "user name",
  "user id",
  "userid",
  "user",
  "login",
  "email",
  "e-mail",
  "gamertag",
  "player id",
  "account id",
  "account name",
];
const CREDENTIAL_LABELS = ["password", "passwd", "pwd", "pw", "pass", "pin", "passcode"];
const CODE_PHRASES = ["backup code", "recovery code", "2fa code", "scratch code", "verification code"];
const SECURITY_PHRASES = ["security question", "security answer", "secret question", "secret answer", "maiden name"];

const isWord = (c: string | undefined) => c !== undefined && /[\p{L}\p{N}_]/u.test(c);

function hasLabel(lower: string, label: string) {
  for (let i = lower.indexOf(label); i !== -1; i = lower.indexOf(label, i + 1)) {
    const rest = lower.slice(i + label.length).replace(/^[ \t]+/, "");
    if (!isWord(lower[i - 1]) && (rest.startsWith(":") || rest.startsWith("="))) return true;
  }
  return false;
}

function hasEmail(text: string) {
  return text.split(/[\s,;()<>[\]"']+/).some((raw) => {
    const token = raw.replace(/[.:]+$/, "");
    const at = token.indexOf("@");
    if (at <= 0 || token.indexOf("@", at + 1) !== -1) return false;
    const domain = token.slice(at + 1);
    const dot = domain.lastIndexOf(".");
    const tld = domain.slice(dot + 1);
    return dot > 0 && tld.length >= 2 && /^\p{L}+$/u.test(tld);
  });
}

export function scanNotes(text: string): NotesSuggestions {
  const lower = text.toLowerCase();
  return {
    identifiers: hasEmail(text) || IDENTIFIER_LABELS.some((l) => hasLabel(lower, l)),
    credentials: CREDENTIAL_LABELS.some((l) => hasLabel(lower, l)),
    backupCodes: CODE_PHRASES.some((p) => lower.includes(p)),
    securityAnswers: SECURITY_PHRASES.some((p) => lower.includes(p)),
  };
}

export function anySuggestion(s: NotesSuggestions) {
  return s.identifiers || s.credentials || s.backupCodes || s.securityAnswers;
}

/**
 * Where each kind of detail belongs, and what moving it changes for its
 * protection. Identifiers lose the extra field encryption and become visible
 * and searchable, which is why that one says so and can be declined.
 */
export function suggestionLines(s: NotesSuggestions): { key: string; text: string }[] {
  const lines: { key: string; text: string }[] = [];
  if (s.identifiers)
    lines.push({
      key: "identifiers",
      text: "An email address or username: put it in Email, Username or Recovery email. Vaultair can then show which accounts share it and which recover through it. It will show without revealing and be searchable, so keep it here if who uses which address should stay hidden.",
    });
  if (s.credentials)
    lines.push({
      key: "credentials",
      text: "A password or PIN: put it in Password, or a hidden custom field. It stays just as encrypted, gets a strength and reuse check, and can be revealed or copied on its own.",
    });
  if (s.backupCodes)
    lines.push({
      key: "backupCodes",
      text: "Backup codes: add them to the account's MFA method. They stay encrypted, and Vaultair counts how many are left.",
    });
  if (s.securityAnswers)
    lines.push({
      key: "securityAnswers",
      text: "A security question or answer: put it in a hidden custom field. It stays encrypted and can be copied on its own.",
    });
  return lines;
}
