// routes/properties.js - browse properties and property detail.

const router = require('express').Router();
const { pg } = require('../db');
const { wrap, paging, httpError, intParam } = require('../helpers');

const SORTS = {
  id: 'id ASC',
  price_asc: 'base_price ASC, id',
  price_desc: 'base_price DESC, id',
  title: 'title ASC, id',
};

// GET /api/properties?search=&minPrice=&maxPrice=&sort=&page=&limit=
router.get('/properties', wrap(async (req, res) => {
  const { page, limit, offset } = paging(req.query);
  const params = [];
  const conds = [];
  const search = (req.query.search || '').trim();
  if (search) {
    params.push(`%${search}%`);
    let c = `title ILIKE $${params.length}`;
    if (/^\d+$/.test(search)) { params.push(Number(search)); c += ` OR id = $${params.length}`; }
    conds.push(`(${c})`);
  }
  if (req.query.minPrice) { params.push(Number(req.query.minPrice)); conds.push(`base_price >= $${params.length}`); }
  if (req.query.maxPrice) { params.push(Number(req.query.maxPrice)); conds.push(`base_price <= $${params.length}`); }
  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
  const order = SORTS[req.query.sort] || SORTS.id;

  const total = (await pg.query(`SELECT COUNT(*) AS n FROM properties ${where}`, params)).rows[0].n;
  const rows = (await pg.query(
    `SELECT id, title, base_price, latitude, longitude
       FROM properties ${where}
      ORDER BY ${order}
      LIMIT ${limit} OFFSET ${offset}`, params)).rows;
  res.json({ rows, total, page, limit });
}));

// GET /api/properties/:id -> property + its row from the materialized view
router.get('/properties/:id', wrap(async (req, res) => {
  const id = intParam(req.params.id, 'Property id');
  const property = (await pg.query(
    `SELECT id, title, base_price, latitude, longitude FROM properties WHERE id = $1`, [id])).rows[0];
  if (!property) throw httpError(404, `Property #${id} does not exist.`);
  const stats = (await pg.query(
    `SELECT total_completed_bookings, total_nights_booked, gross_revenue
       FROM mv_property_analytics WHERE property_id = $1`, [id])).rows[0] || null;
  const active = (await pg.query(
    `SELECT status, COUNT(*) AS n FROM bookings WHERE property_id = $1 GROUP BY status`, [id])).rows;
  res.json({ ...property, analytics: stats, booking_counts: Object.fromEntries(active.map((a) => [a.status, a.n])) });
}));

module.exports = router;
