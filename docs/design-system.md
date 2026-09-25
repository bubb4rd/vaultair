# Vaultair design system

> **Status:** Phase 4. Updated in Phase 13 (graph). Tokens live in `src/styles/globals.css`; this file records why they are what they are.

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

## Onboarding and lock screen (Phase 4)

**Design read** (design-taste-frontend): first-run setup and lock screen for a desktop security utility, trust-first and restrained, extending this system rather than adding a new look. Dials unchanged (4 / 3 / 5). The inspo MCP was not used: its own guidance is to follow an existing design system when there is one, and a landing-page archive has little to say about a setup wizard.

**Composition**
- Onboarding is full-window with **no sidebar**: the borderless drag strip (brand at left, window controls at right), then one centered column (max 560 px). At the top of the column is a horizontal, segmented progress bar, as in mobile onboarding: five segments for the five stages (Welcome, Your vault, Master password, Create, Next steps). The current segment fills in steps as you move through its screens, in the brand blue, and the current stage name sits under the bar. No "Step 1 of 9" labels. Screen readers get each stage name, "(done)" on finished ones, and `aria-current="step"` on the current one. The fill animates its width over 200 ms, which reduced motion turns off.
- Each screen: optional Back link above the title, a 24 px semibold title (it takes focus on arrival so screen readers announce the step), up to about 60 characters per line of intro, content, then the primary button left-aligned with any secondary action beside it.
- Lock screen: one 380 px column, a lock tile, the vault name as the title and its path in mono underneath, the password field, a full-width Unlock button, "Other vaults", then "Open a different vault" and "Create a new vault". A single focused moment, so it's the one centered layout.
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

**Copy**: plain and honest. Nothing claims a feature that isn't built: backups are "coming in a later version", demo vaults say sample data arrives later, the lockout says "Try again in 5 s". The source texts are `docs/privacy-statement-draft.md` and `docs/forgot-master-password.md`.

## Known issue

Radix dialogs (the command palette) inject a scroll-lock `<style>` tag, which the CSP (`style-src 'self'`) blocks and reports in the console. It has no visible effect, because the page body never scrolls. The CSP stays strict; revisit only if a dialog ever needs body scroll locking.
