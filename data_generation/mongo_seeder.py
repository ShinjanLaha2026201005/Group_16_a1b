#!/usr/bin/env python3
"""
mongo_seeder.py
StaySpot (Project 3) - MongoDB mock data generator

Seeds three collections with realistic, high-volume mock data:

  - SearchSessions:      500,000+ geospatial search pings (GeoJSON Points),
                         timestamped within the last 2 hours (matching the
                         TTL window), clustered around a handful of
                         realistic city "hotspot" centers plus background
                         noise so Workflow 3's clustering query returns
                         meaningful hotspots.
  - PropertyAmenities:   one flexible document per property.
  - PropertyReviews:     10,000+ structured reviews spread across properties.

Uses pymongo bulk_write with InsertOne operations in batches of 10,000 for
high-throughput inserts, with per-collection progress bars and timing.

Usage:
  pip install -r requirements.txt
  python mongo_seeder.py --uri "mongodb://localhost:27017" --db stayspot
  python mongo_seeder.py --sessions 500000 --reviews 12000 --properties 5000 --drop-existing
"""

import argparse
import math
import random
import sys
import time
from datetime import datetime, timedelta, timezone

from faker import Faker
from pymongo import MongoClient, InsertOne
from pymongo.errors import BulkWriteError
from tqdm import tqdm

fake = Faker()

BATCH_SIZE = 10_000

# Realistic hotspot centers (longitude, latitude) that search traffic
# clusters around, so Workflow 3's grid-clustering query returns
# meaningful, non-uniform hotspots instead of pure noise.
HOTSPOT_CENTERS = [
    (77.5946, 12.9716),   # Bengaluru
    (72.8777, 19.0760),   # Mumbai
    (77.2090, 28.6139),   # Delhi
    (80.2707, 13.0827),   # Chennai
    (88.3639, 22.5726),   # Kolkata
]

HOUSE_RULE_POOL = [
    "No smoking indoors", "No parties or events", "Check-in after 2 PM",
    "Check-out before 11 AM", "No pets allowed", "Pets allowed with prior approval",
    "Quiet hours after 10 PM", "No unregistered guests", "Suitable for children",
    "Not suitable for infants", "ID proof mandatory at check-in", "No smoking on balcony",
]

ACCESSIBILITY_POOL = [
    "Step-free entrance", "Wide doorways", "Elevator access", "Accessible bathroom",
    "Grab rails in bathroom", "Ground-floor bedroom", "Visual alarms",
    "Wheelchair accessible parking",
]

REVIEW_TAG_POOL = [
    "clean", "spacious", "great_location", "responsive_host", "value_for_money",
    "noisy", "beautiful_view", "comfortable_bed", "well_equipped_kitchen",
    "poor_wifi", "family_friendly", "romantic", "close_to_transit", "quiet_neighborhood",
]

AMENITY_KEYS = [
    "wifi", "pool", "air_conditioning", "kitchen", "free_parking",
    "washer", "workspace", "tv", "hot_tub", "fireplace", "bbq_grill", "gym",
]


def random_point_near(center_lon: float, center_lat: float, spread_km: float = 8.0) -> dict:
    """Return a GeoJSON Point randomly offset from a center, roughly within spread_km."""
    lat_offset_km = random.uniform(-1, 1) * spread_km
    lon_offset_km = random.uniform(-1, 1) * spread_km
    # ~1 degree latitude is ~111km everywhere; longitude degrees shrink by cos(latitude).
    lat = center_lat + (lat_offset_km / 111.0)
    lon = center_lon + (lon_offset_km / (111.0 * math.cos(math.radians(center_lat))))
    return {"type": "Point", "coordinates": [round(lon, 6), round(lat, 6)]}


def random_recent_timestamp(max_age_minutes: int = 120) -> datetime:
    """A timestamp uniformly distributed within the last `max_age_minutes` minutes."""
    now = datetime.now(timezone.utc)
    delta_seconds = random.uniform(0, max_age_minutes * 60)
    return now - timedelta(seconds=delta_seconds)


def build_search_session_doc(session_index: int) -> dict:
    center_lon, center_lat = random.choice(HOTSPOT_CENTERS)
    # 85% of traffic clusters tightly near a hotspot; 15% is wider background noise.
    spread_km = 3.0 if random.random() < 0.85 else 25.0
    return {
        "session_id": f"sess_{session_index:09d}_{fake.uuid4()[:8]}",
        "user_id": f"user_{random.randint(1, 50_000)}",
        "location": random_point_near(center_lon, center_lat, spread_km=spread_km),
        "search_radius_km": round(random.choice([1, 2, 5, 10, 15, 25]) * random.uniform(0.8, 1.2), 2),
        "created_at": random_recent_timestamp(max_age_minutes=120),
    }


def build_property_amenity_doc(property_id: int) -> dict:
    dynamic_amenities = {
        key: random.choice([True, False])
        for key in random.sample(AMENITY_KEYS, k=random.randint(4, len(AMENITY_KEYS)))
    }
    now = datetime.now(timezone.utc)
    return {
        "property_id": property_id,
        "house_rules": random.sample(HOUSE_RULE_POOL, k=random.randint(3, 6)),
        "accessibility_features": random.sample(ACCESSIBILITY_POOL, k=random.randint(0, 4)),
        "dynamic_amenities": dynamic_amenities,
        "created_at": now - timedelta(days=random.randint(30, 700)),
        "updated_at": now - timedelta(days=random.randint(0, 29)),
    }


def build_review_doc(property_id: int) -> dict:
    # Skewed towards positive ratings, as is typical for real review data.
    rating = random.choices([1, 2, 3, 4, 5], weights=[3, 5, 12, 35, 45])[0]
    return {
        "property_id": property_id,
        "guest_id": f"guest_{random.randint(1, 40_000)}",
        "rating": rating,
        "tags": random.sample(REVIEW_TAG_POOL, k=random.randint(1, 4)),
        "comment": fake.paragraph(nb_sentences=random.randint(1, 4)),
        "created_at": datetime.now(timezone.utc) - timedelta(days=random.randint(0, 400)),
    }


def _flush(collection, batch):
    try:
        collection.bulk_write(batch, ordered=False)
    except BulkWriteError as bwe:
        print("Bulk write error:", bwe.details, file=sys.stderr)
        raise


def bulk_insert(collection, doc_generator, total: int, label: str) -> int:
    """Insert `total` documents produced by doc_generator(i) in batches of BATCH_SIZE."""
    start = time.time()
    inserted = 0
    batch = []
    with tqdm(total=total, desc=label, unit="docs") as pbar:
        for i in range(total):
            batch.append(InsertOne(doc_generator(i)))
            if len(batch) >= BATCH_SIZE:
                _flush(collection, batch)
                inserted += len(batch)
                pbar.update(len(batch))
                batch = []
        if batch:
            _flush(collection, batch)
            inserted += len(batch)
            pbar.update(len(batch))
    elapsed = time.time() - start
    rate = inserted / max(elapsed, 1e-9)
    print(f"[{label}] Inserted {inserted:,} documents in {elapsed:.2f}s ({rate:,.0f} docs/sec)")
    return inserted


def main():
    parser = argparse.ArgumentParser(description="Seed StaySpot MongoDB collections with mock data.")
    parser.add_argument("--uri", default="mongodb://localhost:27017", help="MongoDB connection URI")
    parser.add_argument("--db", default="stayspot", help="Target database name")
    parser.add_argument("--properties", type=int, default=5_000, help="Number of properties to generate amenities for")
    parser.add_argument("--reviews", type=int, default=12_000, help="Number of PropertyReviews documents (>= 10,000 required)")
    parser.add_argument("--sessions", type=int, default=550_000, help="Number of SearchSessions documents (>= 500,000 required)")
    parser.add_argument("--drop-existing", action="store_true", help="Delete existing documents in target collections before seeding")
    args = parser.parse_args()

    print(f"Connecting to {args.uri} (db={args.db}) ...")
    client = MongoClient(args.uri)
    db = client[args.db]

    if args.drop_existing:
        for name in ["PropertyAmenities", "PropertyReviews", "SearchSessions"]:
            result = db[name].delete_many({})
            print(f"Cleared {result.deleted_count:,} existing docs from {name}")

    overall_start = time.time()

    # 1. PropertyAmenities: one document per property (property_id 1..N)
    bulk_insert(
        db.PropertyAmenities,
        lambda i: build_property_amenity_doc(property_id=i + 1),
        args.properties,
        "PropertyAmenities",
    )

    # 2. PropertyReviews: spread across the same property_id range
    bulk_insert(
        db.PropertyReviews,
        lambda i: build_review_doc(property_id=random.randint(1, args.properties)),
        args.reviews,
        "PropertyReviews",
    )

    # 3. SearchSessions: high-volume geospatial pings
    bulk_insert(
        db.SearchSessions,
        lambda i: build_search_session_doc(session_index=i),
        args.sessions,
        "SearchSessions",
    )

    total_elapsed = time.time() - overall_start
    print(f"\nSeeding complete in {total_elapsed:.2f}s total.")
    print("Final document counts:")
    for name in ["PropertyAmenities", "PropertyReviews", "SearchSessions"]:
        print(f"  {name}: {db[name].count_documents({}):,}")

    client.close()


if __name__ == "__main__":
    main()
