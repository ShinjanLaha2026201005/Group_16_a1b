// db.js - one shared PostgreSQL pool and one shared MongoDB client.
// Every route file imports { pg, mongo } from here.

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const { Pool } = require('pg');
const { MongoClient } = require('mongodb');

// PostgreSQL ----------------------------------------------------------------
// pg reads PGHOST / PGPORT / PGDATABASE / PGUSER / PGPASSWORD from the env.
const pg = new Pool({ max: 10 });

// NUMERIC columns come back as strings by default; money values are small
// enough to be safe as JS numbers, so convert them.
require('pg').types.setTypeParser(1700, (v) => (v === null ? null : parseFloat(v)));
// DATE -> keep as 'YYYY-MM-DD' text (otherwise it becomes a JS Date and shifts by time zone)
require('pg').types.setTypeParser(1082, (v) => v);
// BIGINT (e.g. COUNT(*), DENSE_RANK) -> number
require('pg').types.setTypeParser(20, (v) => (v === null ? null : parseInt(v, 10)));

// MongoDB -------------------------------------------------------------------
const mongoClient = new MongoClient(process.env.MONGO_URI || 'mongodb://localhost:27017', {
  serverSelectionTimeoutMS: 3000,
});
let mongoDb = null;

// Returns the connected Mongo database, or throws a friendly 503 error.
async function mongo() {
  if (mongoDb) return mongoDb;
  try {
    await mongoClient.connect();
    mongoDb = mongoClient.db(process.env.MONGO_DB || 'stayspot');
    return mongoDb;
  } catch (e) {
    const err = new Error('MongoDB is not reachable. Is the MongoDB service running?');
    err.status = 503;
    throw err;
  }
}

async function close() {
  await pg.end();
  await mongoClient.close().catch(() => {});
}

module.exports = { pg, mongo, close };
