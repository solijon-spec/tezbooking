#!/usr/bin/env node
/*
 * TezBooking — bazaning zaxira nusxasi (server ishlab turganda ham xavfsiz: SQLite "VACUUM INTO").
 *   node server/backup.js            ->  <baza papkasi>/backups/tezbooking-YYYY-MM-DD.db   (oxirgi 14 tasi saqlanadi)
 * Server o'rnatilganda har kuni 03:17 da avtomatik ishlaydi (/etc/cron.d/tezbooking-backup).
 * Qayta tiklash: serverni to'xtating, zaxira faylni baza fayli o'rniga nusxalang.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const ROOT = path.resolve(__dirname, '..');
const DB_FILE = path.resolve(ROOT, process.env.DB_FILE || 'data/tezbooking.db');
const KEEP = 14;

if (!fs.existsSync(DB_FILE)) { console.error('Baza topilmadi: ' + DB_FILE); process.exit(1); }
const dir = path.join(path.dirname(DB_FILE), 'backups');
fs.mkdirSync(dir, { recursive: true });
const out = path.join(dir, 'tezbooking-' + new Date().toISOString().slice(0, 10) + '.db');
try { fs.unlinkSync(out); } catch (e) { /* yo'q */ }

const db = new DatabaseSync(DB_FILE);
db.exec("VACUUM INTO '" + out.replace(/'/g, "''") + "'");
db.close();

const old = fs.readdirSync(dir).filter(f => /^tezbooking-\d{4}-\d{2}-\d{2}\.db$/.test(f)).sort().slice(0, -KEEP);
old.forEach(f => fs.unlinkSync(path.join(dir, f)));
console.log(new Date().toISOString() + '  zaxira: ' + out + ' (' + Math.round(fs.statSync(out).size / 1024) + ' KB)' + (old.length ? ', eskirgan o\'chirildi: ' + old.length : ''));
