-- sql/07_a2_additions.sql
-- Assignment 2 additions on top of the inherited Part A schema.
-- Run AFTER 01-05. Safe to re-run.

-- ---------------------------------------------------------------------------
-- 1. "Last refreshed" time for the materialized view
--    PostgreSQL does not record when a materialized view was last refreshed,
--    so the refresh function now logs every refresh into a small table.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS mv_refresh_log (
    id           SERIAL PRIMARY KEY,
    view_name    VARCHAR(100) NOT NULL,
    refreshed_at TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    duration_ms  NUMERIC(10, 2)
);

CREATE OR REPLACE FUNCTION refresh_property_analytics()
RETURNS VOID AS $$
DECLARE
    v_start TIMESTAMPTZ := clock_timestamp();
BEGIN
    REFRESH MATERIALIZED VIEW CONCURRENTLY mv_property_analytics;
    INSERT INTO mv_refresh_log (view_name, duration_ms)
    VALUES ('mv_property_analytics',
            EXTRACT(EPOCH FROM clock_timestamp() - v_start) * 1000);
END;
$$ LANGUAGE plpgsql;

-- ---------------------------------------------------------------------------
-- 2. Workflow 2 as functions (same logic as 06_window_analytics.sql),
--    so the API just calls them and the database does the work.
-- ---------------------------------------------------------------------------

-- 2a. Daily revenue + 7-day moving average for ONE property (chart)
CREATE OR REPLACE FUNCTION fn_property_moving_avg(p_property_id INT)
RETURNS TABLE (
    booking_date    DATE,
    daily_revenue   NUMERIC,
    moving_avg_7day NUMERIC
) AS $$
    WITH bounds AS (
        SELECT MIN(created_at)::DATE AS first_day,
               MAX(created_at)::DATE AS last_day
        FROM bookings
    ),
    calendar AS (
        SELECT d::DATE AS booking_date
        FROM bounds b,
             generate_series(b.first_day, b.last_day, INTERVAL '1 day') AS d
    ),
    daily AS (
        SELECT created_at::DATE AS booking_date, SUM(total_cost) AS daily_revenue
        FROM bookings
        WHERE property_id = p_property_id
        GROUP BY created_at::DATE
    )
    SELECT c.booking_date,
           COALESCE(d.daily_revenue, 0),
           ROUND(AVG(COALESCE(d.daily_revenue, 0)) OVER (
               ORDER BY c.booking_date
               ROWS BETWEEN 6 PRECEDING AND CURRENT ROW
           ), 2)
    FROM calendar c
    LEFT JOIN daily d ON d.booking_date = c.booking_date
    ORDER BY c.booking_date;
$$ LANGUAGE sql STABLE;

-- 2b. DENSE_RANK of all properties by 7-day moving average on ONE date (table)
CREATE OR REPLACE FUNCTION fn_property_rank(p_date DATE, p_limit INT DEFAULT 20)
RETURNS TABLE (
    property_rank   BIGINT,
    property_id     INT,
    property_title  VARCHAR,
    revenue_on_date NUMERIC,
    moving_avg_7day NUMERIC
) AS $$
    WITH calendar AS (
        -- only the 7 days that matter for this date
        SELECT p.id AS property_id, p.title, d::DATE AS day
        FROM properties p,
             generate_series(p_date - 6, p_date, INTERVAL '1 day') AS d
    ),
    daily AS (
        SELECT property_id, created_at::DATE AS day, SUM(total_cost) AS revenue
        FROM bookings
        WHERE created_at >= p_date - 6
          AND created_at <  p_date + 1
        GROUP BY property_id, created_at::DATE
    ),
    moving AS (
        SELECT c.property_id, c.title, c.day,
               COALESCE(d.revenue, 0) AS revenue,
               AVG(COALESCE(d.revenue, 0)) OVER (
                   PARTITION BY c.property_id
                   ORDER BY c.day
                   ROWS BETWEEN 6 PRECEDING AND CURRENT ROW
               ) AS mavg
        FROM calendar c
        LEFT JOIN daily d ON d.property_id = c.property_id AND d.day = c.day
    ),
    ranked AS (
        SELECT DENSE_RANK() OVER (ORDER BY mavg DESC) AS property_rank,
               property_id, title, revenue, ROUND(mavg, 2) AS mavg
        FROM moving
        WHERE day = p_date
    )
    SELECT property_rank, property_id, title, revenue, mavg
    FROM ranked
    ORDER BY property_rank, property_id
    LIMIT p_limit;
$$ LANGUAGE sql STABLE;

-- record an initial refresh so the UI has a "last refreshed" value
SELECT refresh_property_analytics();
