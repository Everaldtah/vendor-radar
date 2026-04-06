'use strict';

const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = process.env.DATABASE_PATH || path.join(__dirname, 'vendor-radar.db');

let db;

function getDb() {
  if (!db) {
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    initSchema();
  }
  return db;
}

function initSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS vendors (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      name        TEXT    NOT NULL,
      cost        REAL    NOT NULL DEFAULT 0,
      billing_cycle TEXT  NOT NULL DEFAULT 'monthly',
      renewal_date TEXT   NOT NULL,
      category    TEXT    NOT NULL DEFAULT 'Other',
      status      TEXT    NOT NULL DEFAULT 'active',
      notes       TEXT,
      website     TEXT,
      contact_email TEXT,
      created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
      updated_at  TEXT    NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_vendors_renewal_date ON vendors(renewal_date);
    CREATE INDEX IF NOT EXISTS idx_vendors_category     ON vendors(category);
    CREATE INDEX IF NOT EXISTS idx_vendors_status       ON vendors(status);
  `);
}

function closeDb() {
  if (db) {
    db.close();
    db = null;
  }
}

module.exports = { getDb, closeDb };
