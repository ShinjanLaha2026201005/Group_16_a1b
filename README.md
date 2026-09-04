# StaySpot – Assignment 1 (Project 3)

**GitHub:** https://github.com/HemanthReddyGaddam/2026201018_a1  
**Commit hash (update after final push):** `320d487573b14adcf28a31067b2d32ec8518059f`

PostgreSQL + MongoDB persistence for vacation rentals (StaySpot). This README covers setup, schema assumptions, and performance proof for Workflows 2–4 (`EXPLAIN ANALYZE` / `explain("executionStats")`).

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
10. **Scale targets (Postgres):** ≥50k bookings and ≥100k wallet audit rows.
11. **Mongo collections:** `PropertyAmenities` (flexible amenities), `PropertyReviews` (ratings + tags), `SearchSessions` (GeoJSON search pings).
12. **Mongo geospatial + TTL:** `2dsphere` on `SearchSessions.location`; TTL on `created_at` with `expireAfterSeconds: 7200` (2 hours). Session count drops after TTL — re-seed before demo if you need ≥500k docs.
13. **Workflow 3:** `$geoNear` finds SearchSessions within 5 km, then grid-clusters into hotspots.
14. **Workflow 4:** `$facet` computes rating distribution, top tags (`$unwind`), and overall average rating.

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

## Setup (MongoDB)

```bash
# Start Mongo (Homebrew)
brew services start mongodb-community

# 1) Collections + indexes (2dsphere, TTL, review indexes)
#    WARNING: this script drops the three StaySpot collections if they already exist.
mongosh "mongodb://localhost:27017" mongo/01_collections_and_indexes.js

# 2) Seed (≥500k SearchSessions). Requires: pip install -r requirements.txt
python3 data_generation/mongo_seeder.py \
  --uri "mongodb://localhost:27017" \
  --db stayspot \
  --sessions 500000 \
  --reviews 12000 \
  --properties 2000 \
  --drop-existing

# 3) Workflows
mongosh "mongodb://localhost:27017" mongo/02_workflow3_geonear.js
mongosh "mongodb://localhost:27017" mongo/03_workflow4_facet.js

# Optional: scope Workflow 4 to one property
mongosh "mongodb://localhost:27017" \
  --eval 'var FILTER_PROPERTY_ID = 1' \
  mongo/03_workflow4_facet.js
```

Interactive shell (like `psql`):

```bash
mongosh "mongodb://localhost:27017/stayspot"
```

```javascript
db.SearchSessions.countDocuments({})
db.PropertyReviews.countDocuments({})
db.SearchSessions.getIndexes()
db.PropertyReviews.getIndexes()
```

Schema map: [`docs/mongo_schema_map.json`](docs/mongo_schema_map.json)

---

## Performance proof (MongoDB)

Raw / compact plans: [`performance/mongo_execution_stats.json`](performance/mongo_execution_stats.json)

### Dataset scale (after seed; SearchSessions shrinks via TTL)

| Collection | Docs (target) | Notes |
|------------|---------------|--------|
| PropertyAmenities | ~2,000 | 1 doc per property |
| PropertyReviews | ~12,000 | ratings 1–5 + tags |
| SearchSessions | **≥500,000** after seed | TTL 2h → count falls until re-seed |

### Indexes created (`mongo/01_collections_and_indexes.js`)

- `SearchSessions.idx_location_2dsphere` — `{ location: "2dsphere" }`
- `SearchSessions.idx_created_at_ttl` — `{ created_at: 1 }`, `expireAfterSeconds: 7200`
- `PropertyReviews.idx_property_rating` — `{ property_id: 1, rating: -1 }`
- `PropertyReviews.idx_tags` — `{ tags: 1 }`

### Workflow 3 — `$geoNear` hotspots (`mongo/02_workflow3_geonear.js`)

```
winningPlan.inputStage.stage      = GEO_NEAR_2DSPHERE
winningPlan.inputStage.indexName  = idx_location_2dsphere
executionTimeMillis               ≈ 14 ms
```

Proves geospatial query uses the **2dsphere index**, not `COLLSCAN`.

### Workflow 4 — `$facet` review analytics (`mongo/03_workflow4_facet.js`)

With `$match: { property_id: 1 }` before `$facet`:

```
executionStages ... stage = IXSCAN
indexName                 = idx_property_rating
totalDocsExamined         = totalKeysExamined   (selective; not full collection scan)
executionTimeMillis       ≈ 5 ms
```

Proves the property filter hits **`idx_property_rating`**, then `$facet` builds rating distribution, top tags, and overall average in one pass.

### How to regenerate Mongo explains (interactive)

```javascript
// Workflow 3 proof
db.SearchSessions.explain("executionStats").aggregate([
  { $geoNear: {
      near: { type: "Point", coordinates: [77.5946, 12.9716] },
      distanceField: "distance_meters",
      maxDistance: 5000,
      spherical: true,
      query: { created_at: { $gte: new Date(Date.now() - 120*60*1000) } }
  }},
  { $limit: 20 }
])

// Workflow 4 proof
db.PropertyReviews.explain("executionStats").aggregate([
  { $match: { property_id: 1 } },
  { $facet: {
      ratingDistribution: [
        { $bucket: { groupBy: "$rating", boundaries: [1,2,3,4,5,6],
                     default: "other", output: { count: { $sum: 1 } } } }
      ],
      topTags: [
        { $unwind: "$tags" },
        { $group: { _id: "$tags", frequency: { $sum: 1 } } },
        { $sort: { frequency: -1 } },
        { $limit: 10 }
      ],
      overallStats: [
        { $group: { _id: null, averageRating: { $avg: "$rating" },
                    totalReviews: { $sum: 1 } } }
      ]
  }}
])
```

Look for `GEO_NEAR_2DSPHERE` / `IXSCAN` and **no** `COLLSCAN` on the heavy stages.
