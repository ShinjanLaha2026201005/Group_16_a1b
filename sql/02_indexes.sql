-- sql/02_indexes.sql

-- Step 2.2: Partial unique index to prevent multiple active stays for a guest
CREATE UNIQUE INDEX IF NOT EXISTS idx_active_stay 
ON bookings (guest_id) 
WHERE status = 'CHECKED_IN';