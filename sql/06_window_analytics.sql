-- sql/06_window_analytics.sql
-- Workflow 2: 7-day moving average revenue per property + DENSE_RANK.
--
-- [A2 fix] The original version used ROWS BETWEEN 6 PRECEDING over only the days
-- that HAD bookings, so a property with bookings on 1 Oct and 20 Oct averaged
-- those two days together ("last 7 booking days", not "last 7 calendar days").
-- This version first builds a complete calendar (generate_series) for every
-- property, fills empty days with 0 revenue, and only then applies the window,
-- so ROWS BETWEEN 6 PRECEDING really means the last 7 calendar days.
-- The same logic is wrapped as SQL functions in 07_a2_additions.sql for the API.

WITH bounds AS (
    SELECT MIN(created_at)::DATE AS first_day,
           MAX(created_at)::DATE AS last_day
    FROM bookings
),
calendar AS (
    -- Step 1: one row per (property, calendar day)
    SELECT p.id AS property_id,
           p.title AS property_title,
           d::DATE AS booking_date
    FROM properties p
    CROSS JOIN bounds b
    CROSS JOIN generate_series(b.first_day, b.last_day, INTERVAL '1 day') AS d
),
daily_property_revenue AS (
    -- Step 2: actual revenue per property per day
    SELECT property_id,
           created_at::DATE AS booking_date,
           SUM(total_cost) AS daily_revenue
    FROM bookings
    GROUP BY property_id, created_at::DATE
),
moving_average_calc AS (
    -- Step 3: 7-day moving average over the gap-free calendar
    SELECT c.property_id,
           c.property_title,
           c.booking_date,
           COALESCE(r.daily_revenue, 0) AS daily_revenue,
           AVG(COALESCE(r.daily_revenue, 0)) OVER (
               PARTITION BY c.property_id
               ORDER BY c.booking_date
               ROWS BETWEEN 6 PRECEDING AND CURRENT ROW
           ) AS moving_avg_7day
    FROM calendar c
    LEFT JOIN daily_property_revenue r
           ON r.property_id = c.property_id
          AND r.booking_date = c.booking_date
)
-- Step 4: rank properties per date based on 7-day moving average
SELECT property_id,
       property_title,
       booking_date,
       daily_revenue,
       ROUND(moving_avg_7day, 2) AS moving_avg_7day,
       DENSE_RANK() OVER (
           PARTITION BY booking_date
           ORDER BY moving_avg_7day DESC
       ) AS property_rank
FROM moving_average_calc
ORDER BY booking_date DESC, property_rank ASC
LIMIT 100;
