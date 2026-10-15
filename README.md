# StaySpot – Assignment 2: Front End (Team 16)

A web front end for the inherited **StaySpot (Project 3)** backend: guests book holiday stays and pay from a wallet,
staff watch revenue, search demand and reviews. PostgreSQL holds the transactional data; MongoDB holds reviews,
the flexible amenities catalog and geo search pings.

- **GitHub repository:** https://github.com/ShinjanLaha2026201005/Group_16_a1b
- **Final commit hash:** `<FINAL_COMMIT_HASH>`
- **Demo video:** https://drive.google.com/file/d/1eyvonVX9-boQKIR3qMVgtNuWPJUG80yT/view?usp=drive_link
- Inherited from: https://github.com/HemanthReddyGaddam/2026201018_a1 (forked, history kept).
  The original Part A README is preserved at [`docs/part_a_readme.md`](docs/part_a_readme.md).

---

## Screens

| Screen | Workflow | What it shows |
|---|---|---|
| **Browse** (`index.html`) | – | Guests / Properties / Bookings with server-side paging, search, filters and a detail panel |
| **Book a stay** (`book.html`) | Workflow 1 | Booking form → `sp_execute_booking`; balance before/after; new `wallet_audit_logs` row; friendly errors; wallet top-up; status buttons CONFIRMED → CHECKED IN → COMPLETED (partial unique index demo) |
| **Wallet audit** (`audit.html`) | Audit | `wallet_audit_logs` for one guest, date filter, running balance, totals |
| **Analytics** (`analytics.html`) | Workflow 2 + MV | 7-day moving average chart, `DENSE_RANK()` table, materialized view numbers with "last refreshed" + Refresh button |
| **Search map** (`map.html`) | Workflow 3 | `$geoNear` 5 km hotspots on a map, list sorted by distance, auto-refresh every 5 s, simulate new pings |
| **Reviews** (`reviews.html`) | Workflow 4 | `$facet` rating distribution, top tags, average; one `PropertyAmenities` document shown readably; latest reviews |

The **Switch** button in the navbar chooses which guest you are acting as (no real login). The dot next to it is
green when both databases are reachable and red otherwise.

---

## Setup (Windows, macOS or Linux)

Prerequisites: **PostgreSQL** (16+), **MongoDB** (7+) running as a service, **mongosh**, **Python 3.10+**, **Node.js 20+**.

### 1. PostgreSQL – schema, seed data, A2 additions

```bash
psql -U postgres -c "CREATE DATABASE stayspot_db;"

psql -U postgres -d stayspot_db -f sql/01_schema_ddl.sql
psql -U postgres -d stayspot_db -f sql/02_indexes.sql
psql -U postgres -d stayspot_db -f sql/03_triggers_and_audit.sql
psql -U postgres -d stayspot_db -f sql/04_stored_procedures.sql
psql -U postgres -d stayspot_db -f sql/05_materialized_views.sql

pip install -r data_generation/requirements.txt
```

Set your Postgres password for the seeder, then seed (≈1 minute, re-runnable):

```bash
# Windows PowerShell
$env:PGPASSWORD="your_password"; python data_generation/postgres_seeder.py
# macOS / Linux
PGPASSWORD=your_password python3 data_generation/postgres_seeder.py
```

Then add the Assignment 2 objects (refresh log + analytics functions; also does the first MV refresh):

```bash
psql -U postgres -d stayspot_db -f sql/07_a2_additions.sql
```

`sql/06_window_analytics.sql` is the stand-alone Workflow 2 query (run it to see the raw output).

### 2. MongoDB – collections, indexes, seed data

```bash
mongosh mongo/01_collections_and_indexes.js
python data_generation/mongo_seeder.py --drop-existing
```

> **Seed MongoDB shortly before a demo.** `SearchSessions` has a 2-hour TTL index, so seeded search pings are deleted
> 2 hours after seeding. The map's **Simulate 20 new searches** button also adds fresh pings at any time.

### 3. API + web front end

```bash
cd api
copy .env.example .env        # macOS/Linux: cp .env.example .env
# edit .env: set PGPASSWORD (and MONGO_URI if not the default)
npm install
npm start
```

Open **http://localhost:3000**. One process serves both the JSON API (`/api/...`) and the web pages.

### 4. Tests

With the database seeded and the server **not** required to be running:

```bash
cd api
npm test
```

11 tests (Node's built-in test runner) run against the real seeded PostgreSQL database:
booking success (wallet debited + DEBIT audit row), insufficient balance (friendly error, nothing changed),
invalid dates, second check-in blocked by `idx_active_stay`, status can only move one step,
paging capped at 100 rows, audit running balance continuity, gap-free moving average, DENSE_RANK has no gaps,
MV refresh updates "last refreshed". Test guests are created and deleted by the tests themselves.

---

## Tech choices

| Layer | Choice | Why |
|---|---|---|
| Server | **Node.js + Express** with `pg` and `mongodb` drivers | Small and well known; one process serves the API and the static pages. The route files only call the Part A procedure, functions, views and pipelines – the databases do the real work. |
| Front end | **Plain HTML + CSS + vanilla JavaScript**, no framework, no build step | Six screens do not need React; anyone can open a file and read it. Shared look and behaviour live in one `style.css` and one `common.js`. |
| Charts | **Chart.js** | Simple bar/line charts with tooltips. Served from `node_modules`, so no CDN/internet needed. |
| Map | **Leaflet** + OpenStreetMap tiles | Free, no API key. |
| Tests | **`node:test`** (built in) | No extra test framework to install. |

### Code organisation

```
api/
  server.js          Express app; auto-mounts every file in routes/ under /api; serves ../web
  db.js              shared PostgreSQL pool + MongoDB client (settings from .env)
  helpers.js         paging, errors, id validation
  routes/            one file per screen: guests, properties, bookings, analytics, hotspots, reviews
  tests/             node:test files
web/
  *.html             one page per screen
  css/style.css      the design system (colours, cards, tables, buttons, badges, states)
  js/common.js       navbar, guest switcher, api(), loading/empty/error states, table, pager, panel, toast
  js/<page>.js       logic for each page
sql/ mongo/ data_generation/   from Part A + our fixes
docs/                handover note, API list, design (users, wireframes, style guide), screenshots
```

---

## Assumptions

1. **Currency** is shown as ₹ (the seed data has no currency; the search hotspots are Indian cities).
2. **"Active stay" = `CHECKED_IN`**, as in the inherited partial unique index. Bookings are created as `CONFIRMED`, so the
   index is demonstrated on the status screen (checking in a second booking), not in the booking form.
3. **Status flow** is strictly CONFIRMED → CHECKED_IN → COMPLETED; there is no cancellation in the schema.
4. **Running balance** = `balance_after` stored by the trigger; "balance before" is derived from it and the amount.
5. **Moving average** is over 7 *calendar* days (days without bookings count as ₹0) – see handover note fix #1.
   Revenue is attributed to the day the booking was created (`created_at`), as in Part A.
6. **Ranking** ranks all properties by their 7-day moving average on the chosen date (top 20 shown).
7. **Map origin** is one of the seeded cities or any point clicked on the map; results cover the last 2 hours
   (the TTL window), radius fixed at 5 km.
8. **No authentication** – the guest switcher is for demos only.
9. **Reviews/amenities** use `property_id` 1–2000, matching PostgreSQL (seeder fix).

## Changes to the inherited code

Summarised here, explained in [`docs/handover_note.md`](docs/handover_note.md). All are marked `[A2 fix]` in the code.

- `sql/06_window_analytics.sql` – true 7-calendar-day moving average (gap-free calendar via `generate_series`).
- `sql/07_a2_additions.sql` – **new**: `mv_refresh_log`, `refresh_property_analytics()` logs refresh time,
  `fn_property_moving_avg()`, `fn_property_rank()`.
- `data_generation/postgres_seeder.py` – env-based connection, re-runnable (`TRUNCATE`), consistent wallet audit history.
- `data_generation/mongo_seeder.py` – default `--properties` 5000 → 2000 to match PostgreSQL.
- README rewritten; original kept as `docs/part_a_readme.md`; removed committed `.DS_Store`; added `.gitignore`, `.gitattributes`.

API endpoint list: [`docs/api_endpoints.md`](docs/api_endpoints.md) · Design: [`docs/design/`](docs/design/)

---

## Contribution

| Member | Roll no. | Branch | Design | Code |
|---|---|---|---|---|
| Shinjan Laha | 2026201005 | CSE | Handover note (`docs/handover_note.md`), API list (`docs/api_endpoints.md`) | Repo fixes (SQL, seeders), API core, shared front end, Browse + Book + Audit screens |
| Gagandeep Singh Narula | 2026202008 | CSIS | User descriptions (`docs/design/users.md`) | Analytics screen + `routes/analytics.js`, tests |
| Nilotpal Choudhury | 2026202005 | CSIS | Wireframes (`docs/design/wireframes.md`) | Search map screen + `routes/hotspots.js` |
| Viroja Shrutkumar Sanjaybhai | 2026204011 | PDM | Style guide (`docs/design/style_guide.md`) | Reviews & amenities screen + `routes/reviews.js` |
