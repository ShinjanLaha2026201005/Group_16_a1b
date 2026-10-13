// tests/api.test.js - browsing at scale, wallet audit, analytics endpoints.
// Run:  cd api  &&  npm test

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const app = require('../server');
const { close } = require('../db');

let server, base;
before(() => { server = app.listen(0); base = `http://localhost:${server.address().port}/api`; });
after(async () => { server.close(); await close(); });

const get = async (path) => {
  const res = await fetch(base + path);
  return { status: res.status, body: await res.json() };
};

test('bookings are paged on the server: never more than 100 rows', async () => {
  const r = await get('/bookings?limit=5000');
  assert.equal(r.status, 200);
  assert.equal(r.body.rows.length, 100);
  assert.ok(r.body.total >= 50000, 'seeded data has 50k+ bookings');
});

test('guest search finds a guest by id', async () => {
  const r = await get('/guests?search=1');
  assert.equal(r.status, 200);
  assert.ok(r.body.rows.some((g) => g.id === 1));
});

test('unknown records give 404 with a readable error, bad ids give 400', async () => {
  assert.equal((await get('/guests/99999999')).status, 404);
  const bad = await get('/guests/abc');
  assert.equal(bad.status, 400);
  assert.ok(bad.body.error);
});

test('wallet audit running balance is consistent row to row', async () => {
  const r = await get('/guests/1/audit');
  assert.equal(r.status, 200);
  const rows = r.body.rows;
  for (let i = 1; i < rows.length; i++) {
    assert.equal(rows[i].balance_before, rows[i - 1].balance_after, `row ${rows[i].id} continues from row ${rows[i - 1].id}`);
  }
});

test('analytics: moving average has one row per day and ranking is dense', async () => {
  const ma = await get('/analytics/moving-average?propertyId=1');
  assert.equal(ma.status, 200);
  assert.ok(ma.body.rows.length >= 80, 'gap-free calendar of ~90 days');

  const rank = await get('/analytics/ranking?limit=50');
  assert.equal(rank.status, 200);
  const ranks = rank.body.rows.map((r) => r.property_rank);
  assert.equal(ranks[0], 1);
  for (let i = 1; i < ranks.length; i++) assert.ok(ranks[i] - ranks[i - 1] <= 1, 'DENSE_RANK never skips a number');
});

test('materialized view refresh updates the "last refreshed" time', async () => {
  const before = (await get('/analytics/summary')).body.last_refreshed;
  const res = await fetch(base + '/analytics/refresh', { method: 'POST' });
  assert.equal(res.status, 200);
  const after = (await get('/analytics/summary')).body.last_refreshed;
  assert.ok(!before || new Date(after.refreshed_at) > new Date(before.refreshed_at));
});
