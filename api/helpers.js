// helpers.js - small utilities shared by all route files.

// Wrap an async route so thrown errors reach the error handler in server.js.
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// Read ?page=&limit= safely. limit is capped so the browser never pulls
// thousands of rows at once (we have 50,000+ bookings).
function paging(query, defaultLimit = 20) {
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(query.limit, 10) || defaultLimit));
  return { page, limit, offset: (page - 1) * limit };
}

// Build an error with an HTTP status that the error handler will send.
function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

// Parse a positive integer id or throw 400.
function intParam(value, name) {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) throw httpError(400, `${name} must be a positive whole number.`);
  return n;
}

module.exports = { wrap, paging, httpError, intParam };
