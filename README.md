# StaySpot – Assignment 1 (Project 3)

**GitHub:** https://github.com/HemanthReddyGaddam/2026201018_a1  
**Commit hash (update after final push):** `d7b5745a35abac57ad06ee085eee2af92308ee0b`

PostgreSQL + MongoDB persistence for vacation rentals (StaySpot). This README covers setup, schema assumptions, and Postgres `EXPLAIN (ANALYZE)` proof for Workflow 2 / indexes / materialized views.

---

## Assumptions

1. **Project:** StaySpot (Project 3) – guests, properties, bookings, wallet audit logs.
2. **`guests.email` is nullable.** Guests may book without providing an email. `UNIQUE` still applies when email is present; PostgreSQL allows multiple `NULL` emails.
3. **Extra guest fields:** `phone_number` (required, unique) and unique `name` for contact / demo convenience beyond the minimal assignment columns.
4. **Booking dates:** `check_in` / `check_out` added so `total_cost = nights * properties.base_price` (`nights = check_out - check_in`). Constraint: `check_out > check_in`.
5. **Status values:** `CONFIRMED`, `CHECKED_IN`, `COMPLETED` (underscore form of the brief’s “CHECKED IN”).
6. **Partial unique index:** at most one `CHECKED_IN` booking per guest (`idx_active_stay`).
7. **Wallet audit:** trigger fires `AFTER UPDATE OF wallet_balance` on `guests` and inserts into `wallet_audit_logs`.
8. **Materialized view:** `mv_property_analytics` aggregates completed stays (nights + gross revenue); refreshed via `refresh_property_analytics()` using `REFRESH MATERIALIZED VIEW CONCURRENTLY`.
9. **Workflow 1:** `sp_execute_booking` runs under `REPEATABLE READ`, deducts wallet, inserts booking, then `COMMIT`. Any `RAISE EXCEPTION` before `COMMIT` aborts the transaction (clean rollback).
10. **Scale targets:** ≥50k bookings and ≥100k wallet audit rows (see seeder / counts below).

---

## Setup (PostgreSQL)

```bash
# Create DB (once)
createdb -U postgres stayspot_db   # or: psql -U postgres -c "CREATE DATABASE stayspot_db;"

# Apply SQL in order
psql -U postgres -d stayspot_db -f sql/01_schema_ddl.sql
psql -U postgres -d stayspot_db -f sql/02_indexes.sql
psql -U postgres -d stayspot_db -f sql/03_triggers_and_audit.sql
psql -U postgres -d stayspot_db -f sql/04_stored_procedures.sql
psql -U postgres -d stayspot_db -f sql/05_materialized_views.sql

# Python deps + seed
pip install -r requirements.txt
# Edit data_generation/postgres_seeder.py DB_CONFIG if needed, then:
python data_generation/postgres_seeder.py

# Refresh MV after seed
psql -U postgres -d stayspot_db -c "SELECT refresh_property_analytics();"

# Workflow 2 analytics
psql -U postgres -d stayspot_db -f sql/06_window_analytics.sql
```

Example booking call:

```sql
CALL sp_execute_booking(
  1,              -- guest_id
  1,              -- property_id
  CURRENT_DATE,
  CURRENT_DATE + 2,
  (SELECT ROUND(2 * base_price, 2) FROM properties WHERE id = 1)
);
```

---

## Performance proof (PostgreSQL)

Raw plans: [`performance/postgres_explain_analyzes.txt`](performance/postgres_explain_analyzes.txt)

### Dataset scale (after seed)

| Table | Rows |
|-------|------|
| guests | ~10,000 |
| properties | ~2,000 |
| bookings | **50,000** |
| wallet_audit_logs | **100,000** |

### Workflow 2 (`sql/06_window_analytics.sql`)

- Aggregates all bookings into daily revenue per property, then 7-day moving average + `DENSE_RANK`.
- On ~50k bookings: **Hash Join** properties↔bookings, **WindowAgg** for moving average / rank.
- **Execution Time ≈ 119 ms** (full analytics over the seeded set).
- Note: a sequential read of `bookings` for a full-table window query is expected; selective lookups below use indexes.

### Materialized view lookup

```
Index Scan using idx_mv_property_analytics_id on mv_property_analytics
  Index Cond: (property_id = 1)
Execution Time: ~0.01–0.17 ms
```

Proves the unique index that enables `REFRESH CONCURRENTLY` is used for point lookups.

### Partial unique index (`idx_active_stay`)

```
Index Scan using idx_active_stay on bookings
  Index Cond: (guest_id = 42)
  (predicate: status = 'CHECKED_IN')
Execution Time: ~0.01 ms
```

No sequential scan for active-stay checks.

### Secondary index (`idx_bookings_property_status`)

```
Bitmap Index Scan on idx_bookings_property_status
  Index Cond: (property_id = 1 AND status = 'COMPLETED')
Execution Time: ~0.03 ms
```

Avoids filtering the full 50k-row heap for property-level completed revenue.

---

## MongoDB

See `mongo/` and `docs/mongo_schema_map.json`. Paste `explain("executionStats")` output for Workflows 3–4 into `performance/mongo_execution_stats.json` and summarize here when the Mongo half is finished.
