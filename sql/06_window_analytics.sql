-- sql/06_window_analytics.sql

WITH daily_property_revenue AS (
    -- Step 1: Aggregate daily revenue per property
    SELECT 
        p.id AS property_id,
        p.title AS property_title,
        DATE_TRUNC('day', b.created_at)::DATE AS booking_date,
        SUM(b.total_cost) AS daily_revenue
    FROM properties p
    JOIN bookings b ON p.id = b.property_id
    GROUP BY p.id, p.title, DATE_TRUNC('day', b.created_at)::DATE
),
moving_average_calc AS (
    -- Step 2: Compute 7-day moving average (current day + 6 days prior)
    SELECT 
        property_id,
        property_title,
        booking_date,
        daily_revenue,
        AVG(daily_revenue) OVER (
            PARTITION BY property_id 
            ORDER BY booking_date 
            ROWS BETWEEN 6 PRECEDING AND CURRENT ROW
        ) AS moving_avg_7day
    FROM daily_property_revenue
)
-- Step 3: Rank properties per date based on 7-day moving average
SELECT 
    property_id,
    property_title,
    booking_date,
    daily_revenue,
    ROUND(moving_avg_7day, 2) AS moving_avg_7day,
    DENSE_RANK() OVER (
        PARTITION BY booking_date 
        ORDER BY moving_avg_7day DESC
    ) AS venue_rank
FROM moving_average_calc
ORDER BY booking_date DESC, venue_rank ASC;