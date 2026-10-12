# data_generation/postgres_seeder.py

import os
import random
from datetime import datetime, timedelta, date
import psycopg2
from psycopg2.extras import execute_batch
from faker import Faker

# Database connection settings
# [A2 fix] Read connection settings from environment variables instead of a
# hardcoded empty password, so the same script runs on every team member's machine.
DB_CONFIG = {
    "dbname": os.getenv("PGDATABASE", "stayspot_db"),
    "user": os.getenv("PGUSER", "postgres"),
    "password": os.getenv("PGPASSWORD", ""),
    "host": os.getenv("PGHOST", "localhost"),
    "port": os.getenv("PGPORT", "5432"),
}

fake = Faker()

def get_connection():
    return psycopg2.connect(**DB_CONFIG)

def seed_database():
    conn = get_connection()
    cur = conn.cursor()
    print("Connected to database. Starting seeding process...")

    # [A2 fix] Make the seeder re-runnable: clear old rows and reset the SERIAL ids.
    cur.execute("TRUNCATE wallet_audit_logs, bookings, properties, guests RESTART IDENTITY CASCADE;")
    conn.commit()

    # 1. Seed Guests (10,000 guests) — unique name/phone; email optional (nullable)
    print("Seeding 10,000 guests...")
    guests_data = []
    for i in range(10000):
        # ~15% of guests omit email (NULL allowed by schema)
        email = None if i % 7 == 0 else f"guest{i + 1}@stayspot.example"
        guests_data.append((
            f"{fake.name()} #{i + 1}",
            email,
            f"+91{7000000000 + i}",
            round(random.uniform(500.0, 10000.0), 2)
        ))
    execute_batch(
        cur,
        "INSERT INTO guests (name, email, phone_number, wallet_balance) VALUES (%s, %s, %s, %s);",
        guests_data,
        page_size=2000
    )
    conn.commit()

    cur.execute("SELECT id FROM guests;")
    guest_ids = [row[0] for row in cur.fetchall()]

    # 2. Seed Properties (2,000 properties)
    print("Seeding 2,000 properties...")
    properties_data = [
        (
            fake.catch_phrase(),
            round(random.uniform(50.0, 800.0), 2),
            float(fake.latitude()),
            float(fake.longitude())
        )
        for _ in range(2000)
    ]
    execute_batch(
        cur,
        "INSERT INTO properties (title, base_price, latitude, longitude) VALUES (%s, %s, %s, %s);",
        properties_data,
        page_size=2000
    )
    conn.commit()

    cur.execute("SELECT id, base_price FROM properties;")
    properties = cur.fetchall()

    # 3. Seed Bookings (50,000 rows requirement)
    print("Seeding 50,000 bookings...")
    statuses = ['CONFIRMED', 'CHECKED_IN', 'COMPLETED']
    status_weights = [0.2, 0.1, 0.7]  # Keep CHECKED_IN low to avoid partial unique index collisions

    checked_in_guests = set()
    bookings_data = []

    start_date = datetime.now() - timedelta(days=90)
    today = date.today()

    for _ in range(50000):
        g_id = random.choice(guest_ids)
        p_id, base_price = random.choice(properties)
        nights = random.randint(2, 3)
        check_in = today - timedelta(days=random.randint(0, 80))
        check_out = check_in + timedelta(days=nights)
        total_cost = round(float(base_price) * nights, 2)
        created_at = start_date + timedelta(seconds=random.randint(0, 90 * 86400))

        status = random.choices(statuses, weights=status_weights)[0]
        if status == 'CHECKED_IN':
            if g_id in checked_in_guests:
                status = 'COMPLETED'
            else:
                checked_in_guests.add(g_id)

        bookings_data.append((g_id, p_id, check_in, check_out, total_cost, status, created_at))

    execute_batch(
        cur,
        """
        INSERT INTO bookings (guest_id, property_id, check_in, check_out, total_cost, status, created_at)
        VALUES (%s, %s, %s, %s, %s, %s, %s);
        """,
        bookings_data,
        page_size=5000
    )
    conn.commit()

    # 4. Seed Wallet Audit Logs (100,000 rows requirement)
    # [A2 fix] The original seeder generated random balance_after values that had
    # nothing to do with the guest's real wallet. Here every guest gets a
    # chronological history that ENDS at their current wallet_balance, so the
    # running balance shown in the Audit Trail screen is consistent.
    print("Seeding 100,000 wallet audit logs...")
    audit_data = []

    cur.execute("SELECT id, wallet_balance FROM guests ORDER BY id;")
    guest_balances = cur.fetchall()
    per_guest = 100000 // len(guest_balances)

    for g_id, current_balance in guest_balances:
        balance_after = float(current_balance)
        # timestamps ascending; we walk BACKWARDS from the newest entry
        stamps = sorted(
            start_date + timedelta(seconds=random.randint(0, 90 * 86400))
            for _ in range(per_guest)
        )
        rows = []
        for ts in reversed(stamps):
            amount = round(random.uniform(10.0, 500.0), 2)
            # a CREDIT means the balance before was lower; only allowed if it stays >= 0
            if balance_after - amount >= 0 and random.random() < 0.5:
                action = 'CREDIT'
                balance_before = balance_after - amount
            else:
                action = 'DEBIT'
                balance_before = balance_after + amount
            rows.append((g_id, amount, action, round(balance_after, 2), ts))
            balance_after = round(balance_before, 2)
        audit_data.extend(reversed(rows))

    execute_batch(
        cur,
        "INSERT INTO wallet_audit_logs (guest_id, amount_changed, action_type, balance_after, timestamp) VALUES (%s, %s, %s, %s, %s);",
        audit_data,
        page_size=5000
    )
    conn.commit()

    cur.close()
    conn.close()
    print("Database seeding completed successfully!")

if __name__ == "__main__":
    seed_database()
