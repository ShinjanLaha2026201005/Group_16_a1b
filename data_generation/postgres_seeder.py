# data_generation/postgres_seeder.py

import os
import random
from datetime import datetime, timedelta
import psycopg2
from psycopg2.extras import execute_batch
from faker import Faker

# Database connection settings
DB_CONFIG = {
    "dbname": "stayspot_db",
    "user": "postgres",
    "password": "",  # Adjust password if needed
    "host": "localhost",
    "port": "5432"
}

fake = Faker()

def get_connection():
    return psycopg2.connect(**DB_CONFIG)

def seed_database():
    conn = get_connection()
    cur = conn.cursor()
    print("Connected to database. Starting seeding process...")

    # 1. Seed Guests (10,000 guests)
    print("Seeding 10,000 guests...")
    guests_data = [
        (fake.name(), round(random.uniform(500.0, 10000.0), 2))
        for _ in range(10000)
    ]
    execute_batch(
        cur,
        "INSERT INTO guests (name, wallet_balance) VALUES (%s, %s);",
        guests_data,
        page_size=2000
    )
    conn.commit()

    # Fetch guest IDs
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

    # Fetch property IDs
    cur.execute("SELECT id FROM properties;")
    property_ids = [row[0] for row in cur.fetchall()]

    # 3. Seed Bookings (50,000 rows requirement)
    print("Seeding 50,000 bookings...")
    statuses = ['CONFIRMED', 'CHECKED_IN', 'COMPLETED']
    status_weights = [0.2, 0.1, 0.7]  # Keep CHECKED_IN low to avoid partial unique index collisions

    # To honor partial unique index idx_active_stay, each guest gets at most one CHECKED_IN booking
    checked_in_guests = set()
    bookings_data = []
    
    start_date = datetime.now() - timedelta(days=90)

    for _ in range(50000):
        g_id = random.choice(guest_ids)
        p_id = random.choice(property_ids)
        cost = round(random.uniform(100.0, 3000.0), 2)
        created_at = start_date + timedelta(seconds=random.randint(0, 90 * 86400))
        
        status = random.choices(statuses, weights=status_weights)[0]
        if status == 'CHECKED_IN':
            if g_id in checked_in_guests:
                status = 'COMPLETED'
            else:
                checked_in_guests.add(g_id)

        bookings_data.append((g_id, p_id, cost, status, created_at))

    execute_batch(
        cur,
        "INSERT INTO bookings (guest_id, property_id, total_cost, status, created_at) VALUES (%s, %s, %s, %s, %s);",
        bookings_data,
        page_size=5000
    )
    conn.commit()

    # 4. Seed Wallet Audit Logs (100,000 rows requirement)
    print("Seeding 100,000 wallet audit logs...")
    actions = ['DEBIT', 'CREDIT']
    audit_data = []

    for _ in range(100000):
        g_id = random.choice(guest_ids)
        amount = round(random.uniform(10.0, 500.0), 2)
        action = random.choice(actions)
        balance_after = round(random.uniform(100.0, 15000.0), 2)
        ts = start_date + timedelta(seconds=random.randint(0, 90 * 86400))
        audit_data.append((g_id, amount, action, balance_after, ts))

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