const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const config = require('./config');

fs.mkdirSync(config.storagePath, { recursive: true });

const dbPath = path.join(config.storagePath, 'transcoder.db');
const db = new Database(dbPath);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS jobs (
    id TEXT PRIMARY KEY,
    url TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    language TEXT DEFAULT 'auto',
    format TEXT DEFAULT 'srt',
    webhook_url TEXT,
    output_path TEXT,
    subtitle_path TEXT,
    error TEXT,
    progress INTEGER DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    started_at TEXT,
    completed_at TEXT,
    duration REAL
  )
`);

// Migration: add download_method column
try {
  db.exec(`ALTER TABLE jobs ADD COLUMN download_method TEXT`);
} catch {
  // Column already exists
}

// Migration: add status_message column
try {
  db.exec(`ALTER TABLE jobs ADD COLUMN status_message TEXT`);
} catch {
  // Column already exists
}

db.exec(`
  CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
  CREATE INDEX IF NOT EXISTS idx_jobs_created_at ON jobs(created_at);
`);

module.exports = db;
