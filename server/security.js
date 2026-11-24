/*
 * TezBooking — xavfsizlik qalqoni (Shield): buzib kirishga urinishlarni aniqlash va IP'ni avtomatik bloklash.
 *
 * Qanday ishlaydi (fail2ban'ga o'xshash, lekin server ichida, paketsiz):
 *   1) Har bir so'rov eng avval tekshiriladi: IP bloklangan bo'lsa — darhol 403, so'rov ichkariga o'tmaydi.
 *   2) Shubhali harakatlar IP'ga "ball" qo'shadi:
 *        skaner manzillari (/.env, /.git, /wp-admin, *.php, /phpmyadmin ...)        10 ball — darhol blok
 *        SQL-injection / XSS / path traversal naqshlari URL'da                     10 ball — darhol blok
 *        noto'g'ri parol (admin, tur firma, owner)                                2 ball (5 ta xato — blok)
 *        login/ro'yxatdan o'tish limitiga urilish (429)                           2–3 ball
 *        404 (mavjud bo'lmagan manzil)                                            0.5 ball
 *        ruxsat etilmagan metod, buzuq so'rov, juda katta so'rov                   1–3 ball
 *        boshqa saytdan (Origin) cookie bilan POST — CSRF urinish                  5 ball
 *      Ball vaqt o'tishi bilan kamayadi (har 10 daqiqada yarmiga). 10 ballga yetsa — IP bloklanadi.
 *   3) Blok muddati har safar oshadi: 15 daqiqa → 1 soat → 6 soat → 24 soat → 7 kun.
 *   4) Umumiy oqim limiti: bitta IP'dan daqiqasiga SHIELD_MAX_PER_MIN (600) dan ko'p so'rov — 10 daqiqa blok.
 *   5) Bloklar va hodisalar bazada (ip_bans, security_events) — server qayta ishga tushsa ham saqlanadi.
 *      Admin panel → Xavfsizlik: bloklangan IP'lar, oxirgi hodisalar, qo'lda bloklash / ochish.
 *
 * Sozlamalar (.env):
 *   SHIELD=off                    qalqonni o'chirish (tavsiya etilmaydi)
 *   SHIELD_ALLOW_IPS=1.2.3.4,...  hech qachon bloklanmaydigan IP'lar (o'z ofisingiz). 127.0.0.1 va ::1 doim ruxsat.
 *   SHIELD_MAX_PER_MIN=600        bitta IP'dan daqiqasiga so'rovlar chegarasi
 */
'use strict';

const BAN_STEPS_MIN = [15, 60, 360, 1440, 10080];
const THRESHOLD = 10;
const HALF_LIFE_MS = 10 * 60000;
const MAX_EVENTS = 5000;

const WEIGHTS = {
  scan: 10, attack: 10, honeypot: 10, auth_fail: 2, csrf: 5, rate_limited: 2, register_flood: 3,
  not_found: 0.5, bad_method: 1, bad_request: 1, too_large: 3, flood: 10, tg_abuse: 0
};

// Skanerlar qidiradigan manzillar: bu saytda hech qachon bo'lmaydi, shuning uchun so'ragan IP — hujumchi
const SCAN_RE = new RegExp([
  '^/\\.(env|git|svn|hg|aws|ssh|docker|htaccess|htpasswd|DS_Store|vscode|idea)',
  '/\\.(env|git)(/|$)',
  '\\.(php\\d?|asp|aspx|jsp|cgi|pl|py|sh|bak|old|sql|sqlite|db|ini|log|swp|tar|gz|zip|rar|7z)$',
  '^/(wp-|wordpress|xmlrpc|phpmyadmin|pma|myadmin|mysql|adminer|cgi-bin|vendor/|actuator|server-status|solr|jenkins|manager/html|boaform|HNAP1|owa/|ecp/|autodiscover|telescope|_profiler|config\\.json|configuration|setup|install|console|debug|druid|struts|webdav|remote/login|\\+CSCOE\\+)',
  '^/(data|server|node_modules)/',
  '^/package(-lock)?\\.json$'
].join('|'), 'i');

// Hujum naqshlari (URL'ning o'zida — dekodlangan holda)
const ATTACK_RE = new RegExp([
  '\\.\\./', '\\.\\.\\\\', '%2e%2e', '\\u0000', '%00',
  '<script', 'javascript:', 'onerror\\s*=', 'onload\\s*=',
  "'\\s*(or|and)\\s+['\\d]", 'union(\\s|\\+|/\\*.*\\*/)+select', 'select.+from\\s', 'sleep\\s*\\(', 'benchmark\\s*\\(', 'waitfor\\s+delay',
  'information_schema', 'load_file\\s*\\(', 'into\\s+outfile',
  '\\$\\{jndi:', '\\{\\{.*\\}\\}', '/etc/passwd', 'win\\.ini', 'cmd\\.exe', '/bin/(ba)?sh', ';\\s*(wget|curl)\\s'
].join('|'), 'i');

const ASSET_RE = /^\/(images|css|js)\/|^\/(favicon|apple-touch-icon|robots\.txt|site\.webmanifest)/;
const isLoopback =(ip) => ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';

function createShield({ db, enabled = true, allowIps = [], maxPerMin = 600, now = Date.now, log = console } = {}) {
  const raw = db && db.raw;
  const allow = new Set(allowIps.map(s => String(s).trim()).filter(Boolean));
  const scores = new Map();          // ip -> { score, at }
  const flood = new Map();           // ip -> { n, start }
  const bans = new Map();            // ip -> { until, strikes, reason, manual }
  const counters = { blocked: 0, banned: 0, events: 0 };

  const q = raw ? {
    loadBans: raw.prepare('SELECT * FROM ip_bans'),
    upsertBan: raw.prepare(`INSERT INTO ip_bans (ip, until, strikes, reason, manual, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)
                            ON CONFLICT(ip) DO UPDATE SET until = excluded.until, strikes = excluded.strikes, reason = excluded.reason,
                            manual = excluded.manual, updated_at = excluded.updated_at`),
    unban: raw.prepare('UPDATE ip_bans SET until = 0, updated_at = ? WHERE ip = ?'),
    event: raw.prepare('INSERT INTO security_events (at, ip, kind, detail) VALUES (?, ?, ?, ?)'),
    trim: raw.prepare('DELETE FROM security_events WHERE id <= (SELECT id FROM security_events ORDER BY id DESC LIMIT 1 OFFSET ?)'),
    events: raw.prepare('SELECT at, ip, kind, detail FROM security_events ORDER BY id DESC LIMIT ?'),
    byKind: raw.prepare('SELECT kind, COUNT(*) AS n FROM security_events WHERE at >= ? GROUP BY kind'),
    allBans: raw.prepare('SELECT * FROM ip_bans ORDER BY updated_at DESC LIMIT 500')
  } : null;

  if (q) {
    try { q.loadBans.all().forEach(b => bans.set(b.ip, { until: b.until, strikes: b.strikes, reason: b.reason, manual: !!b.manual })); }
    catch (e) { log.error('[shield] bloklarni o\'qib bo\'lmadi:', e.message); }
  }

  const exempt = (ip) => !ip || isLoopback(ip) || allow.has(ip);

  function record(ip, kind, detail) {
    counters.events++;
    if (!q) return;
    try {
      q.event.run(now(), String(ip).slice(0, 64), kind, detail ? String(detail).slice(0, 200) : null);
      if (counters.events % 200 === 0) q.trim.run(MAX_EVENTS);
    } catch (e) { /* baza band — hodisa yo'qolsa ham bloklash ishlayveradi */ }
  }

  function isBanned(ip) {
    const b = bans.get(ip);
    return !!b && b.until > now();
  }

  function ban(ip, reason, minutes, manual) {
    if (!ip || (exempt(ip) && !manual)) return null;
    const prev = bans.get(ip);
    const strikes = (prev ? prev.strikes : 0) + 1;
    const mins = minutes || BAN_STEPS_MIN[Math.min(strikes - 1, BAN_STEPS_MIN.length - 1)];
    const until = now() + mins * 60000;
    const b = { until, strikes, reason: String(reason || '').slice(0, 120), manual: !!manual };
    bans.set(ip, b);
    scores.delete(ip);
    counters.banned++;
    if (q) { try { q.upsertBan.run(ip, until, strikes, b.reason, manual ? 1 : 0, now(), now()); } catch (e) { /* xotirada qoladi */ } }
    record(ip, 'ban', b.reason + ' · ' + mins + ' min');
    log.warn('[shield] IP bloklandi: ' + ip + ' (' + b.reason + ', ' + mins + ' daqiqa)');
    return { ip, until, minutes: mins, strikes };
  }

  function unban(ip) {
    const b = bans.get(ip);
    if (!b) return false;
    b.until = 0;
    scores.delete(ip);
    if (q) { try { q.unban.run(now(), ip); } catch (e) { /* */ } }
    record(ip, 'unban', 'admin');
    return true;
  }

  // Shubhali harakat: ball qo'shiladi, chegaradan oshsa — blok
  function report(ip, kind, detail) {
    if (!enabled || !ip) return;
    const w = WEIGHTS[kind] != null ? WEIGHTS[kind] : 1;
    if (w >= 1 || kind === 'auth_fail') record(ip, kind, detail);
    if (exempt(ip) || isBanned(ip)) return;
    const t = now();
    const s = scores.get(ip) || { score: 0, at: t };
    s.score = s.score * Math.pow(0.5, (t - s.at) / HALF_LIFE_MS) + w;
    s.at = t;
    scores.set(ip, s);
    if (s.score >= THRESHOLD) ban(ip, kind + (detail ? ': ' + detail : ''));
  }

  // Xavfsizlik sarlavhalari. kind: 'site' | 'admin' | 'api'
  function headers(res, kind) {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=()');
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    res.setHeader('X-Frame-Options', kind === 'admin' ? 'DENY' : 'SAMEORIGIN');
    if (process.env.COOKIE_SECURE === '1') res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    if (kind === 'site' || kind === 'admin') {
      res.setHeader('Content-Security-Policy', [
        "default-src 'self'",
        "script-src 'self'",
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
        "font-src 'self' data: https://fonts.gstatic.com",
        "img-src 'self' data: blob:",
        "connect-src 'self'",
        "object-src 'none'",
        "base-uri 'self'",
        "form-action 'self'",
        "frame-ancestors " + (kind === 'admin' ? "'none'" : "'self'")
      ].join('; '));
    }
  }

  function deny(res, status, code) {
    if (res.headersSent) { res.end(); return; }
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', Connection: 'close' });
    res.end(JSON.stringify({ error: code }));
  }

  // Har bir so'rov boshida. true — so'rov to'xtatildi (javob berildi)
  function guard(req, res, ip, opts) {
    if (!enabled) return false;
    opts = opts || {};
    if (isBanned(ip) && !exempt(ip)) {
      counters.blocked++;
      res.setHeader('Retry-After', String(Math.ceil((bans.get(ip).until - now()) / 1000)));
      deny(res, 403, 'blocked');
      return true;
    }
    // Oqim limiti
    if (!exempt(ip)) {
      const t = now();
      let f = flood.get(ip);
      if (!f || t - f.start > 60000) { f = { n: 0, start: t }; flood.set(ip, f); }
      if (++f.n > maxPerMin) { ban(ip, 'flood: ' + f.n + '/min', 10); deny(res, 429, 'rate_limited'); return true; }
    }
    let rawPath = String(req.url || '');
    if (rawPath.length > 4096) { report(ip, 'bad_request', 'long url'); deny(res, 414, 'uri_too_long'); return true; }
    let decoded = rawPath;
    try { decoded = decodeURIComponent(rawPath.replace(/\+/g, ' ')); } catch (e) { report(ip, 'bad_request', 'bad encoding'); deny(res, 400, 'bad_request'); return true; }
    const path = decoded.split('?')[0];
    if (SCAN_RE.test(path)) { report(ip, 'scan', path.slice(0, 120)); deny(res, 404, 'not_found'); return true; }
    if (ATTACK_RE.test(decoded) || ATTACK_RE.test(rawPath)) { report(ip, 'attack', decoded.slice(0, 120)); deny(res, 400, 'bad_request'); return true; }
    if (!['GET', 'HEAD', 'POST', 'OPTIONS'].includes(req.method)) { report(ip, 'bad_method', req.method); deny(res, 405, 'method'); return true; }
    // CSRF: o'zgartiruvchi so'rov boshqa saytdan kelgan bo'lsa (Origin mos emas) — rad
    if (req.method === 'POST' && opts.checkOrigin) {
      const origin = req.headers.origin;
      if (origin && origin !== 'null' && !opts.allowedOrigin(origin, req)) { report(ip, 'csrf', origin.slice(0, 100)); deny(res, 403, 'bad_origin'); return true; }
    }
    // Javob kodiga qarab: 404 → skaner belgisi (rasm/css/js bundan mustasno — ular oddiy foydalanuvchida ham bo'lishi mumkin),
    // 413 → juda katta so'rov. Parol xatolari va limitlar modullarning o'zidan report() orqali keladi.
    res.on('finish', () => {
      const s = res.statusCode;
      if (s === 404 && !ASSET_RE.test(path)) report(ip, 'not_found', path.slice(0, 120));
      else if (s === 413) report(ip, 'too_large', path.slice(0, 120));
    });
    return false;
  }

  // Xotirani tozalash
  setInterval(() => {
    const t = now();
    scores.forEach((s, ip) => { if (s.score * Math.pow(0.5, (t - s.at) / HALF_LIFE_MS) < 0.5) scores.delete(ip); });
    flood.forEach((f, ip) => { if (t - f.start > 60000) flood.delete(ip); });
    bans.forEach((b, ip) => { if (b.until < t - 30 * 86400000) bans.delete(ip); });   // 30 kundan eski — xotiradan (bazada strikes qoladi)
  }, 60000).unref();

  function view() {
    const t = now();
    const list = q ? q.allBans.all().map(b => ({ ip: b.ip, until: b.until, active: b.until > t, strikes: b.strikes, reason: b.reason, manual: !!b.manual, at: b.updated_at }))
      : [...bans.entries()].map(([ip, b]) => ({ ip, until: b.until, active: b.until > t, strikes: b.strikes, reason: b.reason, manual: b.manual }));
    const watch = [...scores.entries()].map(([ip, s]) => ({ ip, score: Math.round(s.score * Math.pow(0.5, (t - s.at) / HALF_LIFE_MS) * 10) / 10 }))
      .filter(x => x.score >= 1).sort((a, b) => b.score - a.score).slice(0, 50);
    return {
      enabled, threshold: THRESHOLD, steps: BAN_STEPS_MIN,
      bans: list, activeBans: list.filter(b => b.active).length, watch,
      events: q ? q.events.all(200) : [],
      last24h: q ? Object.fromEntries(q.byKind.all(t - 86400000).map(r => [r.kind, r.n])) : {},
      counters: Object.assign({}, counters)
    };
  }

  return { guard, report, ban, unban, isBanned, headers, view, exempt };
}

module.exports = { createShield, SCAN_RE, ATTACK_RE, WEIGHTS };
