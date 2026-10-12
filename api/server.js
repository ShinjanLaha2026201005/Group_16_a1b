// server.js - StaySpot API + static web server.
// Start with:  npm start   then open http://localhost:3000

const fs = require('fs');
const path = require('path');
const express = require('express');
const { pg } = require('./db');

const app = express();
app.use(express.json());

// Every file in routes/ exports an express.Router and is mounted under /api.
// This means a new screen only needs a new route file - no edits here.
const routesDir = path.join(__dirname, 'routes');
for (const file of fs.readdirSync(routesDir).filter((f) => f.endsWith('.js')).sort()) {
  app.use('/api', require(path.join(routesDir, file)));
}

// Health check used by the navbar status dot.
app.get('/api/health', async (req, res) => {
  const status = { postgres: false, mongo: false };
  try { await pg.query('SELECT 1'); status.postgres = true; } catch (e) { /* down */ }
  try { await require('./db').mongo().then((db) => db.command({ ping: 1 })); status.mongo = true; } catch (e) { /* down */ }
  res.json(status);
});

// Unknown /api path -> JSON 404 (not an HTML page).
app.use('/api', (req, res) => res.status(404).json({ error: `No API endpoint ${req.method} ${req.originalUrl}` }));

// The front end is plain HTML/CSS/JS served from ../web
app.use(express.static(path.join(__dirname, '..', 'web')));
// Chart.js and Leaflet come from npm (no CDN needed, works offline too).
app.use('/vendor/chart.js', express.static(path.join(__dirname, 'node_modules', 'chart.js', 'dist')));
app.use('/vendor/leaflet', express.static(path.join(__dirname, 'node_modules', 'leaflet', 'dist')));

// One error handler for everything: always answer with { error: "..." }.
app.use((err, req, res, next) => {
  // PostgreSQL class 22 = bad input (e.g. an invalid date) -> 400, not 500
  if (!err.status && typeof err.code === 'string' && err.code.startsWith('22')) {
    err.status = 400;
    err.message = `Invalid input: ${err.message}`;
  }
  const status = err.status || 500;
  if (status >= 500) console.error(err);
  res.status(status).json({ error: err.message || 'Something went wrong on the server.' });
});

module.exports = app;

if (require.main === module) {
  const port = process.env.PORT || 3000;
  app.listen(port, () => console.log(`StaySpot running at http://localhost:${port}`));
}
