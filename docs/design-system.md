# Vaultair design system

> **Status:** Phase 2. Updated in Phase 4 (onboarding and lock screen) and Phase 13 (graph). Tokens live in `src/styles/globals.css`; this file records why they are what they are.

## Design read

> Reading this as: a desktop security utility for PC gamers and people who run many accounts, with a trust-first, restrained premium dark language, leaning toward Tailwind v4 + customized shadcn/ui + Geist.

**Dials** (design-taste-frontend): VARIANCE 4, MOTION 3, DENSITY 5. That's the skill's trust-first row, with density nudged up for a daily-use app. Motion 3 means no automatic animation: only hover, active and state-change feedback (150–200 ms), and none under `prefers-reduced-motion`.

**How the three design tools were used**

| Tool | Role in Phase 2 |
|---|---|
| design-taste-frontend | Direction, dials, palette family, anti-default checks, empty-state voice. Its own scope excludes dashboards and tables. |
| inspo MCP | References. It archives marketing sites, so only the product captures inside them helped (GitHub Desktop's diff UI, Novu's inbox panel). Takeaways: charcoal not blue-black surfaces, hairline borders instead of shadows, off-white primary button, accent only for state. |
| ui-ux-pro-max | UX rules (focus, keyboard, skip link, reduced motion) and shadcn conventions. Its generated palette (slate/OLED + green CTA) and Fira fonts were **not** used: green would collide with the "secure" status, and taste had already chosen Geist. |

## Frame

- **No title bar** (owner decision, 2026-09-23). The window is frameless. The sidebar's brand row and every page header are the drag regions (`data-tauri-drag-region`, double-click to maximize). Minimize, maximize/restore and close sit at the right end of the page header.
- Sidebar 232 px, header 48 px. Content is left-aligned with a 24 px gutter.
- Tauri only starts a drag when the pressed element itself has the attribute, so non-interactive children (title, wordmark) carry it too, and buttons don't.

## Color

Dark only for the MVP (spec deliverable 2). All colors are CSS variables, so a light theme is additive.

| Token | Value | Use | Contrast |
|---|---|---|---|
| `--background` | `#0e0f11` | App canvas | |
| `--sidebar` | `#131417` | Sidebar | |
| `--card` | `#17181c` | Panels | |
| `--popover` | `#1a1b1f` | Menus, dialogs | |
| `--muted` | `#1e2025` | Hover / raised / active nav | |
| `--foreground` | `#edeef0` | Primary text | 16.5 on bg, 14.0 on muted |
| `--muted-foreground` | `#a3a7af` | Secondary text | 7.9 on bg, 6.8 on muted |
| `--subtle-foreground` | `#878c95` | Tertiary text, group labels | 5.6 on bg, 4.8 on muted |
| `--primary` | `#edeef0` | The one filled button (text `#0e0f11`) | 16.5 |
| `--brand` | `#7aa2ff` | Focus rings, active nav icon, links, "linked/info" status | 7.7 on bg |
| `--border` | `#26282d` | Decorative dividers | (not a control edge) |
| `--border-strong` | `#33363c` | Emphasized dividers, outline buttons | |
| `--input` | `#666a73` | Control edges (inputs, checkboxes) | 3.3 on card (WCAG 1.4.11) |

**One accent.** Blue is the only hue that isn't a status, and it doubles as the "linked/info" status so no status color competes with it. No gradients, glows or glass.

### Status colors

A status is always **icon + text + color** (`StatusBadge`); color is never the only signal. Badges sit on a 12% tint of their own color.

| Status | Color | Icon (Phosphor) | Contrast on its tint |
|---|---|---|---|
| Secure | `#4cc38a` | ShieldCheck | 6.5 |
| Needs attention | `#e5c14a` | WarningCircle | 8.0 |
| Warning | `#f0924a` | Warning | 6.2 |
| High risk | `#f26d6d` | ShieldWarning | 5.2 |
| Dormant / archived / unknown | `#8d929b` | CircleDashed / Archive / Question | 4.8 |
| Linked / info | `#7aa2ff` | LinkSimple / Info | 5.9 |

Measured with the WCAG relative-luminance formula.

## Type

- **Geist Variable** (UI) and **Geist Mono Variable** (numbers, versions, codes later), self-hosted via `@fontsource-variable` because the CSP only allows `font-src 'self'`.
- Base 14 px / 1.5. Page titles 15 px semibold, -0.01em. Nav 13 px medium. Group labels 12 px, sentence case, no uppercase tracking.

## Shape and spacing

- One radius scale: controls 6 px, surfaces 8 px, overlays 12 px.
- Desktop hit areas: 32 px default (buttons, nav rows, window controls), 28 px small. ui-ux-pro-max's 44 px rule is for touch.
- Elevation comes from surface lightness and hairline borders, not shadows.

## Components

| Component | Notes |
|---|---|
| `components/ui/*` | shadcn (new-york) components, owned and customized: full-strength 2 px focus rings (the default 50% ring fails 3:1), desktop sizes, destructive buttons with dark text, Phosphor icons instead of Lucide. |
| `StatusBadge` | The status system above. |
| `EmptyState` | Left-aligned icon tile, title, one sentence on what appears here and how. |
| `KeyboardHint` | Keycaps with a screen-reader label. |
| `features/shell/*` | Sidebar, PageHeader (drag region + WindowControls), CommandPalette (Ctrl+K), AppLayout (skip link). |

## Voice

Plain and specific. Say what will appear and how it gets there. No hype verbs, no em-dashes, no exclamation marks, no "Oops". Examples: "No accounts yet", "Archived accounts stay in your vault but are left out of lists and security checks."

## Accessibility checklist (Phase 2)

- Every route renders an empty state with a heading (tested).
- Keyboard: every sidebar destination is reachable by Tab (tested); Ctrl+K opens the palette; the skip link is the first tab stop; the active page has `aria-current="page"`.
- axe-core finds no violations on the shell (tested; color contrast is measured here instead because jsdom can't compute it).
- Reduced motion collapses all transitions and animations.

## Known issue

Radix dialogs (the command palette) inject a scroll-lock `<style>` tag, which the CSP (`style-src 'self'`) blocks and reports in the console. It has no visible effect, because the page body never scrolls. The CSP stays strict; revisit only if a dialog ever needs body scroll locking.
