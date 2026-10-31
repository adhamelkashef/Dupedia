# X FORCE 1.4.3 — interface redesign (handover)

Built on 1.4.2 (research with Claude) and everything before it. Presentation and usability only: no change to the database,
sign-in, permissions, routes or business rules. Tested on Cloudflare's local runtime; **not yet on the live site**.

## Design direction
"Serious about play", run as an operating system. Same approved brand (Fraunces + Instrument Sans; cream, charcoal, lime;
the building-block shapes). Charcoal shows where you are, lime what you can do, stone hairlines how things are grouped.
Each department has one signal colour from the brand palette, used only for orientation (page mark, active menu item,
tab underline): Strategic — Iris · Sales & growth — Coral · Finance — Lagoon · Factory & engineering — Sun ·
Site Planner & products — Lime. A faint drawing-board grid behind page titles links the app to the sign-in page.

## What changed
| Area | Change |
|---|---|
| Sign-in / setup | White "blueprint" scene built from the brand's building blocks with dimension lines; the full logo on white (brand rule: never on dark); "Welcome to X FORCE"; Show-password; inline validation and clear errors (password cleared and focused after a wrong attempt); loading state on the button; smooth exit after success; phone and tablet layouts. No new sign-in features: no "remember me" (sessions already last 14 days) and no self-service reset (an administrator sets a new password). |
| After sign-in | The extra "Continue to X FORCE" step is skipped on the company server (you just signed in). |
| Header | "Search or jump to…" (Ctrl/⌘ K): every page your role can open, recent pages first, plus company search for administrators. |
| Menu | Department groups fold and unfold (remembered); the group of the page you are on always stays open. Phone: four places in the bottom bar plus "Menu", which opens the full menu as a sheet. |
| Pages | Sentence-case labels (no tracked capitals), stronger titles, department mark, KPI groups shown as one instrument panel, clearer tables, empty states with the building-block mark, refined buttons, fields, focus rings, tabs, status pills, dialogs, toasts and the notification filters. |
| CEO Control Center | "Financial control" and "People & operations" can be folded, each with a one-line summary; your choice is remembered (People & operations starts folded). |
| Strategic command center | Brand charcoal instead of green-black, drawing-board grid, Iris accents. |
| Motion | Page arrival, dialog, toast and menu-sheet movements only; all switched off with the system's reduced-motion setting. |
| Dark mode | Follows the device setting as before; the new colours have dark versions. |

## Files
New: `app/xf-ui.css` (design layer, loaded after styles.css), `app/ui-x.js` (search, menu groups, phone menu, departments).
Changed: `worker/index.js` (sign-in and setup pages only), `index.html` (two new files, search button, version),
`app/ui-shell.js` (skip the second step on the server), `app/ui-ceo.js` (folding sections).
Rollback: remove the two `xf-ui` / `ui-x` lines from index.html, or Cloudflare → Deployments → Rollback.

## Known limits
- The design layer restyles shared components; a few older screens with their own styling (Growth KPI cards, the quotation table layout) keep most of their previous look.
- No count-up animation on numbers and no loading skeletons beyond the restyled spinner.
- Arabic: menus translated as before; the new search labels are English.
