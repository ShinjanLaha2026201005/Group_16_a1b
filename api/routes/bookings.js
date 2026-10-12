// routes/bookings.js - browse bookings, Workflow 1 (book a stay), status changes.

const router = require('express').Router();
const { pg } = require('../db');
const { wrap, paging, httpError, intParam } = require('../helpers');

const STATUSES = ['CONFIRMED', 'CHECKED_IN', 'COMPLETED'];
// Allowed status moves: CONFIRMED -> CHECKED_IN -> COMPLETED
const NEXT_STATUS = { CONFIRMED: 'CHECKED_IN', CHECKED_IN: 'COMPLETED' };

// Turn a PostgreSQL error from sp_execute_booking into a sentence a user understands.
function friendlyBookingError(e) {
  const msg = e.message || '';
  if (msg.startsWith('Insufficient balance')) {
    const m = msg.match(/Current: ([\d.]+), Required: ([\d.]+)/);
    return m
      ? `Not enough money in the wallet. The stay costs ₹${m[2]} but the wallet only has ₹${m[1]}. Top up the wallet and try again.`
      : 'Not enough money in the wallet for this stay.';
  }
  if (/^Guest ID .* does not exist/.test(msg)) return 'That guest does not exist. Pick a different guest.';
  if (/^Property ID .* does not exist/.test(msg)) return 'That property does not exist. Check the property id.';
  if (msg.includes('must be after')) return 'Check-out must be at least one day after check-in.';
  if (msg.includes('does not match expected')) return 'The price changed while you were booking. Please try again.';
  if (e.code === '23505') return 'This guest already has an active stay, so a second one is blocked.';
  if (e.code === '40001') return 'Someone else changed this wallet at the same moment. Please try again.';
  return null;
}

// GET /api/bookings?guestId=&propertyId=&status=&page=&limit=
router.get('/bookings', wrap(async (req, res) => {
  const { page, limit, offset } = paging(req.query);
  const params = [];
  const conds = [];
  if (req.query.guestId) { params.push(intParam(req.query.guestId, 'guestId')); conds.push(`b.guest_id = $${params.length}`); }
  if (req.query.propertyId) { params.push(intParam(req.query.propertyId, 'propertyId')); conds.push(`b.property_id = $${params.length}`); }
  if (req.query.status) {
    if (!STATUSES.includes(req.query.status)) throw httpError(400, `status must be one of ${STATUSES.join(', ')}.`);
    params.push(req.query.status); conds.push(`b.status = $${params.length}`);
  }
  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
  const total = (await pg.query(`SELECT COUNT(*) AS n FROM bookings b ${where}`, params)).rows[0].n;
  const rows = (await pg.query(
    `SELECT b.id, b.guest_id, g.name AS guest_name, b.property_id, p.title AS property_title,
            b.check_in, b.check_out, b.total_cost, b.status, b.created_at
       FROM bookings b
       JOIN guests g ON g.id = b.guest_id
       JOIN properties p ON p.id = b.property_id
       ${where}
      ORDER BY b.created_at DESC, b.id DESC
      LIMIT ${limit} OFFSET ${offset}`, params)).rows;
  res.json({ rows, total, page, limit });
}));

// GET /api/bookings/:id
router.get('/bookings/:id', wrap(async (req, res) => {
  const id = intParam(req.params.id, 'Booking id');
  const row = (await pg.query(
    `SELECT b.*, g.name AS guest_name, p.title AS property_title, p.base_price,
            (b.check_out - b.check_in) AS nights
       FROM bookings b
       JOIN guests g ON g.id = b.guest_id
       JOIN properties p ON p.id = b.property_id
      WHERE b.id = $1`, [id])).rows[0];
  if (!row) throw httpError(404, `Booking #${id} does not exist.`);
  res.json(row);
}));

// GET /api/quote?propertyId=&checkIn=&checkOut=  -> price preview for the form
router.get('/quote', wrap(async (req, res) => {
  const propertyId = intParam(req.query.propertyId, 'propertyId');
  const q = (await pg.query(
    `SELECT id, title, base_price,
            ($3::date - $2::date) AS nights,
            ROUND(($3::date - $2::date) * base_price, 2) AS total_cost
       FROM properties WHERE id = $1`, [propertyId, req.query.checkIn, req.query.checkOut])).rows[0];
  if (!q) throw httpError(404, `Property #${propertyId} does not exist.`);
  res.json(q);
}));

// POST /api/bookings { guestId, propertyId, checkIn, checkOut }
// Workflow 1: all the real work (locking, balance check, debit, insert) happens
// inside the Part A stored procedure sp_execute_booking. The API only:
//   1. reads the balance BEFORE,
//   2. CALLs the procedure (on an autocommit connection - the procedure runs
//      its own COMMIT, so it must NOT be wrapped in BEGIN ... COMMIT),
//   3. reads the balance AFTER, the new booking and the audit row the trigger wrote.
router.post('/bookings', wrap(async (req, res) => {
  const guestId = intParam(req.body.guestId, 'Guest');
  const propertyId = intParam(req.body.propertyId, 'Property');
  const { checkIn, checkOut } = req.body;
  const dateRe = /^\d{4}-\d{2}-\d{2}$/;
  if (!dateRe.test(checkIn || '') || !dateRe.test(checkOut || '')) {
    throw httpError(400, 'Please choose both a check-in and a check-out date.');
  }

  const guest = (await pg.query(`SELECT id, name, wallet_balance FROM guests WHERE id = $1`, [guestId])).rows[0];
  if (!guest) throw httpError(404, 'That guest does not exist. Pick a different guest.');

  // The procedure insists total_cost == nights * base_price, so compute it in SQL
  // exactly the same way (ROUND to 2 decimals) to avoid floating point mismatches.
  const quote = (await pg.query(
    `SELECT ROUND(($3::date - $2::date) * base_price, 2)::text AS total_cost
       FROM properties WHERE id = $1`, [propertyId, checkIn, checkOut])).rows[0];
  if (!quote) throw httpError(404, 'That property does not exist. Check the property id.');

  const balanceBefore = guest.wallet_balance;
  const lastAuditId = (await pg.query(
    `SELECT COALESCE(MAX(id), 0) AS id FROM wallet_audit_logs WHERE guest_id = $1`, [guestId])).rows[0].id;

  try {
    await pg.query('CALL sp_execute_booking($1, $2, $3, $4, $5)',
      [guestId, propertyId, checkIn, checkOut, quote.total_cost]);
  } catch (e) {
    const friendly = friendlyBookingError(e);
    if (!friendly) throw e;
    return res.status(422).json({
      error: friendly,
      db_error: e.message,
      balance_before: balanceBefore,
      balance_after: balanceBefore, // nothing changed: the transaction rolled back
    });
  }

  const balanceAfter = (await pg.query(`SELECT wallet_balance FROM guests WHERE id = $1`, [guestId])).rows[0].wallet_balance;
  const booking = (await pg.query(
    `SELECT b.*, p.title AS property_title, (b.check_out - b.check_in) AS nights
       FROM bookings b JOIN properties p ON p.id = b.property_id
      WHERE b.guest_id = $1 ORDER BY b.id DESC LIMIT 1`, [guestId])).rows[0];
  const audit = (await pg.query(
    `SELECT * FROM wallet_audit_logs WHERE guest_id = $1 AND id > $2 ORDER BY id`, [guestId, lastAuditId])).rows;

  res.status(201).json({
    message: 'Booking confirmed.',
    balance_before: balanceBefore,
    balance_after: balanceAfter,
    booking,
    audit_entries: audit,
  });
}));

// PATCH /api/bookings/:id/status { status }
// Moves a booking forward. Moving a second booking of the same guest to
// CHECKED_IN is blocked by the Part A partial unique index idx_active_stay
// (error code 23505), which we turn into a readable message.
router.patch('/bookings/:id/status', wrap(async (req, res) => {
  const id = intParam(req.params.id, 'Booking id');
  const status = req.body.status;
  if (!STATUSES.includes(status)) throw httpError(400, `status must be one of ${STATUSES.join(', ')}.`);

  const current = (await pg.query(`SELECT id, guest_id, status FROM bookings WHERE id = $1`, [id])).rows[0];
  if (!current) throw httpError(404, `Booking #${id} does not exist.`);
  if (NEXT_STATUS[current.status] !== status) {
    throw httpError(400, `A ${current.status} booking cannot be moved to ${status}. Allowed: ${NEXT_STATUS[current.status] || 'none (already completed)'}.`);
  }

  try {
    const updated = (await pg.query(
      `UPDATE bookings SET status = $2 WHERE id = $1 RETURNING *`, [id, status])).rows[0];
    res.json({ message: `Booking #${id} is now ${status}.`, booking: updated });
  } catch (e) {
    if (e.code === '23505') {
      const other = (await pg.query(
        `SELECT id FROM bookings WHERE guest_id = $1 AND status = 'CHECKED_IN'`, [current.guest_id])).rows[0];
      return res.status(409).json({
        error: `Blocked: this guest is already checked in to booking #${other ? other.id : '?'}. ` +
               'A guest can only have one active (CHECKED_IN) stay at a time. Complete that stay first.',
        db_error: e.message,
        constraint: e.constraint,
      });
    }
    throw e;
  }
}));

module.exports = router;
