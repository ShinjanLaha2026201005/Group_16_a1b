-- sql/05_materialized_views.sql

-- 1. Create the Materialized View for property revenue and completed stays
CREATE MATERIALIZED VIEW IF NOT EXISTS mv_property_analytics AS
SELECT 
    p.id AS property_id,
    p.title,
    COUNT(b.id) AS total_completed_bookings,
    COALESCE(SUM(b.total_cost), 0.00) AS gross_revenue
FROM properties p
LEFT JOIN bookings b 
    ON p.id = b.property_id 
   AND b.status = 'COMPLETED'
GROUP BY p.id, p.title;

-- 2. Create a UNIQUE INDEX on the materialized view (Required for CONCURRENT refresh)
CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_property_analytics_id 
ON mv_property_analytics (property_id);

-- 3. Create the function to refresh the view concurrently
CREATE OR REPLACE FUNCTION refresh_property_analytics()
RETURNS VOID AS $$
BEGIN
    REFRESH MATERIALIZED VIEW CONCURRENTLY mv_property_analytics;
END;
$$ LANGUAGE plpgsql;