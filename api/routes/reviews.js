// routes/reviews.js - Workflow 4: review analytics ($facet) + PropertyAmenities catalog.

const router = require('express').Router();
const { mongo } = require('../db');
const { wrap, httpError, paging, intParam } = require('../helpers');

// The Part A pipeline from mongo/03_workflow4_facet.js.
// Optional $match first (uses idx_property_rating), then one $facet that
// computes three results in a single pass over the reviews.
function facetPipeline(propertyId) {
  const pipeline = [];
  if (propertyId) pipeline.push({ $match: { property_id: propertyId } });
  pipeline.push({
    $facet: {
      ratingDistribution: [
        { $bucket: { groupBy: '$rating', boundaries: [1, 2, 3, 4, 5, 6], default: 'other', output: { count: { $sum: 1 } } } },
        { $project: { _id: 0, rating: '$_id', count: 1 } },
      ],
      topTags: [
        { $unwind: '$tags' },
        { $group: { _id: '$tags', frequency: { $sum: 1 } } },
        { $sort: { frequency: -1, _id: 1 } },
        { $limit: 10 },
        { $project: { _id: 0, tag: '$_id', frequency: 1 } },
      ],
      overallStats: [
        { $group: { _id: null, averageRating: { $avg: '$rating' }, totalReviews: { $sum: 1 } } },
        { $project: { _id: 0, averageRating: { $round: ['$averageRating', 2] }, totalReviews: 1 } },
      ],
    },
  });
  return pipeline;
}

const optionalId = (v) => (v === undefined || v === '' ? null : intParam(v, 'propertyId'));

// GET /api/reviews/facets?propertyId=   (no propertyId = all properties)
router.get('/reviews/facets', wrap(async (req, res) => {
  const propertyId = optionalId(req.query.propertyId);
  const [result] = await (await mongo()).collection('PropertyReviews').aggregate(facetPipeline(propertyId)).toArray();
  // make sure all five star levels exist, even with 0 reviews
  const dist = [1, 2, 3, 4, 5].map((r) => ({
    rating: r,
    count: (result.ratingDistribution.find((d) => d.rating === r) || { count: 0 }).count,
  }));
  res.json({
    propertyId,
    ratingDistribution: dist,
    topTags: result.topTags,
    overallStats: result.overallStats[0] || { averageRating: null, totalReviews: 0 },
  });
}));

// GET /api/reviews?propertyId=&page=&limit=  -> latest reviews
router.get('/reviews', wrap(async (req, res) => {
  const propertyId = optionalId(req.query.propertyId);
  const { page, limit, offset } = paging(req.query, 10);
  const filter = propertyId ? { property_id: propertyId } : {};
  const col = (await mongo()).collection('PropertyReviews');
  const [rows, total] = await Promise.all([
    col.find(filter, { projection: { _id: 0 } }).sort({ created_at: -1 }).skip(offset).limit(limit).toArray(),
    col.countDocuments(filter),
  ]);
  res.json({ rows, total, page, limit });
}));

// GET /api/amenities/:propertyId  -> the flexible PropertyAmenities document
router.get('/amenities/:propertyId', wrap(async (req, res) => {
  const propertyId = intParam(req.params.propertyId, 'Property id');
  const doc = await (await mongo()).collection('PropertyAmenities')
    .findOne({ property_id: propertyId }, { projection: { _id: 0 } });
  if (!doc) throw httpError(404, `No amenities document for property #${propertyId}.`);
  res.json(doc);
}));

module.exports = router;
