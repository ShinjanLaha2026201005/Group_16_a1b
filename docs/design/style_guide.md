# Style guide

Everything below is implemented once in `web/css/style.css` and reused by every page.
Goal: consistent and calm rather than fancy.

## Colours

| Role | Colour | Used for |
|---|---|---|
| Brand / primary | `#0f766e` (teal) | primary buttons, active nav item, links |
| Background | `#f6f5f2` | page background |
| Surface | `#ffffff` | cards, tables, panels |
| Text / muted text | `#1d1c1a` / `#6b6963` | body text / labels and hints |
| Success | `#15803d` on `#e7f5ec` | COMPLETED, CREDIT, success alerts |
| Warning | `#b45309` on `#fdf2e3` | CHECKED IN |
| Error | `#b91c1c` on `#fdecec` | DEBIT, error alerts and error states |
| Chart series 1 / 2 | `#2a78d6` / `#eb6834` | bars / moving-average line (colour-blind-safe pair) |

## Typography

System font stack (`system-ui, Segoe UI, Roboto…`) – no web font to download. 15 px body, page titles 1.5 rem,
section titles 1.1 rem. Numbers use tabular figures and are right-aligned in tables. Money is shown in Indian format (`₹3,84,48,988.24`).

## Components

| Component | Class | Notes |
|---|---|---|
| Card | `.card` | white box, 10 px radius, soft shadow – every section sits in one |
| Stat tile | `.card.stat` | small uppercase label + big number (KPIs, balances) |
| Button | `.btn`, `.btn-secondary`, `.btn-sm` | one primary action per area; secondary for the rest |
| Form field | `label > input/select` | label above the field, 8 px radius |
| Table | `table` inside `.table-wrap` | scrolls sideways on phones; clickable rows highlight teal |
| Pager | `.pager` | First / Prev / Next / Last + "N records · page x of y" |
| Badge | `.badge-<STATUS>` | booking status and CREDIT/DEBIT |
| Alert | `.alert-ok`, `.alert-err` | result of an action |
| States | `showLoading`, `showEmpty`, `showError` in `common.js` | spinner / grey message / red message + "Try again" |
| Slide-over panel | `openPanel()` | record details on Browse, guest switcher |
| Toast | `toast()` | short confirmations |

## Layout

Max width 1200 px. Grids collapse to one column below 860 px, so every screen works on a phone. The navbar wraps.
