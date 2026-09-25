/**
 * Mirrors `vault::layout::validate_name` in Rust so the form can explain the
 * problem. Rust re-validates; this is only for messages.
 */
const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;
const ALLOWED = /^[\p{L}\p{N} ._()-]+$/u;

export function vaultNameError(name: string): string | null {
  if (name.length === 0) return "Enter a name for your vault.";
  if (Array.from(name).length > 64) return "Use 64 characters or fewer.";
  if (name.trim() !== name) return "Remove the spaces at the start or end.";
  if (name.startsWith(".") || name.endsWith(".")) return "The name can't start or end with a dot.";
  if (!ALLOWED.test(name)) return "Use only letters, numbers, spaces and - _ . ( )";
  if (RESERVED.test(name.split(".")[0] ?? name)) return "Windows reserves this name. Choose another.";
  return null;
}
