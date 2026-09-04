-- sql/01_schema_ddl.sql

-- Step 1.1: Create guests Table
-- name, email, and phone_number are each unique

CREATE TABLE IF NOT EXISTS guests (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL UNIQUE,
    email VARCHAR(255) UNIQUE, -- nullable by design (guest may omit email)
    phone_number VARCHAR(20) NOT NULL UNIQUE,
    wallet_balance DECIMAL(10, 2) NOT NULL DEFAULT 0.00 CHECK (wallet_balance >= 0.00)
);

-- Step 1.2: Create wallet_audit_logs Table

CREATE TABLE IF NOT EXISTS wallet_audit_logs (
    id SERIAL PRIMARY KEY,
    guest_id INT NOT NULL REFERENCES guests(id) ON DELETE CASCADE,
    amount_changed DECIMAL(10, 2) NOT NULL,
    action_type VARCHAR(20) NOT NULL CHECK (action_type IN ('DEBIT', 'CREDIT')),
    balance_after DECIMAL(10, 2) NOT NULL CHECK (balance_after >= 0.00),
    timestamp TIMESTAMPTZ DEFAULT NOW()
);


-- Step 1.3: Properties Table
-- base_price is the per-night listing price
CREATE TABLE IF NOT EXISTS properties (
    id SERIAL PRIMARY KEY,
    title VARCHAR(255) NOT NULL,
    base_price DECIMAL(10, 2) NOT NULL CHECK (base_price >= 0.00),
    latitude FLOAT NOT NULL,
    longitude FLOAT NOT NULL
);

-- Step 1.4: Bookings Table
-- total_cost = nights * properties.base_price, where nights = check_out - check_in
CREATE TABLE IF NOT EXISTS bookings (
    id SERIAL PRIMARY KEY,
    guest_id INT NOT NULL REFERENCES guests(id) ON DELETE CASCADE,
    property_id INT NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
    check_in DATE NOT NULL,
    check_out DATE NOT NULL,
    total_cost DECIMAL(10, 2) NOT NULL CHECK (total_cost >= 0.00),
    status VARCHAR(20) NOT NULL CHECK (status IN ('CONFIRMED', 'CHECKED_IN', 'COMPLETED')),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT chk_booking_dates CHECK (check_out > check_in)
);
