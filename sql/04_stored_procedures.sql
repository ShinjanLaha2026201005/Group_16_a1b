-- Workflow 1: Atomic booking.
-- Uses REPEATABLE READ. On any failure, RAISE aborts the transaction
-- before COMMIT, so PostgreSQL rolls back cleanly.

CREATE OR REPLACE PROCEDURE sp_execute_booking(
    p_guest_id INT,
    p_property_id INT,
    p_check_in DATE,
    p_check_out DATE,
    p_total_cost DECIMAL(10, 2)
)
LANGUAGE plpgsql
AS $$
DECLARE
    v_current_balance DECIMAL(10, 2);
    v_base_price DECIMAL(10, 2);
    v_nights INT;
    v_expected_cost DECIMAL(10, 2);
BEGIN
    -- End the CALL's implicit transaction so isolation level can be set
    COMMIT;
    SET TRANSACTION ISOLATION LEVEL REPEATABLE READ;

    -- 1. Validate stay dates
    IF p_check_in IS NULL OR p_check_out IS NULL THEN
        RAISE EXCEPTION 'check_in and check_out are required.';
    END IF;

    IF p_check_out <= p_check_in THEN
        RAISE EXCEPTION 'check_out (%) must be after check_in (%).', p_check_out, p_check_in;
    END IF;

    v_nights := p_check_out - p_check_in;

    -- 2. Verify property exists and lock row
    SELECT base_price INTO v_base_price
    FROM properties
    WHERE id = p_property_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Property ID % does not exist.', p_property_id;
    END IF;

    v_expected_cost := ROUND(v_nights * v_base_price, 2);

    -- 3. Ensure total matches nights * base_price
    IF p_total_cost <> v_expected_cost THEN
        RAISE EXCEPTION 'Total cost % does not match expected %.', p_total_cost, v_expected_cost;
    END IF;

    -- 4. Verify guest and lock wallet row
    SELECT wallet_balance INTO v_current_balance
    FROM guests
    WHERE id = p_guest_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Guest ID % does not exist.', p_guest_id;
    END IF;

    -- 5. Balance check (CHECK constraint also enforces wallet_balance >= 0)
    IF v_current_balance < v_expected_cost THEN
        RAISE EXCEPTION 'Insufficient balance. Current: %, Required: %',
            v_current_balance, v_expected_cost;
    END IF;

    -- 6. Deduct balance (fires wallet audit trigger)
    UPDATE guests
    SET wallet_balance = wallet_balance - v_expected_cost
    WHERE id = p_guest_id;

    -- 7. Insert booking
    INSERT INTO bookings (
        guest_id, property_id, check_in, check_out, total_cost, status
    )
    VALUES (
        p_guest_id, p_property_id, p_check_in, p_check_out, v_expected_cost, 'CONFIRMED'
    );

    COMMIT;
    RAISE NOTICE 'Booking successfully completed for Guest %', p_guest_id;
END;
$$;
