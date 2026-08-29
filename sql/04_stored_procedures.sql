-- sql/04_stored_procedures.sql

CREATE OR REPLACE PROCEDURE sp_execute_booking(
    p_guest_id INT,
    p_property_id INT,
    p_total_cost DECIMAL(10, 2)
)
LANGUAGE plpgsql
AS $$
DECLARE
    v_current_balance DECIMAL(10, 2);
BEGIN
    -- 1. Verify guest existence and fetch current balance with a row-level lock
    SELECT wallet_balance INTO v_current_balance
    FROM guests
    WHERE id = p_guest_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Guest ID % does not exist.', p_guest_id;
    END IF;

    -- 2. Explicitly check for sufficient balance prior to update
    IF v_current_balance < p_total_cost THEN
        RAISE EXCEPTION 'Insufficient wallet balance. Current: %, Required: %', v_current_balance, p_total_cost;
    END IF;

    -- 3. Deduct balance from guest (triggers automated wallet audit log)
    UPDATE guests
    SET wallet_balance = wallet_balance - p_total_cost
    WHERE id = p_guest_id;

    -- 4. Create the booking entry
    INSERT INTO bookings (guest_id, property_id, total_cost, status)
    VALUES (p_guest_id, p_property_id, p_total_cost, 'CONFIRMED');

    RAISE NOTICE 'Booking successfully completed for Guest % at Property % for amount %', p_guest_id, p_property_id, p_total_cost;

EXCEPTION
    WHEN OTHERS THEN
        -- Transaction automatically rolls back on unhandled error; re-raise for clarity
        RAISE EXCEPTION 'Transaction failed: %', SQLERRM;
END;
$$;