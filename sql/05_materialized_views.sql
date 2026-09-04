-- sql/05_materialized_views.sql

DROP MATERIALIZED VIEW IF EXISTS mv_property_analytics;

-- Property analytics: completed stays, nights booked, and gross revenue
CREATE MATERIALIZED VIEW mv_property_analytics AS
SELECT 
    p.id AS property_id,
    p.title,
    COUNT(b.id) AS total_completed_bookings,
    COALESCE(SUM(b.check_out - b.check_in), 0) AS total_nights_booked,
    COALESCE(SUM(b.total_cost), 0.00) AS gross_revenue
FROM properties p
LEFT JOIN bookings b 
    ON p.id = b.property_id 
   AND b.status = 'COMPLETED'
GROUP BY p.id, p.title;

-- UNIQUE INDEX required for REFRESH CONCURRENTLY
CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_property_analytics_id 
ON mv_property_analytics (property_id);

CREATE OR REPLACE FUNCTION refresh_property_analytics()
RETURNS VOID AS $$
BEGIN
    REFRESH MATERIALIZED VIEW CONCURRENTLY mv_property_analytics;
END;
$$ LANGUAGE plpgsql;
