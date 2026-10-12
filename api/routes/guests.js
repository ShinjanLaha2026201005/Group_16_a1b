// routes/guests.js - browse guests, guest detail, wallet top-up, audit trail.

const router = require('express').Router();
const { pg } = require('../db');
const { wrap, paging, httpError, intParam } = require('../helpers');

// GET /api/guests?search=&page=&limit=
// search matches id (exact), name, email or phone (partial, case-insensitive)
router.get('/guests', wrap(async (req, res) => {
  const { page, limit, offset } = paging(req.query);
  const search = (req.query.search || '').trim();
  const params = [];
  let where = '';
  if (search) {
    params.push(`%${search}%`);
    where = `WHERE name ILIKE $1 OR email ILIKE $1 OR phone_number ILIKE $1`;
    if (/^\d+$/.test(search)) { params.push(Number(search)); where += ` OR id = $2`; }
  }
  const total = (await pg.query(`SELECT COUNT(*) AS n FROM guests ${where}`, params)).rows[0].n;
  const rows = (await pg.query(
    `SELECT id, name, email, phone_number, wallet_balance
       FROM guests ${where}
      ORDER BY id
      LIMIT ${limit} OFFSET ${offset}`, params)).rows;
  res.json({ rows, total, page, limit });
}));

// GET /api/guests/:id  -> guest + booking counts + 5 latest bookings
router.get('/guests/:id', wrap(async (req, res) => {
  const id = intParam(req.params.id, 'Guest id');
  const guest = (await pg.query(
    `SELECT id, name, email, phone_number, wallet_balance FROM guests WHERE id = $1`, [id])).rows[0];
  if (!guest) throw httpError(404, `Guest #${id} does not exist.`);
  const counts = (await pg.query(
    `SELECT status, COUNT(*) AS n FROM bookings WHERE guest_id = $1 GROUP BY status`, [id])).rows;
  const recent = (await pg.query(
    `SELECT b.id, b.property_id, p.title AS property_title, b.check_in, b.check_out,
            b.total_cost, b.status, b.created_at
       FROM bookings b JOIN properties p ON p.id = b.property_id
      WHERE b.guest_id = $1
      ORDER BY b.created_at DESC LIMIT 5`, [id])).rows;
  res.json({ ...guest, booking_counts: Object.fromEntries(counts.map((c) => [c.status, c.n])), recent_bookings: recent });
}));

// POST /api/guests/:id/topup  { amount }
// A plain UPDATE of wallet_balance - the Part A trigger writes the CREDIT
// row into wallet_audit_logs, we just read it back to prove it fired.
router.post('/guests/:id/topup', wrap(async (req, res) => {
  const id = intParam(req.params.id, 'Guest id');
  const amount = Number(req.body.amount);
  if (!(amount > 0) || amount > 100000) throw httpError(400, 'Top-up amount must be between 1 and 100000.');
  const updated = await pg.query(
    `UPDATE guests SET wallet_balance = wallet_balance + ROUND($2::numeric, 2)
      WHERE id = $1 RETURNING wallet_balance`, [id, amount]);
  if (!updated.rowCount) throw httpError(404, `Guest #${id} does not exist.`);
  const audit = (await pg.query(
    `SELECT * FROM wallet_audit_logs WHERE guest_id = $1 ORDER BY id DESC LIMIT 1`, [id])).rows[0];
  res.json({ wallet_balance: updated.rows[0].wallet_balance, audit_entry: audit });
}));

// GET /api/guests/:id/audit?from=YYYY-MM-DD&to=YYYY-MM-DD
// Read-only wallet history. balance_after IS the running balance, because the
// trigger stores the wallet value after every change.
router.get('/guests/:id/audit', wrap(async (req, res) => {
  const id = intParam(req.params.id, 'Guest id');
  const guest = (await pg.query(`SELECT id, name, wallet_balance FROM guests WHERE id = $1`, [id])).rows[0];
  if (!guest) throw httpError(404, `Guest #${id} does not exist.`);

  const params = [id];
  let where = 'guest_id = $1';
  const dateRe = /^\d{4}-\d{2}-\d{2}$/;
  if (req.query.from) {
    if (!dateRe.test(req.query.from)) throw httpError(400, 'from must be a date (YYYY-MM-DD).');
    params.push(req.query.from); where += ` AND timestamp >= $${params.length}::date`;
  }
  if (req.query.to) {
    if (!dateRe.test(req.query.to)) throw httpError(400, 'to must be a date (YYYY-MM-DD).');
    params.push(req.query.to); where += ` AND timestamp < $${params.length}::date + 1`;
  }

  // Oldest first so the running balance reads top to bottom.
  const rows = (await pg.query(
    `SELECT id, timestamp, action_type, amount_changed, balance_after,
            CASE WHEN action_type = 'CREDIT' THEN balance_after - amount_changed
                 ELSE balance_after + amount_changed END AS balance_before
       FROM wallet_audit_logs
      WHERE ${where}
      ORDER BY timestamp, id
      LIMIT 500`, params)).rows;

  const credits = rows.filter((r) => r.action_type === 'CREDIT').reduce((s, r) => s + r.amount_changed, 0);
  const debits = rows.filter((r) => r.action_type === 'DEBIT').reduce((s, r) => s + r.amount_changed, 0);
  res.json({
    guest,
    rows,
    summary: {
      entries: rows.length,
      opening_balance: rows.length ? rows[0].balance_before : null,
      closing_balance: rows.length ? rows[rows.length - 1].balance_after : null,
      total_credits: Math.round(credits * 100) / 100,
      total_debits: Math.round(debits * 100) / 100,
    },
  });
}));

module.exports = router;
