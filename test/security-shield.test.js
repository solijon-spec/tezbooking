'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { EventEmitter } = require('node:events');
const { createShield, SCAN_RE, ATTACK_RE } = require('../server/security');

function fakeRes() {
  const res = new EventEmitter();
  res.headers = {}; res.statusCode = 200; res.headersSent = false; res.body = '';
  res.setHeader = (k, v) => { res.headers[k.toLowerCase()] = v; };
  res.writeHead = (s, h) => { res.statusCode = s; res.headersSent = true; Object.assign(res.headers, h || {}); };
  res.end = (b) => { res.body = b || ''; res.emit('finish'); };
  return res;
}
const req = (url, method = 'GET', headers = {}) => ({ url, method, headers });
const quiet = { warn() {}, error() {}, log() {} };

test('scanner paths and attack patterns are recognised, normal site paths are not', () => {
  ['/.env', '/.git/config', '/wp-login.php', '/phpmyadmin/', '/server/server.js', '/data/tezbooking.db', '/index.php', '/cgi-bin/x'].forEach(p => assert.ok(SCAN_RE.test(p), p));
  ['/', '/index.html', '/js/app.js', '/images/country-tr.jpg', '/api/live/tours', '/owner', '/admin.html'].forEach(p => assert.ok(!SCAN_RE.test(p), p));
  ["/api/x?id=1' OR '1'='1", '/a/../../etc/passwd', '/?q=<script>alert(1)</script>', '/?x=${jndi:ldap://x}', '/?q=1 UNION SELECT pass FROM users']
    .forEach(p => assert.ok(ATTACK_RE.test(p), p));
  ['/api/live/tours?country=tr&date=2026-12-01&nights=7&adults=2&children=&from=tas&window=3'].forEach(p => assert.ok(!ATTACK_RE.test(p), p));
});

test('a scanner request bans the IP immediately; banned IP gets 403 for everything', () => {
  let t = 1_000_000;
  const shield = createShield({ now: () => t, log: quiet });
  const ip = '203.0.113.7';
  const r1 = fakeRes();
  assert.strictEqual(shield.guard(req('/.env'), r1, ip), true);
  assert.strictEqual(r1.statusCode, 404);
  assert.ok(shield.isBanned(ip));
  const r2 = fakeRes();
  assert.strictEqual(shield.guard(req('/'), r2, ip), true);
  assert.strictEqual(r2.statusCode, 403);
  // 15 daqiqadan keyin blok tushadi
  t += 16 * 60000;
  assert.ok(!shield.isBanned(ip));
  assert.strictEqual(shield.guard(req('/'), fakeRes(), ip), false);
});

test('repeated wrong passwords ban the IP and ban length escalates', () => {
  let t = 5_000_000;
  const shield = createShield({ now: () => t, log: quiet });
  const ip = '198.51.100.9';
  for (let i = 0; i < 4; i++) shield.report(ip, 'auth_fail', 'admin');
  assert.ok(!shield.isBanned(ip), '4 xato — hali blok emas');
  shield.report(ip, 'auth_fail', 'admin');
  assert.ok(shield.isBanned(ip), '5-xato — blok');
  t += 16 * 60000;
  assert.ok(!shield.isBanned(ip));
  for (let i = 0; i < 5; i++) shield.report(ip, 'auth_fail', 'admin');
  const view = shield.view();
  const ban = view.bans.find(b => b.ip === ip);
  assert.strictEqual(ban.strikes, 2);
  assert.ok(ban.until - t > 50 * 60000, 'ikkinchi blok — 1 soat');
});

test('loopback and allow-listed IPs are never auto-banned', () => {
  const shield = createShield({ allowIps: ['192.0.2.10'], log: quiet });
  ['127.0.0.1', '::1', '192.0.2.10'].forEach(ip => {
    shield.guard(req('/.env'), fakeRes(), ip);
    for (let i = 0; i < 20; i++) shield.report(ip, 'auth_fail');
    assert.ok(!shield.isBanned(ip), ip);
  });
});

test('cross-site POST is rejected when origin check is on; same-origin passes', () => {
  const shield = createShield({ log: quiet });
  const opts = { checkOrigin: true, allowedOrigin: (o, r) => new URL(o).host === r.headers.host };
  const bad = fakeRes();
  assert.strictEqual(shield.guard(req('/api/bookings', 'POST', { origin: 'https://evil.example', host: 'tez.uz' }), bad, '203.0.113.20', opts), true);
  assert.strictEqual(bad.statusCode, 403);
  assert.strictEqual(shield.guard(req('/api/bookings', 'POST', { origin: 'https://tez.uz', host: 'tez.uz' }), fakeRes(), '203.0.113.21', opts), false);
});

test('request flood bans the IP for 10 minutes', () => {
  const shield = createShield({ maxPerMin: 50, log: quiet });
  const ip = '203.0.113.30';
  let blocked = false;
  for (let i = 0; i < 60 && !blocked; i++) blocked = shield.guard(req('/'), fakeRes(), ip);
  assert.ok(blocked);
  assert.ok(shield.isBanned(ip));
});

test('404 on assets is ignored; many 404 on other paths lead to a ban', () => {
  const shield = createShield({ log: quiet });
  const ip = '203.0.113.40';
  for (let i = 0; i < 40; i++) { const r = fakeRes(); shield.guard(req('/images/missing-' + i + '.jpg'), r, ip); r.statusCode = 404; r.emit('finish'); }
  assert.ok(!shield.isBanned(ip));
  for (let i = 0; i < 25; i++) { const r = fakeRes(); shield.guard(req('/random-' + i), r, ip); r.statusCode = 404; r.emit('finish'); }
  assert.ok(shield.isBanned(ip));
});

test('security headers include CSP, frame and nosniff protection', () => {
  const shield = createShield({ log: quiet });
  const r = fakeRes();
  shield.headers(r, 'site');
  assert.match(r.headers['content-security-policy'], /default-src 'self'/);
  assert.match(r.headers['content-security-policy'], /script-src 'self'/);
  assert.strictEqual(r.headers['x-content-type-options'], 'nosniff');
  assert.strictEqual(r.headers['x-frame-options'], 'SAMEORIGIN');
  const a = fakeRes();
  shield.headers(a, 'admin');
  assert.strictEqual(a.headers['x-frame-options'], 'DENY');
});
