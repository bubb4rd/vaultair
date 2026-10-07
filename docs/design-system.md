# Vaultair design system

> **Status:** Final for the MVP (Phase 16). The colour tokens, the status system and the sizes and limits named here (sidebar, column widths, map nodes, toast timings) were checked against the code; the contrast ratios were not re-measured. Tokens live in `src/styles/globals.css`; this file records why they are what they are.

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
| `CatalogLogo` | A platform's, game's or account's mark, in lists, the catalog pages and map nodes. A logo stands free, in its brand colour if that reaches 3:1 on the card, otherwise in the text colour. A reviewed file is shown as an image in the same box, never as inline markup. With no logo, initials sit in a tile: neutral for user-added entries, and for a built-in tinted with its brand colour (15% fill and 45% border mixed into the card; the initials take the colour only at 3:1). Brand tints appear only on this tile, never on text, rows or status, so they can't be mistaken for a status or an identity colour. Always decorative: the name is written next to it. |
| `features/shell/*` | Sidebar, PageHeader (drag region + WindowControls), CommandPalette (Ctrl+K), AppLayout (skip link). |

## Voice

Plain and specific. Say what will appear and how it gets there. No hype verbs, no em-dashes, no exclamation marks, no "Oops". Examples: "No accounts yet", "Archived accounts stay in your vault but are left out of lists and security checks."

## Accessibility checklist (Phase 2)

- Every route renders an empty state with a heading (tested).
- Keyboard: every sidebar destination is reachable by Tab (tested); Ctrl+K opens the palette; the skip link is the first tab stop; the active page has `aria-current="page"`.
- axe-core finds no violations on the shell (tested; color contrast is measured here instead because jsdom can't compute it).
- Reduced motion collapses all transitions and animations.

## Onboarding and lock screen (Phase 4)

**Design read** (design-taste-frontend): first-run setup and lock screen for a desktop security utility, trust-first and restrained, extending this system rather than adding a new look. Dials unchanged (4 / 3 / 5). The inspo MCP was not used: its own guidance is to follow an existing design system when there is one, and a landing-page archive has little to say about a setup wizard.

**Composition**
- Onboarding is full-window with **no sidebar**: the borderless drag strip (brand at left, window controls at right), then one centered column (max 560 px). At the top of the column is a horizontal, segmented progress bar, as in mobile onboarding: five segments for the five stages (Welcome, Your vault, Master password, Create, Next steps). The current segment fills in steps as you move through its screens, in the brand blue, and the current stage name sits under the bar. No "Step 1 of 9" labels. Screen readers get each stage name, "(done)" on finished ones, and `aria-current="step"` on the current one. The fill animates its width over 200 ms, which reduced motion turns off.
- Each screen: optional Back link above the title, a 24 px semibold title (it takes focus on arrival so screen readers announce the step), up to about 60 characters per line of intro, content, then the primary button left-aligned with any secondary action beside it.
- Lock screen (redesigned 2026-10-06 at the owner's request, after a split-panel sign-in reference): under the drag strip, two equal columns. Left is the form column: a 380 px block centred vertically holds the vault name as a 24 px title with its path in mono underneath, then Windows Hello or the password field with a full-width Unlock, an "or" hairline between the two ways in, then "Other vaults". Pinned to the bottom of the column are "Open a different vault", "Create a new vault" and "Restore a backup" as ghost buttons. Right is a decorative hero panel (hidden from assistive tech), inset 16 px with the 12 px overlay radius and a hairline border: the owner's dark blockchain backdrop (`src/features/lock/lock-backdrop.webp`, 139 KB) covers it edge to edge, anchored right so its left side is what gets cropped; a floating card (popover at 85% with backdrop blur, strong hairline, 12 px radius) hangs 56 px past the panel's left edge, so its chip row is cut by the edge (the owner's request: the inverse of the reference, whose panel is on the left and crops at the right). The card carries a lock tile in the brand blue, "Encrypted on this PC", one line from the privacy statement, and four chips for what the vault holds (Identities, Accounts, Recovery, Health); a 22 px tagline sits bottom-left over a soft dark gradient. Every claim on the card is true today. The form enters with the onboarding fade (300 ms), the panel with a 500 ms fade and slight zoom, and the card 150 ms after it; reduced motion removes all three.
- Full-screen views have no title bar either: `DragBar` is a 48 px borderless strip that is a drag region and holds the window controls.

**Forms** (ui-ux-pro-max rules): label above, help below, error below that with an icon; `aria-invalid` and `aria-describedby` point at the error; on a failed submit the first invalid field gets focus. Errors are never color alone.

**Strength meter**: four 4 px segments plus a text label (Very weak to Strong) and a three-item requirements list with check icons and hidden "(done)"/"(not yet)" text. The score comes from Rust (`strength_estimate`), so the meter and the enforced policy can't disagree. Segment color follows the status palette: risk, warning, secure.

**Callouts**: the cloud-sync warning and create failure use a bordered panel on an 8% tint of the status color, with an icon and a text title.

**Motion** (owner request, 2026-09-24: onboarding should feel animated; the motion dial is about 5 for onboarding only, and stays 3 in the app):
- Each screen enters with a 300 ms fade plus a 24 px slide: from the right going forward, from the left after Back (`data-direction`). Enter-only; the old screen is not animated out.
- Inside a screen the heading, then the content, then the actions fade up 4 px, 60 ms apart.
- The progress segment's fill animates its width (200 ms). "Your vault is ready" opens with a green check that scales in. The cloud warning and field errors fade and slide down 4 px.
- All of it is CSS (`tw-animate-css`), so there's no animation library and the CSP stays strict. Under `prefers-reduced-motion` durations and delays drop to zero, so staggered parts never stay hidden.
- The spinner on "Securing your vault" is state feedback while Argon2 runs; the text says what's happening even with motion off.

**Toasts** (owner requests, 2026-09-25: announce success, error, hotkey and activity events with motion, as macOS-style horizontal capsules at the top). One `<Toaster />` at the app root, top center 12 px below the window edge, newest on top, at most 3 on screen. Call `toast.success/error/warning/info(title, { description, shortcut, actions, duration, id })` from anywhere (`src/features/toast/toast.ts`).
- Anatomy: a single-row capsule (popover color at 95% with backdrop blur, hairline strong border, 22 px radius so one line has fully round ends, no shadow, up to 720 px wide): a filled kind icon in the status color (success green check, error red cross, warning orange, info brand blue), then the title in medium weight and the description after a middle dot, keycaps for a shortcut, pill-shaped inline actions (last one outline), and a round dismiss button. Errors also get a red-tinted border, so kind never relies on color alone. A countdown is a ring that drains around the icon, plus a compact "29s" readout.
- Timing: success and info 4 s, warning 6 s, errors 8 s; `duration: null` stays until dismissed. Hover or keyboard focus pauses the clock. Reusing an `id` replaces a toast in place and restarts its time (the clipboard toast does this).
- Motion: enters by dropping 12 px from above while scaling from 0.95 and fading in (200 ms, `@starting-style`), exits by lifting 8 px and fading (200 ms), and its row grows in and collapses out (`grid-template-rows`), so the stack glides instead of jumping. CSS only; reduced motion removes it.
- Screen readers: two role-less live regions, polite for most kinds and assertive for errors, each announcing a toast once. Countdown ticks aren't announced.
- Use toasts for outcomes away from the pointer: saves, locks (the lock screen says why: "Vault locked · Ctrl L", "Locked after 5 minutes of inactivity", "Locked because Windows was locked"), shortcuts, background errors. Field validation stays inline. Keep copy to one line: a short title and a short description.

**No-recovery acknowledgement**: styled as a danger on purpose, as the one irreversible fact in setup. The panel uses a High-risk border and 8% tint, a bold red "There is no way to recover a forgotten master password" line with a shield-warning icon, the statement in foreground text, and a red checkbox. It reads as a warning without relying on color: the icon and wording carry it too.

**Copy**: plain and honest. Nothing should claim a feature that isn't built, or deny one that is; the lockout says "Try again in 5 s". (One line is out of date: the demo-vault step still says sample accounts "arrive in a later version", and they are seeded now.) The source texts are `docs/privacy-statement-draft.md` and `docs/forgot-master-password.md`.

## Known issue

Radix dialogs (the command palette) inject a scroll-lock `<style>` tag, which the CSP (`style-src 'self'`) blocks and reports in the console. It has no visible effect, because the page body never scrolls. The CSP stays strict; revisit only if a dialog ever needs body scroll locking.

## Generator (Phase 6)

**Design read** (design-taste-frontend): an in-app utility page for a desktop security app, trust-first; extends this system with no new look. Dials unchanged (4 / 3 / 5). Taste's scope excludes dense product UI, so it set direction only; the inspo MCP was not used (existing system).

- **Page** (sidebar group "Tools", or Ctrl+K "password"/"passphrase"): one left-aligned column, max 640 px. From the top: Password / Passphrase segmented control; the output panel (card surface, hairline border); the options; one sentence on where the value comes from.
- **Output panel**: the value in Geist Mono 17 px, wrapping anywhere, with digits and symbols in the brand blue so they're easy to tell apart when typed by hand (the one accent, not a status color). Below a hairline: the strength row (the onboarding meter's four segments, a text label, and entropy as "129 bits" in mono), then "Generate another" (icon button) and Copy (the one filled button). Every option change regenerates at once; only the newest answer is shown. A new value is announced politely with its strength label, never the value itself.
- **Options**: length and word count are a slider plus a small number field kept in sync (typing out of range never generates). Character types are switches with their sample in mono; the last one left on is disabled with "At least one type of character is needed." as its description. The separator is a segmented control with named items (Hyphen, Space, Period, Underscore, Comma).
- **Errors**: an impossible exclusion replaces the value with the error (icon + text), marks the field invalid, and disables Copy, so a stale value can't be copied.
- **Popover** (`GeneratorPopover`, 340 px, overlay radius 12 px): mode, value with a regenerate icon, strength, length or words, then Copy and "Use password". Other options come from the page's last settings.
- **New primitives**: `Switch` (brand when on), `Slider` (brand range, 2 px focus ring with offset), `Popover`, and `SegmentedGroup` (a Radix radio group styled like the default tabs list, arrow keys move the selection).

## Relationship map (Phase 13)

**Design read** (design-taste-frontend): an in-app relationship graph for a desktop security utility, trust-first and restrained; extends this system with no new look. Dials unchanged (4 / 3 / 5). Taste's scope excludes dense product UI, so it set the node language only. The one inspo search for graph views returned a single marketing page, so no reference was taken from it.

- **Page**: the header holds an All / Focused segmented control, the focus picker (Focused only: a 28 px button showing the current record that opens a popover with a search field and the records grouped by Identities, Accounts, Emails, Recovery methods, Platforms and Games, the current one ticked) and a Map / List segmented control. The map fills the page; a one-row legend sits under it, so it never covers the drawing.
- **Nodes** are the same card everywhere: 224 by 52 px, card surface, strong hairline border, 8 px radius. Left, a 32 px mark: an identity's initials on its colour, a platform's, game's or account's logo (or initials), or a Phosphor icon on a muted tile for an email, phone or MFA method. Right, the label in 13 px medium and under it the kind in 12 px muted text, with an account's purpose ("Account, Main"). The kind is always written; the mark and colour are decoration. The focus has the brand border and says "the focus" to screen readers.
- **Lines** are 1.5 px in the control-edge grey, and every one carries its relationship as an 11 px label just before the node it runs into. Dash pattern groups them: solid for assigned and sign-in, dashed for recovery, dash-dot in the brand blue for a linked account, dotted for platform, game and MFA. Pattern and label carry the meaning; the blue is the existing "linked" status colour and is never the only cue. Several lines into one node arrive one under another, so labels don't stack on top of each other. No arrowheads: the label names the relationship from either end.
- **Prospective accounts** (an email's mailbox the vault has no account for) use the same card with a dashed control-edge border on the page background, the provider's logo at 60% or a plus on a dashed tile, and the kind "Suggested account". Their line is dots in pairs, labelled "Mailbox". The card opens a popover with Add account (primary), Edit first (outline) and Discard (ghost); the list row ends with the same three as text buttons.
- **Layout**: left to right from the focus, one column per step of the tree. Nothing animates and nothing is dragged. The drawing opens fitted to the window, pans by scrolling or dragging the background, and zooms with three buttons at the bottom right (zoom in, zoom out, fit).
- **List view**: one card, the tree as nested lists with a hairline rail per level. Each row is the relationship (12 px, tertiary), a 24 px mark, the name (a link, or a button for records that only refocus the map), the kind, and a "Focus" button on identities and accounts. Links the nesting can't show sit under the row in 12 px muted text, as "Recovery email: address".
- **Keyboard**: every node is a button on the map and a link or button in the list, in reading order. The list is the default when the system asks for reduced motion and for maps over 80 nodes.
