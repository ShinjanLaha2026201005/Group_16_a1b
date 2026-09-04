-- sql/02_indexes.sql

-- Partial unique index: at most one CHECKED_IN booking per guest
DROP INDEX IF EXISTS idx_active_stay;
CREATE UNIQUE INDEX idx_active_stay
ON bookings (guest_id)
WHERE status = 'CHECKED_IN';

-- Secondary indexes for analytics / FK lookup patterns
DROP INDEX IF EXISTS idx_bookings_property_id;
CREATE INDEX idx_bookings_property_id
ON bookings (property_id);

DROP INDEX IF EXISTS idx_bookings_property_status;
CREATE INDEX idx_bookings_property_status
ON bookings (property_id, status);

DROP INDEX IF EXISTS idx_bookings_created_at;
CREATE INDEX idx_bookings_created_at
ON bookings (created_at);
