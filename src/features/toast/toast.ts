/**
 * App-wide notifications. Call `toast.success(...)`, `toast.error(...)`, etc.
 * from anywhere; the single <Toaster /> at the app root renders them.
 *
 * Use toasts for outcomes that happen away from where the user is looking
 * (a save finished, a lock happened, a shortcut fired, a background error).
 * Form validation stays inline next to the field.
 */
import { useSyncExternalStore } from "react";
import type { Icon } from "@phosphor-icons/react";

export type ToastKind = "success" | "error" | "warning" | "info";

export interface ToastAction {
  label: string;
  onClick: () => void;
}

export interface ToastOptions {
  /** Reusing an id replaces that toast in place (e.g. one clipboard toast). */
  id?: string;
  kind?: ToastKind;
  title: string;
  description?: string;
  /** Keycaps shown after the description, e.g. ["Ctrl", "L"]. */
  shortcut?: string[];
  /** Overrides the kind's icon. */
  icon?: Icon;
  /** Milliseconds before it closes itself; `null` stays until dismissed. */
  duration?: number | null;
  /** A countdown bar ending at `endsAt` (a `Date.now()` time). */
  countdown?: { endsAt: number; totalSecs: number };
  actions?: ToastAction[];
  /** What screen readers hear. Defaults to the title and description. */
  announce?: string;
}

export interface ToastRecord extends Omit<ToastOptions, "id" | "kind" | "duration"> {
  id: string;
  kind: ToastKind;
  duration: number | null;
  /** Bumped on every change, so timers restart when a toast is replaced. */
  version: number;
  /** Playing its exit transition; removed after `EXIT_MS`. */
  closing: boolean;
}

export interface Announcement {
  text: string;
  assertive: boolean;
  /** Changes every time, so repeating the same text is still announced. */
  seq: number;
}

/** Errors stay longer: there's usually something to read and act on. */
export const DEFAULT_DURATION: Record<ToastKind, number> = {
  success: 4000,
  info: 4000,
  warning: 6000,
  error: 8000,
};
export const MAX_TOASTS = 3;
/** Matches the exit transition in <Toaster />. */
export const EXIT_MS = 200;

interface State {
  toasts: ToastRecord[];
  announcement: Announcement | null;
}

let state: State = { toasts: [], announcement: null };
let nextId = 0;
let nextSeq = 0;
const listeners = new Set<() => void>();
const removals = new Map<string, number>();

function commit(next: State) {
  state = next;
  for (const l of listeners) l();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function announce(t: ToastRecord, text?: string): Announcement {
  return {
    text: text ?? [t.title, t.description].filter(Boolean).join(". "),
    assertive: t.kind === "error",
    seq: nextSeq++,
  };
}

function show(opts: ToastOptions): string {
  const id = opts.id ?? `toast-${String(nextId++)}`;
  const kind = opts.kind ?? "info";
  window.clearTimeout(removals.get(id));
  removals.delete(id);

  const existing = state.toasts.find((t) => t.id === id);
  const { announce: text, ...rest } = opts;
  const record: ToastRecord = {
    ...rest,
    id,
    kind,
    duration: opts.duration === undefined ? DEFAULT_DURATION[kind] : opts.duration,
    version: (existing?.version ?? 0) + 1,
    closing: false,
  };

  let toasts = existing
    ? state.toasts.map((t) => (t.id === id ? record : t))
    : [...state.toasts, record];
  // Too many open: close the oldest.
  const open = toasts.filter((t) => !t.closing);
  const overflow = open.slice(0, Math.max(0, open.length - MAX_TOASTS)).map((t) => t.id);
  if (overflow.length) {
    toasts = toasts.map((t) => (overflow.includes(t.id) ? { ...t, closing: true } : t));
    for (const oid of overflow) scheduleRemoval(oid);
  }
  commit({ toasts, announcement: announce(record, text) });
  return id;
}

function scheduleRemoval(id: string) {
  removals.set(
    id,
    window.setTimeout(() => {
      removals.delete(id);
      commit({ ...state, toasts: state.toasts.filter((t) => t.id !== id) });
    }, EXIT_MS),
  );
}

function dismiss(id?: string) {
  const targets = state.toasts.filter((t) => !t.closing && (id === undefined || t.id === id));
  if (!targets.length) return;
  const ids = new Set(targets.map((t) => t.id));
  commit({ ...state, toasts: state.toasts.map((t) => (ids.has(t.id) ? { ...t, closing: true } : t)) });
  for (const tid of ids) scheduleRemoval(tid);
}

type KindOptions = Omit<ToastOptions, "kind" | "title">;

/** Shows a toast and returns its id. */
export const toast = Object.assign(show, {
  success: (title: string, opts: KindOptions = {}) => show({ ...opts, title, kind: "success" }),
  error: (title: string, opts: KindOptions = {}) => show({ ...opts, title, kind: "error" }),
  warning: (title: string, opts: KindOptions = {}) => show({ ...opts, title, kind: "warning" }),
  info: (title: string, opts: KindOptions = {}) => show({ ...opts, title, kind: "info" }),
  /** Closes one toast, or all of them. */
  dismiss,
  /** The open toast with this id, if any. */
  get: (id: string): ToastRecord | undefined => state.toasts.find((t) => t.id === id && !t.closing),
  /** Test helper: removes everything at once, no transition. */
  reset: () => {
    for (const handle of removals.values()) window.clearTimeout(handle);
    removals.clear();
    commit({ toasts: [], announcement: null });
  },
});

export function useToasts(): State {
  return useSyncExternalStore(subscribe, () => state);
}
