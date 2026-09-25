import type { SecretUpdate } from "@/ipc/client";

/**
 * How a form will change a stored secret. The form never receives stored
 * secrets, so "keep" has to be explicit: an empty field means "no change",
 * not "erase".
 */
export type SecretEdit = { mode: "keep" } | { mode: "set"; value: string } | { mode: "clear" };

export function toUpdate(edit: SecretEdit): SecretUpdate {
  switch (edit.mode) {
    case "keep":
      return { op: "unchanged" };
    case "clear":
      return { op: "clear" };
    case "set":
      return edit.value === "" ? { op: "unchanged" } : { op: "set", value: edit.value };
  }
}

/** Nothing stored yet: start with an empty input. */
export function freshSecret(hasStored: boolean): SecretEdit {
  return hasStored ? { mode: "keep" } : { mode: "set", value: "" };
}
