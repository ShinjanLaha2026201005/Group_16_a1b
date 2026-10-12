# Handover note – StaySpot (Project 3)

Inherited repository: `HemanthReddyGaddam/2026201018_a1` (PostgreSQL + MongoDB backend for StaySpot).
We forked it (history kept) and built the Assignment 2 front end on top.

## What worked

- **Schema and constraints are clean.** `guests`, `properties`, `bookings`, `wallet_audit_logs` with sensible `CHECK`s
  (`wallet_balance >= 0`, `check_out > check_in`). All five SQL files ran first time on PostgreSQL 16 and 18.
- **`sp_execute_booking`** is solid: it locks the property and guest rows (`FOR UPDATE`), re-computes the price on
  the server side, checks the balance and raises clear exceptions, so a failed booking leaves nothing behind.
- **The wallet trigger** fires on every balance change, so top-ups (CREDIT) and bookings (DEBIT) are both audited
  without any application code.
- **The materialized view** has the unique index needed for `REFRESH ... CONCURRENTLY`.
- **Mongo scripts** have `$jsonSchema` validators, a `2dsphere` index, and `$geoNear` correctly placed as the first stage.
- The README explained every assumption, which made the takeover quick.

## What did not work / problems we found

| # | Problem | Effect |
|---|---------|--------|
| 1 | The "7-day" moving average used `ROWS BETWEEN 6 PRECEDING` over only the days that **had** bookings. | It averaged the last 7 *booking days*, which can span weeks. |
| 2 | The seeder generated `wallet_audit_logs` with random `balance_after` values unrelated to each guest's wallet. | A running balance could not be shown; the history did not add up. |
| 3 | The Mongo seeder created amenities/reviews for property ids 1–5000, but Postgres has only 2000 properties. | 60 % of catalog/review documents pointed at properties that do not exist. |
| 4 | Postgres doesn't record when a materialized view was refreshed. | The UI could not show "last refreshed". |
| 5 | The seeder had an empty hard-coded password and could not be re-run (duplicate names/phones). | Failed on our machines; re-seeding needed a manual `TRUNCATE`. |
| 6 | README listed the seeder command twice, the wrong `requirements.txt` path and a stale commit hash. | Confusing setup. |
| 7 | `SearchSessions` has a 2-hour TTL. | All seeded search pings disappear 2 hours after seeding, so the map goes empty. |
| 8 | The partial unique index covers only `CHECKED_IN`, while bookings are created as `CONFIRMED`. | The index can never fire during booking itself, only when a booking is checked in. |
| 9 | `sp_execute_booking` contains `COMMIT`. | It must be called on an autocommit connection; wrapping it in `BEGIN…COMMIT` gives "invalid transaction termination". |

## What we changed and why

All changes are marked with `[A2 fix]` comments in the code.

1. **`sql/06_window_analytics.sql`** – builds a gap-free calendar with `generate_series` and fills empty days with 0
   before the window function, so `ROWS BETWEEN 6 PRECEDING` now means 7 calendar days. (Fixes #1.)
2. **`sql/07_a2_additions.sql`** (new) – `mv_refresh_log` table, `refresh_property_analytics()` now logs each refresh
   (#4), and Workflow 2 wrapped as `fn_property_moving_avg(id)` and `fn_property_rank(date, limit)` so the API only calls functions.
3. **`data_generation/postgres_seeder.py`** – reads `PGPASSWORD`/`PGHOST`/… from the environment, `TRUNCATE … RESTART IDENTITY`
   at the start so it can be re-run, and audit logs are generated as a consistent chronological history per guest that
   **ends at the guest's real wallet balance** (#2, #5).
4. **`data_generation/mongo_seeder.py`** – default `--properties` changed from 5000 to 2000 (#3).
5. **TTL (#7)** – we kept the TTL (it is part of the original design) and added an API endpoint plus a
   "Simulate new searches" button that inserts fresh pings near the selected origin.
6. **Partial index (#8)** – we kept the original design ("active stay" = `CHECKED_IN`) and demonstrate the index on the
   status-change screen: checking in a second booking for the same guest is blocked with a readable message.
7. **README (#6)** – rewritten for the full system; the original Part A README is kept at `docs/part_a_readme.md`.
8. **`COMMIT` in procedure (#9)** – no change to the procedure; the API calls it through the connection pool in autocommit mode (documented in `api/routes/bookings.js`).

## Suggestions for the original authors

- Return the new booking id from `sp_execute_booking` (an `INOUT p_booking_id` parameter), so callers don't have to
  query for "the latest booking".
- Consider making `CONFIRMED` *and* `CHECKED_IN` "active" in `idx_active_stay` if the business rule is "one upcoming stay per guest".
- Generate seed data that is internally consistent (audit history vs wallet, Mongo ids vs Postgres ids) – it makes
  every later screen easier to verify.
- Keep connection settings in environment variables from day one.
