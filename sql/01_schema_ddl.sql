-- sql/01_schema_ddl.sql

-- Step 1.1: Create guests Table

CREATE TABLE IF NOT EXISTS guests (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
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
CREATE TABLE IF NOT EXISTS properties (
    id SERIAL PRIMARY KEY,
    title VARCHAR(255) NOT NULL,
    base_price DECIMAL(10, 2) NOT NULL CHECK (base_price >= 0.00),
    latitude FLOAT NOT NULL,
    longitude FLOAT NOT NULL
);

-- Step 1.4: Bookings Table
CREATE TABLE IF NOT EXISTS bookings (
    id SERIAL PRIMARY KEY,
    guest_id INT NOT NULL REFERENCES guests(id) ON DELETE CASCADE,
    property_id INT NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
    total_cost DECIMAL(10, 2) NOT NULL CHECK (total_cost >= 0.00),
    status VARCHAR(20) NOT NULL CHECK (status IN ('CONFIRMED', 'CHECKED_IN', 'COMPLETED')),
    created_at TIMESTAMPTZ DEFAULT NOW()
);