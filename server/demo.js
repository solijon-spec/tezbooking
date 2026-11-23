#!/usr/bin/env node
/*
 * TezBooking — LOKAL DEMO.   Ishga tushirish:  npm run demo      (qayta to'ldirish: npm run demo -- --reset)
 *
 *   Sayt:         http://localhost:3100
 *   Admin panel:  http://localhost:3101      parol: admin12345
 *   Tur firma:    demo / demo12345 (tarif faol),  yangi / demo12345 (tarifsiz)
 *
 * Alohida baza: data/demo.db — haqiqiy baza (data/tezbooking.db) va .env dagi parollarga tegilmaydi.
 * To'lov rejimi: demo (to'lov pulsiz darhol tasdiqlanadi).
 * Namunaviy ma'lumotlar: js/demo-seed.js (GitHub Pages'dagi demo bilan bir xil).
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const DB_FILE = path.join(ROOT, 'data', 'demo.db');
const OWNER_DB_FILE = path.join(ROOT, 'data', 'demo-owner.db');   // agentlar (Main Agent) uchun alohida demo baza
const seed = require('../js/demo-seed.js');

// Demo sozlamalari — server.js .env'dan o'qishidan oldin o'rnatiladi (.env ularni almashtirmaydi)
process.env.PORT = process.env.DEMO_PORT || '3100';
process.env.ADMIN_PORT = String(Number(process.env.PORT) + 1);
process.env.DB_FILE = DB_FILE;
process.env.OWNER_DB_FILE = OWNER_DB_FILE;
process.env.TEZ_DEMO_AGENTS = '1';   // admin panel → Agentlar: taqlidiy ishchi (operator saytlariga so'rov yo'q)
process.env.PAYMENT_MODE = 'demo';
process.env.ADMIN_PASSWORD = seed.LOGINS.admin;

// Saytning narx generatorini (js/data.js) Node ichida yuklash — bronlar haqiqiy takliflarga mos bo'lishi uchun
function loadTB() {
  const sandbox = { window: {}, Math, Date, Object, Array, JSON, String, Number, isNaN, parseInt };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'js', 'data.js'), 'utf8'), sandbox, { filename: 'data.js' });
  return sandbox.window.TB;
}

function fill(reset) {
  if (reset) for (const f of [DB_FILE, DB_FILE + '-wal', DB_FILE + '-shm', OWNER_DB_FILE, OWNER_DB_FILE + '-wal', OWNER_DB_FILE + '-shm']) { try { fs.unlinkSync(f); } catch (e) { /* yo'q */ } }
  const db = require('./db').open(DB_FILE);          // jadvallar (migratsiyalar) yaratiladi
  const raw = db.raw;
  if (raw.prepare('SELECT COUNT(*) AS n FROM agencies').get().n > 0) { db.close(); return false; }
  const { hashPassword } = require('./accounts');
  const s = seed(loadTB(), Date.now());
  db.tx(() => {
    raw.exec('DELETE FROM tariffs');
    const t = raw.prepare('INSERT INTO tariffs (id, months, price, active) VALUES (?, ?, ?, ?)');
    s.tariffs.forEach(x => t.run(x.id, x.months, x.price, x.active));
    const a = raw.prepare(`INSERT INTO agencies (id, name, login, pass_hash, phone, contact, status, paid_until, created_at, last_login)
                           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    s.agencies.forEach(x => a.run(x.id, x.name, x.login, hashPassword(x.password), x.phone, x.contact, x.status, x.paid_until, x.created_at, x.last_login));
    const p = raw.prepare(`INSERT INTO payments (id, agency_id, tariff_id, months, amount, status, provider, created_at, paid_at, period_from, period_to, note)
                           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    s.payments.forEach(x => p.run(x.id, x.agency_id, x.tariff_id, x.months, x.amount, x.status, x.provider, x.created_at, x.paid_at, x.period_from, x.period_to, x.note));
    const b = raw.prepare(`INSERT INTO bookings (id, key, product, title, op, price, date_from, date_to, status, created_at, updated_at, agency_id)
                           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    s.bookings.forEach(x => b.run(x.id, x.key, x.product, x.title, x.op, x.price, x.date_from, x.date_to, x.status, x.created_at, x.updated_at, x.agency_id));
    const e = raw.prepare('INSERT INTO booking_events (booking_id, type, payload, at) VALUES (?, ?, ?, ?)');
    s.events.forEach(x => e.run(x.booking_id, x.type, x.payload ? JSON.stringify(x.payload) : null, x.at));
  });
  console.log(`  Demo ma'lumotlar yozildi: ${s.agencies.length} firma, ${s.payments.length} to'lov, ${s.bookings.length} bron`);
  db.close();
  return true;
}

const reset = process.argv.includes('--reset');
if (!fill(reset)) console.log("  Demo baza bor (qayta to'ldirish: npm run demo -- --reset)");
console.log('');
console.log('  ===== TezBooking DEMO =====');
console.log('  Tur firma:  demo / demo12345 (tarif faol)   yangi / demo12345 (tarifsiz)');
console.log('  Admin:      parol ' + seed.LOGINS.admin + '   (agentlar: admin panel → Agentlar)');
require('./server.js');
