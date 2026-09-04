// =============================================================================
// 03_workflow4_facet.js
// StaySpot (Project 3) - Workflow 4: Multi-Faceted Review Analytics
//
// In a single pass over PropertyReviews (optionally scoped to one property),
// computes simultaneously:
//   1) Rating distribution (counts for 1-5 stars)
//   2) Most frequent review tags, ranked by frequency
//   3) Overall average rating + total review count
//
// Run with:
//   mongosh "<connection_string>" mongo/03_workflow4_facet.js
//
// Scope to a single property without editing the file:
//   mongosh "<connection_string>" \
//     --eval "var FILTER_PROPERTY_ID = 1042" \
//     mongo/03_workflow4_facet.js
// =============================================================================

db = db.getSiblingDB("stayspot");

// ---------------------------------------------------------------------------
// Parameters (override via --eval as shown above). null = global analytics.
// ---------------------------------------------------------------------------
const filterPropertyId = typeof FILTER_PROPERTY_ID !== "undefined" ? FILTER_PROPERTY_ID : null;

function buildPipeline() {
  const pipeline = [];

  // Optional $match FIRST so it can use idx_property_rating and narrow the
  // working set before the $facet stage fans out into three sub-pipelines.
  if (filterPropertyId !== null) {
    pipeline.push({ $match: { property_id: filterPropertyId } });
  }

  pipeline.push({
    $facet: {
      // Sub-pipeline 1: rating distribution via $bucket over the 1-5 range.
      ratingDistribution: [
        {
          $bucket: {
            groupBy: "$rating",
            boundaries: [1, 2, 3, 4, 5, 6],
            default: "other",
            output: { count: { $sum: 1 } }
          }
        },
        {
          $project: { _id: 0, rating: "$_id", count: 1 }
        }
      ],
      // Sub-pipeline 2: most frequent tags via $unwind + $group, ranked.
      topTags: [
        { $unwind: "$tags" },
        { $group: { _id: "$tags", frequency: { $sum: 1 } } },
        { $sort: { frequency: -1 } },
        { $limit: 10 },
        { $project: { _id: 0, tag: "$_id", frequency: 1 } }
      ],
      // Sub-pipeline 3: overall average rating + total review count.
      overallStats: [
        {
          $group: {
            _id: null,
            averageRating: { $avg: "$rating" },
            totalReviews: { $sum: 1 }
          }
        },
        {
          $project: { _id: 0, averageRating: { $round: ["$averageRating", 2] }, totalReviews: 1 }
        }
      ]
    }
  });

  return pipeline;
}

print("Workflow 4: Multi-Faceted Review Analytics");
print(filterPropertyId !== null ? `Scoped to property_id: ${filterPropertyId}` : "Scope: all properties");
print("");

const result = db.PropertyReviews.aggregate(buildPipeline()).toArray();
printjson(result);

// ---------------------------------------------------------------------------
// Performance proof: EXPLAIN executionStats
// Confirms the optional $match (when present) hits idx_property_rating, and
// that no stage falls back to a full COLLSCAN over PropertyReviews.
// ---------------------------------------------------------------------------
print("\n--- EXPLAIN (executionStats) ---");
const explainOutput = db.PropertyReviews.explain("executionStats").aggregate(buildPipeline());
printjson(explainOutput);
