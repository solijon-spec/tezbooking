'use strict';

const fs = require('node:fs');
const path = require('node:path');

let DatabaseSync;
try { ({ DatabaseSync } = require('node:sqlite')); } catch (error) { DatabaseSync = null; }

const MIGRATIONS = [
  { version: 1, file: path.join(__dirname, 'migrations', '001_initial.sql') },
  { version: 2, file: path.join(__dirname, 'migrations', '002_orchestration.sql') }
];

function open(file) {
  if (!DatabaseSync) throw new Error('Owner console requires Node.js with node:sqlite support.');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const raw = new DatabaseSync(file);
  raw.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 3000;');
  raw.exec('CREATE TABLE IF NOT EXISTS owner_schema_migrations (version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL)');

  for (const migration of MIGRATIONS) {
    const applied = raw.prepare('SELECT 1 FROM owner_schema_migrations WHERE version = ?').get(migration.version);
    if (applied) continue;
    raw.exec('BEGIN IMMEDIATE');
    try {
      raw.exec(fs.readFileSync(migration.file, 'utf8'));
      raw.prepare('INSERT OR IGNORE INTO owner_schema_migrations (version, applied_at) VALUES (?, ?)').run(migration.version, Date.now());
      raw.exec('COMMIT');
    } catch (error) {
      raw.exec('ROLLBACK');
      raw.close();
      throw error;
    }
  }

  return { file, raw, close: () => raw.close() };
}

module.exports = { open };
