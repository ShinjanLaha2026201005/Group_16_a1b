// =============================================================================
// 01_collections_and_indexes.js
// StaySpot (Project 3) - MongoDB collection provisioning & index creation
//
// Creates: PropertyAmenities, PropertyReviews, SearchSessions
// With: $jsonSchema validators, a 2dsphere index + TTL index on SearchSessions,
//       and compound/secondary indexes on PropertyReviews & PropertyAmenities
//       so Workflow 3 and Workflow 4 aggregations avoid COLLSCAN.
//
// Run with:
//   mongosh "<connection_string>" mongo/01_collections_and_indexes.js
// =============================================================================

const dbName = "stayspot";
db = db.getSiblingDB(dbName);

print(`Provisioning collections in database: ${dbName}`);

// ---------------------------------------------------------------------------
// Idempotent re-runs: drop the three collections owned by this workstream
// if they already exist, so this script can be safely re-executed.
// ---------------------------------------------------------------------------
["PropertyAmenities", "PropertyReviews", "SearchSessions"].forEach((collName) => {
  if (db.getCollectionNames().includes(collName)) {
    db.getCollection(collName).drop();
    print(`Dropped existing collection: ${collName}`);
  }
});

// =============================================================================
// 1. PropertyAmenities
// =============================================================================
db.createCollection("PropertyAmenities", {
  validator: {
    $jsonSchema: {
      bsonType: "object",
      title: "PropertyAmenities Validator",
      required: ["property_id", "house_rules", "accessibility_features", "created_at"],
      properties: {
        property_id: {
          bsonType: ["string", "int", "long"],
          description: "References properties.id in PostgreSQL - required"
        },
        house_rules: {
          bsonType: "array",
          items: { bsonType: "string" },
          description: "Array of free-text house rule strings"
        },
        accessibility_features: {
          bsonType: "array",
          items: { bsonType: "string" },
          description: "Array of accessibility feature tags"
        },
        dynamic_amenities: {
          bsonType: "object",
          description: "Flexible amenity map, e.g. { wifi: true, pool: { heated: true } }"
        },
        created_at: { bsonType: "date" },
        updated_at: { bsonType: "date" }
      }
    }
  },
  validationLevel: "strict",
  validationAction: "error"
});
print("Created collection: PropertyAmenities");

db.PropertyAmenities.createIndex(
  { property_id: 1 },
  { unique: true, name: "uniq_property_id" }
);

// =============================================================================
// 2. PropertyReviews
// =============================================================================
db.createCollection("PropertyReviews", {
  validator: {
    $jsonSchema: {
      bsonType: "object",
      title: "PropertyReviews Validator",
      required: ["property_id", "guest_id", "rating", "created_at"],
      properties: {
        property_id: { bsonType: ["string", "int", "long"] },
        guest_id: { bsonType: ["string", "int", "long"] },
        rating: { bsonType: "int", minimum: 1, maximum: 5 },
        tags: {
          bsonType: "array",
          items: { bsonType: "string" }
        },
        comment: { bsonType: "string", maxLength: 2000 },
        created_at: { bsonType: "date" }
      }
    }
  },
  validationLevel: "strict",
  validationAction: "error"
});
print("Created collection: PropertyReviews");

// Compound index: powers Workflow 4's per-property rating breakdown and any
// $match on property_id ahead of the $facet stage.
db.PropertyReviews.createIndex(
  { property_id: 1, rating: -1 },
  { name: "idx_property_rating" }
);

// Multikey index on tags: powers the $unwind + $group tag-frequency sub-pipeline
// in Workflow 4 without a full collection scan.
db.PropertyReviews.createIndex(
  { tags: 1 },
  { name: "idx_tags" }
);

// Secondary index for time-window queries / recency sorting.
db.PropertyReviews.createIndex(
  { created_at: -1 },
  { name: "idx_created_at" }
);

// =============================================================================
// 3. SearchSessions
// =============================================================================
db.createCollection("SearchSessions", {
  validator: {
    $jsonSchema: {
      bsonType: "object",
      title: "SearchSessions Validator",
      required: ["session_id", "user_id", "location", "created_at"],
      properties: {
        session_id: { bsonType: "string" },
        user_id: { bsonType: ["string", "int", "long"] },
        location: {
          bsonType: "object",
          required: ["type", "coordinates"],
          properties: {
            type: { enum: ["Point"] },
            coordinates: {
              bsonType: "array",
              minItems: 2,
              maxItems: 2,
              items: { bsonType: ["double", "int"] }
            }
          }
        },
        search_radius_km: { bsonType: ["double", "int"], minimum: 0 },
        created_at: { bsonType: "date" }
      }
    }
  },
  validationLevel: "strict",
  validationAction: "error"
});
print("Created collection: SearchSessions");

// 2dsphere index - required for the $geoNear stage in Workflow 3.
db.SearchSessions.createIndex(
  { location: "2dsphere" },
  { name: "idx_location_2dsphere" }
);

// TTL index - automatically expires pings 7200 seconds (2 hours) after created_at.
db.SearchSessions.createIndex(
  { created_at: 1 },
  { expireAfterSeconds: 7200, name: "idx_created_at_ttl" }
);

// Secondary index to support per-user session lookups.
db.SearchSessions.createIndex(
  { user_id: 1 },
  { name: "idx_user_id" }
);

print("All collections and indexes provisioned successfully.\n");

print("Indexes on SearchSessions:");
printjson(db.SearchSessions.getIndexes());

print("Indexes on PropertyReviews:");
printjson(db.PropertyReviews.getIndexes());

print("Indexes on PropertyAmenities:");
printjson(db.PropertyAmenities.getIndexes());
