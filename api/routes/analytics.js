// routes/analytics.js - Workflow 2 (window functions) + materialized view.

const router = require('express').Router();
const { pg } = require('../db');
const { wrap, httpError, intParam } = require('../helpers');

// GET /api/analytics/moving-average?propertyId=
// Daily revenue + 7-day moving average for one property.
// Uses fn_property_moving_avg (sql/07) = the Part A window query (sql/06),
// AVG(...) OVER (ORDER BY day ROWS BETWEEN 6 PRECEDING AND CURRENT ROW).
router.get('/analytics/moving-average', wrap(async (req, res) => {
  const propertyId = intParam(req.query.propertyId, 'propertyId');
  const property = (await pg.query(`SELECT id, title FROM properties WHERE id = $1`, [propertyId])).rows[0];
  if (!property) throw httpError(404, `Property #${propertyId} does not exist.`);
  const rows = (await pg.query(`SELECT * FROM fn_property_moving_avg($1)`, [propertyId])).rows;
  res.json({ property, rows });
}));

// GET /api/analytics/ranking?date=YYYY-MM-DD&limit=
// DENSE_RANK() of properties by their 7-day moving average on that date.
router.get('/analytics/ranking', wrap(async (req, res) => {
  let date = req.query.date;
  if (!date) {
    date = (await pg.query(`SELECT MAX(created_at)::date::text AS d FROM bookings`)).rows[0].d;
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) throw httpError(400, 'date must look like YYYY-MM-DD.');
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));
  const rows = (await pg.query(`SELECT * FROM fn_property_rank($1::date, $2)`, [date, limit])).rows;
  const range = (await pg.query(
    `SELECT MIN(created_at)::date::text AS min_date, MAX(created_at)::date::text AS max_date FROM bookings`)).rows[0];
  res.json({ date, rows, ...range });
}));

// GET /api/analytics/summary  -> headline numbers from mv_property_analytics
router.get('/analytics/summary', wrap(async (req, res) => {
  const totals = (await pg.query(
    `SELECT COUNT(*) FILTER (WHERE total_completed_bookings > 0) AS properties_with_stays,
            COUNT(*)                         AS properties,
            SUM(total_completed_bookings)    AS completed_bookings,
            SUM(total_nights_booked)         AS nights_booked,
            SUM(gross_revenue)               AS gross_revenue,
            ROUND(SUM(gross_revenue) / NULLIF(SUM(total_nights_booked), 0), 2) AS revenue_per_night
       FROM mv_property_analytics`)).rows[0];
  const top = (await pg.query(
    `SELECT property_id, title, total_completed_bookings, total_nights_booked, gross_revenue
       FROM mv_property_analytics ORDER BY gross_revenue DESC, property_id LIMIT 10`)).rows;
  const last = (await pg.query(
    `SELECT refreshed_at, duration_ms FROM mv_refresh_log
      WHERE view_name = 'mv_property_analytics' ORDER BY refreshed_at DESC LIMIT 1`)).rows[0] || null;
  res.json({ totals, top_properties: top, last_refreshed: last });
}));

// POST /api/analytics/refresh -> REFRESH MATERIALIZED VIEW CONCURRENTLY (via the Part A function)
router.post('/analytics/refresh', wrap(async (req, res) => {
  await pg.query(`SELECT refresh_property_analytics()`);
  const last = (await pg.query(
    `SELECT refreshed_at, duration_ms FROM mv_refresh_log
      WHERE view_name = 'mv_property_analytics' ORDER BY refreshed_at DESC LIMIT 1`)).rows[0];
  res.json({ message: 'Materialized view refreshed.', last_refreshed: last });
}));

module.exports = router;
