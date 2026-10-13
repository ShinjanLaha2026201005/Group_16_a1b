// routes/hotspots.js - Workflow 3: search hotspots around an origin ($geoNear).

const router = require('express').Router();
const crypto = require('crypto');
const { mongo } = require('../db');
const { wrap, httpError } = require('../helpers');

const RADIUS_M = 5000;   // 5 km, as required
const GRID_SIZE = 0.01;  // ~1.1 km grid cells used to cluster pings (same as mongo/02)

// Same cities the Mongo seeder clusters its search traffic around.
const PRESETS = [
  { name: 'Bengaluru', lat: 12.9716, lng: 77.5946 },
  { name: 'Mumbai', lat: 19.0760, lng: 72.8777 },
  { name: 'Delhi', lat: 28.6139, lng: 77.2090 },
  { name: 'Chennai', lat: 13.0827, lng: 80.2707 },
  { name: 'Kolkata', lat: 22.5726, lng: 88.3639 },
];

function readOrigin(q) {
  const lat = Number(q.lat);
  const lng = Number(q.lng);
  if (!Number.isFinite(lat) || lat < -90 || lat > 90 || !Number.isFinite(lng) || lng < -180 || lng > 180) {
    throw httpError(400, 'lat must be between -90 and 90 and lng between -180 and 180.');
  }
  return { lat, lng };
}

// The Part A pipeline from mongo/02_workflow3_geonear.js.
// $geoNear must be the FIRST stage so it can use the 2dsphere index.
function hotspotPipeline(lat, lng, since) {
  return [
    {
      $geoNear: {
        near: { type: 'Point', coordinates: [lng, lat] },
        distanceField: 'distance_meters',
        maxDistance: RADIUS_M,
        spherical: true,
        query: { created_at: { $gte: since } },
      },
    },
    {
      $addFields: {
        grid_lon: { $multiply: [{ $floor: { $divide: [{ $arrayElemAt: ['$location.coordinates', 0] }, GRID_SIZE] } }, GRID_SIZE] },
        grid_lat: { $multiply: [{ $floor: { $divide: [{ $arrayElemAt: ['$location.coordinates', 1] }, GRID_SIZE] } }, GRID_SIZE] },
      },
    },
    {
      $group: {
        _id: { grid_lon: '$grid_lon', grid_lat: '$grid_lat' },
        search_count: { $sum: 1 },
        avg_distance_m: { $avg: '$distance_meters' },
        avg_radius_km: { $avg: '$search_radius_km' },
        newest: { $max: '$created_at' },
      },
    },
    {
      $project: {
        _id: 0,
        // centre of the grid cell, so the marker sits in the middle of the cluster
        lat: { $add: ['$_id.grid_lat', GRID_SIZE / 2] },
        lng: { $add: ['$_id.grid_lon', GRID_SIZE / 2] },
        search_count: 1,
        avg_distance_m: { $round: ['$avg_distance_m', 0] },
        avg_radius_km: { $round: ['$avg_radius_km', 2] },
        newest: 1,
      },
    },
    { $sort: { search_count: -1 } },
    { $limit: 20 },
  ];
}

// GET /api/hotspots/presets
router.get('/hotspots/presets', (req, res) => res.json(PRESETS));

// GET /api/hotspots?lat=&lng=&minutes=120
router.get('/hotspots', wrap(async (req, res) => {
  const { lat, lng } = readOrigin(req.query);
  const minutes = Math.min(120, Math.max(1, parseInt(req.query.minutes, 10) || 120));
  const since = new Date(Date.now() - minutes * 60 * 1000);
  const col = (await mongo()).collection('SearchSessions');

  const hotspots = await col.aggregate(hotspotPipeline(lat, lng, since)).toArray();

  // Individual recent pings, nearest first (for the list next to the map).
  const nearest = await col.aggregate([
    {
      $geoNear: {
        near: { type: 'Point', coordinates: [lng, lat] },
        distanceField: 'distance_meters',
        maxDistance: RADIUS_M,
        spherical: true,
        query: { created_at: { $gte: since } },
      },
    },
    { $limit: 25 },
    { $project: { _id: 0, session_id: 1, user_id: 1, created_at: 1, search_radius_km: 1,
                  distance_meters: { $round: ['$distance_meters', 0] },
                  lat: { $arrayElemAt: ['$location.coordinates', 1] },
                  lng: { $arrayElemAt: ['$location.coordinates', 0] } } },
  ]).toArray();

  const total = hotspots.reduce((s, h) => s + h.search_count, 0);
  res.json({ origin: { lat, lng }, radius_m: RADIUS_M, minutes, total_searches: total, hotspots, nearest, generated_at: new Date() });
}));

// POST /api/hotspots/simulate { lat, lng, count }
// Inserts fresh search pings near the origin. Needed because SearchSessions
// has a 2-hour TTL index, so seeded data disappears; also lets the demo show
// new pings appearing on the map without a page reload.
router.post('/hotspots/simulate', wrap(async (req, res) => {
  const { lat, lng } = readOrigin(req.body);
  const count = Math.min(200, Math.max(1, parseInt(req.body.count, 10) || 20));
  const now = new Date();
  // a few small "busy spots" inside the 5 km circle
  const spots = Array.from({ length: 3 }, () => ({
    dLat: (Math.random() - 0.5) * 0.05,
    dLng: (Math.random() - 0.5) * 0.05,
  }));
  const docs = Array.from({ length: count }, (_, i) => {
    const s = spots[i % spots.length];
    return {
      session_id: `sim_${now.getTime()}_${i}_${crypto.randomBytes(3).toString('hex')}`,
      user_id: `user_${1 + Math.floor(Math.random() * 50000)}`,
      location: {
        type: 'Point',
        coordinates: [
          Number((lng + s.dLng + (Math.random() - 0.5) * 0.008).toFixed(6)),
          Number((lat + s.dLat + (Math.random() - 0.5) * 0.008).toFixed(6)),
        ],
      },
      search_radius_km: Number((1 + Math.random() * 9).toFixed(2)),
      created_at: now,
    };
  });
  await (await mongo()).collection('SearchSessions').insertMany(docs);
  res.status(201).json({ inserted: docs.length });
}));

module.exports = router;
