# API endpoints

Base URL: `http://localhost:3000/api`. All responses are JSON. Errors always look like `{ "error": "readable message" }`
with a matching HTTP status (400 bad input, 404 not found, 409 blocked by a constraint, 422 booking rejected, 503 MongoDB down).
List endpoints are paged on the server: `page` (default 1) and `limit` (default 20, max 100), and return
`{ rows, total, page, limit }`.

## Browse (PostgreSQL)

| Method | Path | Inputs | Output |
|---|---|---|---|
| GET | `/guests` | `search` (name/email/phone/id), `page`, `limit` | paged guests |
| GET | `/guests/:id` | – | guest + booking counts by status + 5 latest bookings |
| GET | `/properties` | `search`, `minPrice`, `maxPrice`, `sort` (`id`, `price_asc`, `price_desc`, `title`), `page`, `limit` | paged properties |
| GET | `/properties/:id` | – | property + its `mv_property_analytics` row + open booking counts |
| GET | `/bookings` | `guestId`, `propertyId`, `status`, `page`, `limit` | paged bookings (newest first) |
| GET | `/bookings/:id` | – | one booking with guest/property names and nights |

## Workflow 1 – booking (PostgreSQL)

| Method | Path | Inputs | Output |
|---|---|---|---|
| GET | `/quote` | `propertyId`, `checkIn`, `checkOut` | `{ title, base_price, nights, total_cost }` price preview |
| POST | `/bookings` | `{ guestId, propertyId, checkIn, checkOut }` | 201 `{ balance_before, balance_after, booking, audit_entries }` · 422 `{ error, db_error, balance_before, balance_after }` |
| PATCH | `/bookings/:id/status` | `{ status }` – only `CONFIRMED→CHECKED_IN→COMPLETED` | 200 `{ message, booking }` · 409 `{ error, constraint: "idx_active_stay" }` |
| POST | `/guests/:id/topup` | `{ amount }` | `{ wallet_balance, audit_entry }` (CREDIT row from the trigger) |

`POST /bookings` calls `CALL sp_execute_booking(guest, property, check_in, check_out, total_cost)`.

## Audit trail (PostgreSQL)

| Method | Path | Inputs | Output |
|---|---|---|---|
| GET | `/guests/:id/audit` | `from`, `to` (YYYY-MM-DD) | `{ guest, rows[{ timestamp, action_type, amount_changed, balance_before, balance_after }], summary{ opening_balance, closing_balance, total_credits, total_debits } }` |

## Workflow 2 + materialized view (PostgreSQL)

| Method | Path | Inputs | Output |
|---|---|---|---|
| GET | `/analytics/moving-average` | `propertyId` | `{ property, rows[{ booking_date, daily_revenue, moving_avg_7day }] }` via `fn_property_moving_avg` |
| GET | `/analytics/ranking` | `date` (default: latest), `limit` | `{ date, rows[{ property_rank, property_id, property_title, revenue_on_date, moving_avg_7day }] }` via `fn_property_rank` (DENSE_RANK) |
| GET | `/analytics/summary` | – | `{ totals, top_properties, last_refreshed }` from `mv_property_analytics` + `mv_refresh_log` |
| POST | `/analytics/refresh` | – | `{ message, last_refreshed }` – runs `refresh_property_analytics()` |

## Workflow 3 – search hotspots (MongoDB)

| Method | Path | Inputs | Output |
|---|---|---|---|
| GET | `/hotspots/presets` | – | list of seeded cities `{ name, lat, lng }` |
| GET | `/hotspots` | `lat`, `lng`, `minutes` (≤120) | `{ origin, radius_m: 5000, hotspots[{ lat, lng, search_count, avg_distance_m, avg_radius_km }], nearest[pings sorted by distance], total_searches }` |
| POST | `/hotspots/simulate` | `{ lat, lng, count }` | `{ inserted }` – adds fresh pings (TTL removes seeded ones after 2 h) |

## Workflow 4 – reviews + catalog (MongoDB)

| Method | Path | Inputs | Output |
|---|---|---|---|
| GET | `/reviews/facets` | `propertyId` (optional) | `{ ratingDistribution[{rating,count}], topTags[{tag,frequency}], overallStats{averageRating,totalReviews} }` – one `$facet` pipeline |
| GET | `/reviews` | `propertyId`, `page`, `limit` | latest reviews |
| GET | `/amenities/:propertyId` | – | the `PropertyAmenities` document |

## Other

| Method | Path | Output |
|---|---|---|
| GET | `/health` | `{ postgres: true/false, mongo: true/false }` (green/red dot in the navbar) |
