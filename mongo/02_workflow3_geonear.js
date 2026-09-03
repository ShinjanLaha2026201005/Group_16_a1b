// =============================================================================
// 02_workflow3_geonear.js
// StaySpot (Project 3) - Workflow 3: Trending Search Hotspots
//
// Finds recent SearchSessions within a 5km radius of a target coordinate,
// then clusters the results into grid-based hotspots ranked by search
// density, so the product team can see where demand is concentrating.
//
// Run with:
//   mongosh "<connection_string>" mongo/02_workflow3_geonear.js
//
// Override the target point / lookback window without editing the file:
//   mongosh "<connection_string>" \
//     --eval "var TARGET_LON=77.6033, TARGET_LAT=12.9698, LOOKBACK_MINUTES=120" \
//     mongo/02_workflow3_geonear.js
// =============================================================================

db = db.getSiblingDB("stayspot");

// ---------------------------------------------------------------------------
// Parameters (override via --eval as shown above)
// ---------------------------------------------------------------------------
const centerLongitude = typeof TARGET_LON !== "undefined" ? TARGET_LON : 77.5946; // default: Bengaluru
const centerLatitude  = typeof TARGET_LAT !== "undefined" ? TARGET_LAT : 12.9716;
const maxDistanceMeters = 5000; // 5 km, as required by the assignment
const lookbackMinutes = typeof LOOKBACK_MINUTES !== "undefined" ? LOOKBACK_MINUTES : 120; // full TTL window

const sinceTimestamp = new Date(Date.now() - lookbackMinutes * 60 * 1000);

// Grid cell size in degrees used to cluster raw pings into hotspots.
// ~0.01 degrees is roughly 1.1km at the equator.
const GRID_SIZE = 0.01;

function buildPipeline() {
  return [
    // Stage 1: $geoNear MUST be the first stage in the pipeline. It uses the
    // idx_location_2dsphere index to prune to the 5km radius efficiently.
    {
      $geoNear: {
        near: { type: "Point", coordinates: [centerLongitude, centerLatitude] },
        distanceField: "distance_meters",
        maxDistance: maxDistanceMeters,
        spherical: true,
        query: { created_at: { $gte: sinceTimestamp } }
      }
    },
    // Stage 2: snap each ping to a coarse lat/lon grid cell for clustering.
    {
      $addFields: {
        grid_lon: {
          $multiply: [
            { $floor: { $divide: [{ $arrayElemAt: ["$location.coordinates", 0] }, GRID_SIZE] } },
            GRID_SIZE
          ]
        },
        grid_lat: {
          $multiply: [
            { $floor: { $divide: [{ $arrayElemAt: ["$location.coordinates", 1] }, GRID_SIZE] } },
            GRID_SIZE
          ]
        }
      }
    },
    // Stage 3: aggregate density per grid cell.
    {
      $group: {
        _id: { grid_lon: "$grid_lon", grid_lat: "$grid_lat" },
        search_count: { $sum: 1 },
        avg_distance_m: { $avg: "$distance_meters" },
        avg_radius_km: { $avg: "$search_radius_km" },
        sample_session_ids: { $push: "$session_id" }
      }
    },
    // Stage 4: shape the output into a hotspot record.
    {
      $project: {
        _id: 0,
        hotspot_center: {
          type: "Point",
          coordinates: ["$_id.grid_lon", "$_id.grid_lat"]
        },
        search_count: 1,
        avg_distance_m: { $round: ["$avg_distance_m", 1] },
        avg_radius_km: { $round: ["$avg_radius_km", 2] },
        sample_session_ids: { $slice: ["$sample_session_ids", 5] }
      }
    },
    { $sort: { search_count: -1 } },
    { $limit: 20 }
  ];
}

print(`Workflow 3: Trending Search Hotspots`);
print(`Center: [${centerLongitude}, ${centerLatitude}], radius: ${maxDistanceMeters}m`);
print(`Lookback window: last ${lookbackMinutes} minutes (since ${sinceTimestamp.toISOString()})\n`);

const results = db.SearchSessions.aggregate(buildPipeline()).toArray();
print(`Found ${results.length} hotspot clusters:`);
printjson(results);

// ---------------------------------------------------------------------------
// Performance proof: EXPLAIN executionStats
// The winning plan for the $geoNear stage must show GEO_NEAR_2DSPHERE against
// idx_location_2dsphere, not a COLLSCAN, proving the index is actually used.
// ---------------------------------------------------------------------------
print("\n--- EXPLAIN (executionStats) ---");
const explainOutput = db.SearchSessions.explain("executionStats").aggregate(buildPipeline());
printjson(explainOutput);
