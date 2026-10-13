// tests/booking.test.js - the most important flow: Workflow 1 + status changes.
// Runs against the real seeded PostgreSQL database (no mocks), because the
// point is to prove the API is wired correctly to the Part A procedure,
// trigger and partial unique index.
//
// Run:  cd api  &&  npm test
// Each test creates its own fresh guest so it never depends on seeded balances.

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const app = require('../server');
const { pg, close } = require('../db');

let server, base;
const created = [];

before(async () => {
  server = app.listen(0);
  base = `http://localhost:${server.address().port}/api`;
});

after(async () => {
  // clean up the test guests (bookings + audit rows cascade)
  if (created.length) await pg.query('DELETE FROM guests WHERE id = ANY($1)', [created]);
  server.close();
  await close();
});

async function call(method, path, body) {
  const res = await fetch(base + path, {
    method, headers: { 'Content-Type': 'application/json' }, body: body && JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

async function makeGuest(balance) {
  const tag = `${Date.now()}${Math.floor(Math.random() * 1e6)}`;
  const { rows } = await pg.query(
    `INSERT INTO guests (name, phone_number, wallet_balance) VALUES ($1, $2, $3) RETURNING id`,
    [`Test Guest ${tag}`, `+00${tag}`.slice(0, 20), balance]);
  created.push(rows[0].id);
  return rows[0].id;
}

const cheapProperty = async () => (await pg.query('SELECT id, base_price FROM properties ORDER BY base_price LIMIT 1')).rows[0];

test('successful booking debits the wallet and the trigger writes a DEBIT audit row', async () => {
  const guestId = await makeGuest(5000);
  const prop = await cheapProperty();
  const r = await call('POST', '/bookings', { guestId, propertyId: prop.id, checkIn: '2027-01-10', checkOut: '2027-01-12' });

  assert.equal(r.status, 201);
  const expected = Math.round(prop.base_price * 2 * 100) / 100;
  assert.equal(r.body.balance_before, 5000);
  assert.equal(r.body.balance_after, Math.round((5000 - expected) * 100) / 100);
  assert.equal(r.body.booking.status, 'CONFIRMED');
  assert.equal(r.body.audit_entries.length, 1);
  assert.equal(r.body.audit_entries[0].action_type, 'DEBIT');
  assert.equal(r.body.audit_entries[0].amount_changed, expected);
});

test('insufficient balance fails with a friendly message and changes nothing', async () => {
  const guestId = await makeGuest(1);
  const prop = await cheapProperty();
  const r = await call('POST', '/bookings', { guestId, propertyId: prop.id, checkIn: '2027-01-10', checkOut: '2027-01-15' });

  assert.equal(r.status, 422);
  assert.match(r.body.error, /Not enough money/);
  const { rows } = await pg.query('SELECT wallet_balance, (SELECT COUNT(*) FROM bookings WHERE guest_id = $1) AS n FROM guests WHERE id = $1', [guestId]);
  assert.equal(rows[0].wallet_balance, 1);   // rolled back
  assert.equal(rows[0].n, 0);                // no booking created
});

test('check-out before check-in is rejected', async () => {
  const guestId = await makeGuest(5000);
  const prop = await cheapProperty();
  const r = await call('POST', '/bookings', { guestId, propertyId: prop.id, checkIn: '2027-01-15', checkOut: '2027-01-10' });
  assert.equal(r.status, 422);
  assert.match(r.body.error, /Check-out must be/);
});

test('a second CHECKED_IN stay is blocked by the partial unique index', async () => {
  const guestId = await makeGuest(5000);
  const prop = await cheapProperty();
  const a = await call('POST', '/bookings', { guestId, propertyId: prop.id, checkIn: '2027-02-01', checkOut: '2027-02-02' });
  const b = await call('POST', '/bookings', { guestId, propertyId: prop.id, checkIn: '2027-03-01', checkOut: '2027-03-02' });

  const first = await call('PATCH', `/bookings/${a.body.booking.id}/status`, { status: 'CHECKED_IN' });
  assert.equal(first.status, 200);

  const second = await call('PATCH', `/bookings/${b.body.booking.id}/status`, { status: 'CHECKED_IN' });
  assert.equal(second.status, 409);
  assert.equal(second.body.constraint, 'idx_active_stay');

  // after completing the first stay, the second one can check in
  await call('PATCH', `/bookings/${a.body.booking.id}/status`, { status: 'COMPLETED' });
  const retry = await call('PATCH', `/bookings/${b.body.booking.id}/status`, { status: 'CHECKED_IN' });
  assert.equal(retry.status, 200);
});

test('status can only move forward one step', async () => {
  const guestId = await makeGuest(5000);
  const prop = await cheapProperty();
  const a = await call('POST', '/bookings', { guestId, propertyId: prop.id, checkIn: '2027-04-01', checkOut: '2027-04-02' });
  const r = await call('PATCH', `/bookings/${a.body.booking.id}/status`, { status: 'COMPLETED' });
  assert.equal(r.status, 400);
});
