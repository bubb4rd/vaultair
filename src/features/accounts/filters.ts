import type {
  AccountFilter,
  AccountSort,
  GameView,
  IdentityRef,
  PlatformView,
  PurposeView,
  SortKey,
  StatusFilter,
  ViewSpec,
} from "@/ipc/client";
import { DEFAULT_SORT, EMPTY_FILTER } from "@/ipc/client";

/** What the filter menus can offer, from the vault's own data. */
export interface FilterContext {
  identities: IdentityRef[];
  purposes: PurposeView[];
  platforms: PlatformView[];
  games: GameView[];
  tags: string[];
  publishers: string[];
}

export interface FilterOption {
  value: string;
  label: string;
}

/**
 * One kind of filter chip. `selected` reads the chip's values out of a
 * filter and `set` writes them back (an empty list removes the chip), so
 * the chips and the query object Rust receives can't disagree.
 */
export interface FilterKind {
  id: string;
  label: string;
  /** Several values (any of them match), or one choice. */
  multi: boolean;
  /** An on/off filter: the chip is just its label. */
  flag?: boolean;
  options: (ctx: FilterContext) => FilterOption[];
  selected: (f: AccountFilter) => string[];
  set: (f: AccountFilter, values: string[]) => AccountFilter;
}

type ListKey = "identityIds" | "purposeIds" | "platformIds" | "gameIds" | "publishers" | "tags";

function listKind(id: string, label: string, key: ListKey, options: FilterKind["options"]): FilterKind {
  return {
    id,
    label,
    multi: true,
    options,
    selected: (f) => f[key] ?? [],
    set: (f, values) => ({ ...f, [key]: values }),
  };
}

/** A yes/no filter stored as `true`, `false` or unset. */
function triKind(
  id: string,
  label: string,
  key: "mfa" | "recoveryCodes" | "favorite",
  yes: string,
  no: string,
): FilterKind {
  return {
    id,
    label,
    multi: false,
    options: () => [
      { value: "yes", label: yes },
      { value: "no", label: no },
    ],
    selected: (f) => (f[key] === true ? ["yes"] : f[key] === false ? ["no"] : []),
    set: (f, values) => {
      const last = values.at(-1);
      return { ...f, [key]: last === undefined ? null : last === "yes" };
    },
  };
}

/** A day-count filter with a few fixed choices. */
function daysKind(id: string, label: string, key: "notVerifiedInDays" | "updatedInDays", days: number[]): FilterKind {
  return {
    id,
    label,
    multi: false,
    options: () => days.map((d) => ({ value: String(d), label: `${String(d)} days` })),
    selected: (f) => (f[key] ? [String(f[key])] : []),
    set: (f, values) => {
      const last = values.at(-1);
      return { ...f, [key]: last === undefined ? null : Number(last) };
    },
  };
}

function flagKind(id: string, label: string, key: "usesPrimaryEmail" | "highPriority"): FilterKind {
  return {
    id,
    label,
    multi: false,
    flag: true,
    options: () => [{ value: "on", label }],
    selected: (f) => (f[key] ? ["on"] : []),
    set: (f, values) => ({ ...f, [key]: values.length > 0 }),
  };
}

export const STATUS_OPTIONS: { value: StatusFilter; label: string }[] = [
  { value: "active", label: "Active" },
  { value: "stale", label: "Stale" },
  { value: "dormant", label: "Dormant" },
  { value: "locked", label: "Locked" },
  { value: "suspended", label: "Suspended" },
  { value: "retired", label: "Retired" },
  { value: "unknown", label: "Unknown" },
];

const byLabel = (a: FilterOption, b: FilterOption) => a.label.localeCompare(b.label);

/** Every filter the "Add filter" menu offers, in menu order. */
export const FILTER_KINDS: FilterKind[] = [
  listKind("identity", "Identity", "identityIds", (c) => c.identities.map((i) => ({ value: i.id, label: i.name }))),
  listKind("purpose", "Purpose", "purposeIds", (c) => c.purposes.map((p) => ({ value: p.id, label: p.name }))),
  {
    id: "status",
    label: "Status",
    multi: true,
    options: () => STATUS_OPTIONS,
    selected: (f) => f.statuses ?? [],
    set: (f, values) => ({
      ...f,
      statuses: STATUS_OPTIONS.map((s) => s.value).filter((s) => values.includes(s)),
    }),
  },
  listKind("platform", "Platform", "platformIds", (c) =>
    c.platforms.map((p) => ({ value: p.id, label: p.name })).sort(byLabel),
  ),
  listKind("game", "Game", "gameIds", (c) => c.games.map((g) => ({ value: g.id, label: g.name })).sort(byLabel)),
  listKind("publisher", "Publisher", "publishers", (c) => c.publishers.map((p) => ({ value: p, label: p }))),
  listKind("tag", "Tag", "tags", (c) => c.tags.map((t) => ({ value: t, label: t }))),
  triKind("mfa", "MFA", "mfa", "On", "Off"),
  triKind("recoveryCodes", "Recovery codes", "recoveryCodes", "Some left", "Missing"),
  triKind("favorite", "Favorite", "favorite", "Starred", "Not starred"),
  daysKind("notVerified", "Not verified in", "notVerifiedInDays", [30, 90, 180, 365]),
  daysKind("updated", "Edited in the last", "updatedInDays", [7, 30, 90]),
  flagKind("primaryEmail", "Uses a primary email", "usesPrimaryEmail"),
  flagKind("highPriority", "High-priority", "highPriority"),
];

export interface Chip {
  kind: FilterKind;
  values: string[];
  text: string;
}

/** A chip for each kind that has values, with the text it shows. */
export function activeChips(filter: AccountFilter, ctx: FilterContext): Chip[] {
  return FILTER_KINDS.flatMap((kind) => {
    const values = kind.selected(filter);
    if (values.length === 0) return [];
    const options = kind.options(ctx);
    const names = values.map((v) => options.find((o) => o.value === v)?.label ?? v);
    return [{ kind, values, text: kind.flag ? kind.label : `${kind.label}: ${names.join(", ")}` }];
  });
}

/** The filter with every chip removed (the archived side and the text stay). */
export function withoutChips(filter: AccountFilter): AccountFilter {
  return { ...EMPTY_FILTER, archived: filter.archived ?? false, text: filter.text ?? null };
}

/** Rust fills in omitted fields; this does the same, so filters compare by value. */
export function normalizeFilter(f: AccountFilter): AccountFilter {
  const text = f.text?.trim();
  return { ...EMPTY_FILTER, ...f, text: text ? text : null };
}

/** Whether the list shows exactly what a saved view stores. */
export function sameSpec(current: { filter: AccountFilter; sort: AccountSort }, spec: ViewSpec): boolean {
  const sort = spec.sort ?? DEFAULT_SORT;
  return (
    JSON.stringify(normalizeFilter(current.filter)) === JSON.stringify(normalizeFilter(spec.filter)) &&
    current.sort.key === sort.key &&
    current.sort.descending === sort.descending
  );
}

export const SORT_OPTIONS: { key: SortKey; label: string }[] = [
  { key: "title", label: "Name" },
  { key: "identity", label: "Identity" },
  { key: "purpose", label: "Purpose" },
  { key: "status", label: "Status" },
  { key: "activity", label: "Last activity" },
  { key: "updated", label: "Last edited" },
  { key: "created", label: "Date added" },
];
