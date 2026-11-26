/*
 * TezBooking — DEMO rejim: server API'sini brauzer ichida taqlid qilish.
 *
 * Qachon yoqiladi: sayt GitHub Pages'da (*.github.io) ochilganda yoki manzilda ?demo bo'lsa (?demo=0 — o'chiradi).
 * Oddiy ishda (npm start, localhost:3000) bu fayl hech narsa qilmaydi.
 *
 * Nima qiladi: window.fetch va EventSource'ni "/api/..." so'rovlari uchun almashtiradi va server/*.js dagi
 * javoblarni xuddi shu ko'rinishda qaytaradi. Ma'lumotlar shu brauzerning localStorage'ida
 * (har bir tashrif buyuruvchining o'z demo nusxasi). Boshlang'ich ma'lumotlar: js/demo-seed.js.
 * Sayt va admin panel bir nechta oynada ochiq bo'lsa, o'zgarishlar BroadcastChannel orqali jonli yetib boradi.
 */
(function () {
  'use strict';

  const qs = new URLSearchParams(location.search);
  let on = /\.github\.io$/i.test(location.hostname) || qs.has('demo');
  try {
    if (qs.get('demo') === '0') { sessionStorage.removeItem('tezdemo.on'); on = false; }
    else if (qs.has('demo')) sessionStorage.setItem('tezdemo.on', '1');
    else if (sessionStorage.getItem('tezdemo.on')) on = true;
  } catch (e) { /* sessionStorage yo'q */ }
  if (!on) return;

  const KEY = 'tezdemo.v1';
  const DAY = 86400000;
  const LOGINS = () => window.TezDemoSeed.LOGINS;
  const realFetch = window.fetch.bind(window);
  const RealES = window.EventSource;
  const chan = 'BroadcastChannel' in window ? new BroadcastChannel('tezdemo') : null;
  const local = [];                         // shu oynadagi soxta EventSource'lar
  let version = 0;

  // ---------- Saqlash ----------
  let mem = null;
  function load() {
    if (mem) return mem;
    try { mem = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { mem = null; }
    if (!mem || !mem.agencies) mem = fresh();
    return mem;
  }
  function fresh() {
    const s = window.TezDemoSeed(window.TB, Date.now());
    return { tariffs: s.tariffs, agencies: s.agencies, payments: s.payments, bookings: s.bookings, events: s.events, seq: 1000 };
  }
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(mem)); } catch (e) { /* to'lgan */ }
  }
  // Boshqa oynada o'zgarsa — qayta o'qiladi
  window.addEventListener('storage', (e) => { if (e.key === KEY) mem = null; });
  const nid = (p) => p + '-' + Date.now().toString(36) + '-' + (++load().seq).toString(36);
  const sess = {
    get: (k) => { try { return localStorage.getItem('tezdemo.s.' + k); } catch (e) { return null; } },
    set: (k, v) => { try { v == null ? localStorage.removeItem('tezdemo.s.' + k) : localStorage.setItem('tezdemo.s.' + k, v); } catch (e) { /* yo'q */ } }
  };

  // ---------- Jonli xabarlar (SSE o'rniga) ----------
  function notify(reason) {
    version++;
    const msg = { v: version, reason };
    local.forEach(es => es._emit('bookings', msg));
    if (chan) chan.postMessage(msg);
  }
  if (chan) chan.onmessage = (e) => {
    mem = null;
    if (e.data && e.data.reason === 'agents') local.filter(es => /\/api\/admin\/agents\/events/.test(es.url)).forEach(es => es._emit('update', e.data));
    else local.forEach(es => es._emit('bookings', e.data));
  };

  class DemoEventSource {
    constructor(url) {
      this.url = url; this.readyState = 1; this._l = {};
      local.push(this);
      setTimeout(() => this._emit('hello', { v: version }), 30);
    }
    addEventListener(type, fn) { (this._l[type] = this._l[type] || []).push(fn); }
    removeEventListener(type, fn) { this._l[type] = (this._l[type] || []).filter(f => f !== fn); }
    _emit(type, data) { (this._l[type] || []).forEach(fn => fn({ type, data: JSON.stringify(data) })); }
    close() { this.readyState = 2; const i = local.indexOf(this); if (i >= 0) local.splice(i, 1); }
  }
  window.EventSource = function (url, opts) {
    return /\/api\/(events|admin\/agents\/events)(\?|$)/.test(String(url)) ? new DemoEventSource(url) : new RealES(url, opts);
  };

  // ---------- Yordamchilar (server/*.js bilan bir xil ko'rinish) ----------
  const today = () => { const n = new Date(); return new Date(Date.UTC(n.getFullYear(), n.getMonth(), n.getDate())).toISOString().slice(0, 10); };
  const isActive = (a) => !!a && a.status === 'active' && a.paid_until > Date.now();
  // Firma foizi (server/accounts.js bilan bir xil qoida): 0..50, 0.5 qadam; yo'q bo'lsa — 10
  const cleanMarkup = (v) => { const n = typeof v === 'string' ? Number(v.replace(',', '.')) : v; return typeof n === 'number' && isFinite(n) && n >= 0 && n <= 50 ? Math.round(n * 2) / 2 : null; };
  const markupOf = (a) => (a && typeof a.markup === 'number' ? a.markup : 10);
  const agencyById = (id) => load().agencies.find(a => a.id === id);
  const tariffView = (t) => ({ id: t.id, months: t.months, price: t.price, active: !!t.active });
  const bookingView = (b) => ({
    id: b.id, key: b.key, product: b.product, title: b.title, op: b.op, price: b.price, from: b.date_from, to: b.date_to,
    status: b.status, ref: null, at: b.created_at, updated: b.updated_at, agencyId: b.agency_id || null
  });
  function payView(p) {
    const a = agencyById(p.agency_id) || {};
    return { id: p.id, tariff: p.tariff_id, months: p.months, amount: p.amount, status: p.status, provider: p.provider, at: p.created_at,
      paidAt: p.paid_at, from: p.period_from, to: p.period_to, note: p.note || '', agencyId: p.agency_id, agency: a.name, login: a.login };
  }
  function agencyView(a) {
    const d = load();
    return { id: a.id, name: a.name, login: a.login, phone: a.phone, contact: a.contact, status: a.status,
      markup: markupOf(a), source: a.source || 'admin',
      paidUntil: a.paid_until || null, active: isActive(a), createdAt: a.created_at, lastLogin: a.last_login,
      bookings: d.bookings.filter(b => b.agency_id === a.id && b.status !== 'cancelled').length,
      paidTotal: d.payments.filter(p => p.agency_id === a.id && p.status === 'paid').reduce((s, p) => s + p.amount, 0),
      pending: d.payments.filter(p => p.agency_id === a.id && p.status === 'pending').length };
  }
  function me(a) {
    const d = load();
    const mine = d.payments.filter(p => p.agency_id === a.id).sort((x, y) => y.created_at - x.created_at);
    return { agency: { name: a.name, login: a.login, paidUntil: a.paid_until || null, active: isActive(a), markup: markupOf(a), phone: a.phone || '' },
      pending: mine.filter(p => p.status === 'pending').map(payView), payments: mine.slice(0, 20).map(payView) };
  }
  function datesFromKey(key) {
    const p = key.split('|'), dt = window.TB.date;
    if (p[0] === 'F') return dt.isValid(p[5]) ? { from: p[5], to: dt.isValid(p[6]) ? p[6] : p[5] } : { from: null, to: null };
    if (!dt.isValid(p[2])) return { from: null, to: null };
    return { from: p[2], to: dt.addDays(p[2], Math.max(1, Math.min(60, parseInt(p[3], 10) || 1)) - 1) };
  }
  function logEvent(b, type, payload) { load().events.push({ booking_id: b.id, type, payload: payload || null, at: Date.now() }); }
  function confirmPayment(p) {
    const a = agencyById(p.agency_id), now = Date.now();
    p.status = 'paid'; p.paid_at = now;
    p.period_from = Math.max(now, a.paid_until || 0);
    p.period_to = window.TezDemoSeed.addMonths(p.period_from, p.months);
    a.paid_until = p.period_to;
    return payView(p);
  }
  function stats() {
    const d = load(), t = today(), monthStart = Date.parse(t.slice(0, 8) + '01T00:00:00Z'), now = Date.now();
    const act = d.bookings.filter(b => b.status !== 'cancelled');
    const byStatus = {}, byProduct = {};
    d.bookings.forEach(b => { byStatus[b.status] = (byStatus[b.status] || 0) + 1; });
    act.forEach(b => { const x = byProduct[b.product] = byProduct[b.product] || { n: 0, sum: 0 }; x.n++; x.sum += b.price || 0; });
    const paid = d.payments.filter(p => p.status === 'paid');
    return {
      byStatus, byProduct, activeSum: act.reduce((s, b) => s + (b.price || 0), 0),
      thisMonth: d.bookings.filter(b => b.created_at >= monthStart).length,
      upcoming: act.filter(b => b.date_from >= t).length,
      inTrip: act.filter(b => b.date_from <= t && b.date_to >= t).length,
      agencies: d.agencies.length, paidAgencies: d.agencies.filter(a => a.status === 'active' && a.paid_until > now).length,
      pendingPayments: d.payments.filter(p => p.status === 'pending').length,
      revenueMonth: paid.filter(p => p.paid_at >= monthStart).reduce((s, p) => s + p.amount, 0),
      revenueTotal: paid.reduce((s, p) => s + p.amount, 0),
      paymentMode: 'demo'
    };
  }
  function genPassword() {
    const abc = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const r = new Uint8Array(12); crypto.getRandomValues(r);
    return Array.from(r, x => abc[x % abc.length]).join('');
  }

  // ---------- Javob ----------
  const json = (status, obj, headers) => new Response(JSON.stringify(obj), { status, headers: Object.assign({ 'Content-Type': 'application/json' }, headers || {}) });
  const ok = (obj) => json(200, obj);
  const err = (status, code, extra) => json(status, Object.assign({ error: code }, extra || {}));

  // ---------- Marshrutlar ----------
  async function route(method, path, search, body, hdr) {
    const d = load();
    const agency = (() => { const a = agencyById(sess.get('agency')); return a && a.status === 'active' ? a : null; })();
    const admin = sess.get('admin') === '1';
    const done = (r, reason) => { save(); if (reason) notify(reason); return r; };

    if (path === '/api/health') return ok({ service: 'tezbooking-ai', ok: true, hasKey: true, model: 'demo', guard: null, bookings: true, demo: true });
    if (path === '/api/chat') return chatReply(body);

    // --- Bronlar ---
    if (path === '/api/bookings' && method === 'GET') {
      const list = d.bookings.filter(b => b.status !== 'cancelled').map(b => (agency && b.agency_id === agency.id)
        ? { key: b.key, product: b.product, title: b.title, op: b.op, price: b.price, from: b.date_from, to: b.date_to, at: b.created_at, mine: true }
        : { key: b.key, mine: false });
      return ok({ bookings: list, v: version });
    }
    if (path === '/api/bookings' && method === 'POST') {
      if (!agency) return err(401, 'login_required');
      if (!isActive(agency)) return err(402, 'subscription_required');
      if (!body || typeof body.key !== 'string' || !body.title) return err(400, 'bad_request');
      const ex = d.bookings.find(b => b.key === body.key);
      if (ex && ex.status !== 'cancelled') return err(409, 'already_booked', { booking: bookingView(ex) });
      const now = Date.now(), dd = datesFromKey(body.key);
      let b = ex;
      if (b) Object.assign(b, { product: body.product, title: body.title, op: body.op || '', price: body.price, status: 'confirmed', updated_at: now, agency_id: agency.id });
      else {
        b = { id: nid('bk'), key: body.key, product: body.product || 'tour', title: String(body.title).slice(0, 200), op: String(body.op || '').slice(0, 200),
          price: typeof body.price === 'number' ? body.price : null, date_from: dd.from, date_to: dd.to, status: 'confirmed', created_at: now, updated_at: now, agency_id: agency.id };
        d.bookings.push(b);
      }
      logEvent(b, ex ? 'restored' : 'created', ex ? null : { price: b.price, source: 'site', agency: agency.name });
      return done(json(201, { booking: bookingView(b) }), 'created');
    }
    if (path === '/api/bookings/cancel' && method === 'POST') {
      if (!agency) return err(401, 'login_required');
      const b = d.bookings.find(x => x.key === (body && body.key));
      if (!b || b.status === 'cancelled') return err(404, 'not_found');
      if (b.agency_id !== agency.id) return err(403, 'not_yours');
      b.status = 'cancelled'; b.updated_at = Date.now(); logEvent(b, 'cancelled', { by: 'site' });
      return done(ok({ booking: bookingView(b) }), 'cancelled');
    }

    // --- Tur firma ---
    if (path === '/api/tariffs') return ok({ tariffs: d.tariffs.filter(t => t.active).map(tariffView), mode: 'demo', register: true, markupDefault: 10 });
    if (path === '/api/agency/register' && method === 'POST') {
      if (!body || body.website) return err(400, 'bad_request');
      const login = String(body.login || '').trim().toLowerCase();
      if (!/^[a-z0-9._-]{3,32}$/.test(login)) return err(400, 'bad_login');
      if (d.agencies.some(x => x.login === login)) return err(400, 'login_taken');
      const name = String(body.name || '').trim().slice(0, 120);
      if (name.length < 2) return err(400, 'bad_name');
      const markup = cleanMarkup(body.markup);
      if (markup === null) return err(400, 'bad_markup');
      const pw = String(body.password || '');
      if (pw.length < 8 || !/\d/.test(pw) || !/[^\d\W_]/.test(pw)) return err(400, 'weak_password');
      if (String(body.phone || '').replace(/\D/g, '').length < 9) return err(400, 'bad_phone');
      const ag = { id: nid('ag'), name, login, password: pw, phone: String(body.phone).trim().slice(0, 40), contact: String(body.contact || '').trim().slice(0, 120),
        status: 'active', paid_until: 0, created_at: Date.now(), last_login: Date.now(), markup, source: 'self' };
      d.agencies.push(ag); sess.set('agency', ag.id);
      return done(json(201, me(ag)), 'account');
    }
    if (path === '/api/agency/login') {
      const a = d.agencies.find(x => x.login === String((body && body.login) || '').trim().toLowerCase());
      if (!a || a.password !== (body && body.password)) return err(401, 'bad_login');
      if (a.status !== 'active') return err(403, 'blocked');
      a.last_login = Date.now(); sess.set('agency', a.id);
      return done(ok(me(a)));
    }
    if (path === '/api/agency/logout') { sess.set('agency', null); return ok({ ok: true }); }
    if (path.startsWith('/api/agency/')) {
      if (!agency) return err(401, 'login_required');
      if (path === '/api/agency/me') return ok(me(agency));
      if (path === '/api/agency/pay') {
        const t = d.tariffs.find(x => x.id === (body && body.tariff) && x.active);
        if (!t) return err(400, 'bad_tariff');
        const p = { id: nid('pay'), agency_id: agency.id, tariff_id: t.id, months: t.months, amount: t.price, status: 'pending', provider: 'demo', created_at: Date.now(), paid_at: null, period_from: null, period_to: null, note: null };
        d.payments.push(p); confirmPayment(p);                // demo: darhol to'langan
        return done(ok(Object.assign(me(agency), { payment: payView(p), mode: 'demo' })), 'payment');
      }
      if (path === '/api/agency/password') return ok({ ok: true });
      if (path === '/api/agency/markup') {
        const m = cleanMarkup(body && body.markup);
        if (m === null) return err(400, 'bad_markup');
        agency.markup = m;
        return done(ok(me(agency)));
      }
      if (path === '/api/agency/telegram-code') return ok({ code: String(100000 + Math.floor(Math.random() * 900000)), ttl: 600, demo: true });
      return err(404, 'not_found');
    }

    // --- Admin ---
    if (path.startsWith('/api/admin/')) {
      const r = path.slice('/api/admin'.length);
      if (r === '/login') {
        if (!body || body.password !== LOGINS().admin) return err(401, 'bad_password');
        sess.set('admin', '1'); return ok({ ok: true });
      }
      if (r === '/logout') { sess.set('admin', null); return ok({ ok: true }); }
      if (r === '/me') return ok({ authed: admin, siteUrl: './' });
      if (!admin) return err(401, 'unauthorized');
      if (r === '/agents' || r.startsWith('/agents/')) return agentsRoute(method, r.slice('/agents'.length), search, body, hdr || {});
      if (method === 'GET') {
        if (r === '/stats') return ok(stats());
        if (r === '/bookings') {
          const list = d.bookings.slice().sort((x, y) => y.created_at - x.created_at).map(b => Object.assign(bookingView(b), {
            events: d.events.filter(e => e.booking_id === b.id).length, agency: (agencyById(b.agency_id) || {}).name || '' }));
          return ok({ bookings: list, today: today() });
        }
        if (r === '/agencies') return ok({ agencies: d.agencies.slice().sort((x, y) => y.created_at - x.created_at).map(agencyView) });
        if (r === '/payments') return ok({ payments: d.payments.slice().sort((x, y) => y.created_at - x.created_at).map(payView) });
        if (r === '/tariffs') return ok({ tariffs: d.tariffs.map(tariffView) });
        // Xavfsizlik qalqoni brauzer demosida yo'q (u serverda ishlaydi) — bo'sh ko'rinish
        if (r === '/security') return ok({ enabled: false, demo: true, threshold: 10, steps: [15, 60, 360, 1440, 10080], bans: [], activeBans: 0, watch: [], events: [], last24h: {}, counters: {}, you: '127.0.0.1' });
        if (r === '/history') {
          const b = d.bookings.find(x => x.key === search.get('key'));
          return b ? ok({ events: d.events.filter(e => e.booking_id === b.id).map(e => ({ type: e.type, at: e.at, payload: e.payload })) }) : err(404, 'not_found');
        }
      }
      if (method === 'POST') {
        if (!body) return err(400, 'bad_request');
        const a = agencyById(body.id);
        if (r === '/cancel' || r === '/restore') {
          const b = d.bookings.find(x => x.key === body.key);
          const want = r === '/cancel' ? 'cancelled' : 'confirmed';
          if (!b || (r === '/cancel' ? b.status === 'cancelled' : b.status !== 'cancelled')) return err(409, 'no_change');
          b.status = want; b.updated_at = Date.now(); logEvent(b, r === '/cancel' ? 'cancelled' : 'restored', { by: 'admin' });
          return done(ok({ booking: bookingView(b) }), r === '/cancel' ? 'cancelled' : 'restored');
        }
        if (r === '/agencies') {
          const login = String(body.login || '').trim().toLowerCase();
          if (!/^[a-z0-9._-]{3,32}$/.test(login)) return err(400, 'bad_login');
          if (d.agencies.some(x => x.login === login)) return err(400, 'login_taken');
          const name = String(body.name || '').trim().slice(0, 120);
          if (!name) return err(400, 'bad_name');
          const password = body.password && String(body.password).length >= 8 ? String(body.password) : genPassword();
          const markup = body.markup == null || body.markup === '' ? 10 : cleanMarkup(body.markup);
          if (markup === null) return err(400, 'bad_markup');
          const ag = { id: nid('ag'), name, login, password, phone: String(body.phone || '').trim(), contact: String(body.contact || '').trim(), status: 'active', paid_until: 0, created_at: Date.now(), last_login: null, markup, source: 'admin' };
          d.agencies.push(ag);
          return done(json(201, { agency: agencyView(ag), password }), 'account');
        }
        if (r === '/agencies/update') {
          if (!a) return err(404, 'not_found');
          a.name = String(body.name || a.name).trim() || a.name; a.phone = String(body.phone || '').trim(); a.contact = String(body.contact || '').trim();
          if (body.markup != null && body.markup !== '') { const m = cleanMarkup(body.markup); if (m === null) return err(400, 'bad_markup'); a.markup = m; }
          return done(ok({ ok: true }));
        }
        if (r === '/agencies/reset') { if (!a) return err(404, 'not_found'); a.password = genPassword(); if (sess.get('agency') === a.id) sess.set('agency', null); return done(ok({ password: a.password }), 'account'); }
        if (r === '/agencies/status') {
          if (!a || !['active', 'blocked'].includes(body.status)) return err(404, 'not_found');
          a.status = body.status; if (a.status === 'blocked' && sess.get('agency') === a.id) sess.set('agency', null);
          return done(ok({ ok: true }), 'account');
        }
        if (r === '/agencies/extend') {
          const t = d.tariffs.find(x => x.id === body.tariff && x.active);
          if (!a || !t) return err(404, 'bad_tariff');
          const p = { id: nid('pay'), agency_id: a.id, tariff_id: t.id, months: t.months, amount: t.price, status: 'pending', provider: 'manual', created_at: Date.now(), paid_at: null, period_from: null, period_to: null, note: 'admin' };
          d.payments.push(p);
          return done(ok(confirmPayment(p)), 'account');
        }
        if (r === '/payments/confirm' || r === '/payments/cancel') {
          const p = d.payments.find(x => x.id === body.id);
          if (!p || p.status !== 'pending') return err(404, 'no_change');
          if (r === '/payments/cancel') { p.status = 'cancelled'; return done(ok({ ok: true }), 'account'); }
          return done(ok(confirmPayment(p)), 'account');
        }
        if (r === '/tariffs') {
          const t = d.tariffs.find(x => x.id === body.id), price = Math.round(Number(body.price));
          if (!t) return err(404, 'not_found');
          if (!isFinite(price) || price < 0) return err(400, 'bad_price');
          t.price = price; t.active = body.active !== false ? 1 : 0;
          return done(ok(tariffView(t)), 'account');
        }
      }
      return err(404, 'not_found');
    }
    return err(404, 'not_found');
  }

  // ---------- Agentlar (admin panel → Agentlar): Main Agent, navbat va ishchilar taqlidi ----------
  // Server: server/owner/*. Bu yerda ishchilar operator saytlariga bormaydi — takliflar saytning demo narx
  // generatoridan (js/data.js, TB.offersFor) olinadi. Holat vaqtga qarab hisoblanadi: sahifa yangilansa ham
  // vazifa "bajarilishda" davom etadi.
  // 6-ustun: agentlik kabinetiga login bilan kiradimi (serverda .env dagi OPERATOR_<ID>_LOGIN; demoda faqat holat ko'rsatiladi)
  const AG_SITES = [   // [id, nomi, sayt, js/data.js dagi operator id, demo ishchi bormi, kabinet logini]
    ['aqua', 'Aqua Travel', 'https://agency.aqua-travelgroup.com/tour-package', 'aqua', 0],
    ['asialuxe', 'Asialuxe', 'https://b2b.asialuxe.uz/login', 'asialuxe', 1, 1],
    ['crystalbay', 'Crystal Bay', 'https://booking.crystalbay.com/search_tour', 'crystalbay', 1, 1],
    ['kompas', 'Kompas Tour', 'https://online.uz.kompastour.com/search_tour', 'kompas', 1, 1],
    ['prestige', 'Prestige', 'http://online.uz-prestige.com/', 'prestige', 1, 1],
    ['pegas', 'Pegas', 'https://uz.pegast.asia/PackageSearch', 'pegas', 1, 1],
    ['vietra', 'Vietra Tour', 'https://b2b.vietratour.com/', 'vietratour', 1, 1],
    ['fstravel', 'FS Travel', 'https://b2b.fstravel.asia/menu?samo_action=logon', 'fstravel', 1, 1],
    ['kazunion', 'Kazunion', 'https://online.kazunion.com/', 'kazunion', 1, 1],
    ['kazunion-uae', 'Kazunion UAE', 'https://uae.kazunion.com', 'kazunionae', 0],
    ['centrum', 'Centrum Holidays', 'https://online.centrum-holidays.com/search_tour', 'centrum', 1, 1],
    ['flykhiva', 'Fly Khiva', 'https://b2b.flykhiva.travel/search_tour', 'flykhiva', 1],
    ['easybooking', 'Easybooking', 'https://tours.easybooking.uz/search_tour', 'easybooking', 1],
    ['selfie', 'Selfie Travel', 'http://b2b.selfietravel.kz/search_tour', 'selfie', 1],
    ['velikolepniy-vek', 'Velikolepniy Vek', 'https://velikolepniy-vek.com/login', 'vek', 0],
    ['rezlive', 'Rezlive', 'https://www.rezlive.com', 'rezlive', 0],
    ['savtour', 'Savtour', 'https://online.savtour.az/search_tour', 'savtour', 1],
    ['mir-jahon', 'Mir Jahon', 'https://online.mir-jahon.uz', 'mirjahon', 0],
    ['malva', 'Malva Tour', 'https://malvatouroperator.uz/search_tour', 'malva', 1]
  ];
  const AG_LIMITS = { workerConcurrency: [1, 50, 'worker_concurrency'], perOperatorConcurrency: [1, 10, 'per_operator_concurrency'],
    retryLimit: [0, 5, 'retry_limit'], searchTimeoutSeconds: [5, 300, 'search_timeout_seconds'], retentionDays: [1, 365, 'retention_days'] };
  const agentEs = () => local.filter(es => /\/api\/admin\/agents\/events/.test(es.url));
  function agentNotify() {
    agentEs().forEach(es => es._emit('update', { type: 'update', at: Date.now() }));
    if (chan) chan.postMessage({ v: version, reason: 'agents' });
  }
  function agents() {
    const d = load();
    if (!d.agents) {
      const now = Date.now();
      d.agents = {
        sites: AG_SITES.map(([id, name, url, op, worker]) => ({ id, name, url, op, worker: !!worker, enabled: !!worker,
          integrationStatus: worker ? 'verified' : 'pending', createdAt: now })),
        settings: { worker_concurrency: 3, per_operator_concurrency: 1, retry_limit: 2, search_timeout_seconds: 45, retention_days: 90 },
        tasks: [], alerts: [], idem: {}
      };
      save();
    }
    // Avvalgi demo nusxasi (brauzerda saqlangan): yangi ulangan ishchilar va kabinet logini qo'shiladi, foydalanuvchi o'chirganlari o'zgarmaydi
    if (d.agents.v !== 2) {
      d.agents.sites.forEach(s => {
        const row = AG_SITES.find(r => r[0] === s.id);
        if (row && row[4] && !s.worker) Object.assign(s, { worker: true, enabled: true, integrationStatus: 'verified' });
      });
      d.agents.v = 2;
      save();
    }
    return d.agents;
  }
  const hasLogin = (siteId) => { const row = AG_SITES.find(r => r[0] === siteId); return !!(row && row[5]); };
  // Mehmonxona nomi mosligi (server/live/hotel-match.js bilan bir xil qoida, eski nom va yulduz hisobga olinmaydi)
  const HOTEL_GENERIC = ['hotel', 'hotels', 'otel', 'отель', 'resort', 'resorts', 'spa', 'the', 'and', 'by'];
  const hWords = (s) => String(s || '').toLowerCase().replace(/ё/g, 'е').replace(/[^\p{L}\p{N}]+/gu, ' ').trim().split(' ').filter(Boolean);
  function hotelMatch(name, wanted) {
    const core = String(wanted || '').replace(/\([^)]*\)/g, ' ').replace(/(^|[\s,.;-])(ex|former|formerly)([.\s-]).*$/i, '$1').replace(/\b\d\s*\*+|\*+|★+/g, ' ');
    const all = hWords(core.trim() ? core : wanted).filter(w => w.length >= 2 || /\d/.test(w));
    const key = all.filter(w => HOTEL_GENERIC.indexOf(w) < 0);
    const tokens = key.length ? key : all;
    const text = ' ' + hWords(name).join(' ');
    return !tokens.length || tokens.every(t => text.indexOf(' ' + t) >= 0);
  }
  const opOf = (site) => (window.TB.OPS || []).find(o => o.id === site.op);
  // Ishchining shu yo'nalishni sotishi: js/data.js dagi operator cheklovlari (countries, hotelOnly)
  const supports = (site, p) => { const o = opOf(site); return !!o && !o.hotelOnly && (!o.countries || o.countries.indexOf(p.country) >= 0); };
  const hrnd = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0) / 4294967296; };

  function validParams(p) {
    if (!p || typeof p !== 'object') return null;
    const country = window.TezAgentParser ? window.TezAgentParser.countryCode(p.country) : p.country;
    const ages = Array.isArray(p.childrenAges) ? p.childrenAges : [];
    const ok = typeof p.destination === 'string' && p.destination.trim() && p.destination.length <= 120 && window.TB.byId[country] &&
      window.TB.date.isValid(p.date) && p.date >= today() && p.date <= window.TB.date.addDays(today(), 365) &&
      Number.isInteger(p.nights) && p.nights >= 1 && p.nights <= 30 && Number.isInteger(p.adults) && p.adults >= 1 && p.adults <= 8 &&
      ages.length <= 4 && ages.every(a => Number.isInteger(a) && a >= 0 && a <= 17) &&
      (p.budget == null || (Number.isFinite(p.budget) && p.budget > 0)) && (p.currency == null || ['USD', 'EUR', 'UZS'].includes(String(p.currency).toUpperCase())) &&
      (p.departureAirport == null || window.TB.FROM.some(f => f.id === p.departureAirport)) &&
      (p.hotelStars == null || (Number.isInteger(p.hotelStars) && p.hotelStars >= 1 && p.hotelStars <= 5)) &&
      (p.hotelName == null || p.hotelName === '' || (typeof p.hotelName === 'string' && p.hotelName.length <= 80));
    return ok ? { destination: p.destination.trim(), country, date: p.date, nights: p.nights, adults: p.adults, childrenAges: ages,
      budget: p.budget == null ? null : p.budget, currency: String(p.currency || 'USD').toUpperCase(), mealPlan: p.mealPlan || null,
      hotelStars: p.hotelStars == null ? null : p.hotelStars, departureAirport: p.departureAirport || null,
      hotelName: typeof p.hotelName === 'string' && p.hotelName.trim() ? p.hotelName.replace(/\s+/g, ' ').trim() : null } : null;
  }
  const ASK_FIELDS = ['destination', 'country', 'date', 'adults', 'nights', 'childrenAges'];
  function missingOf(p, suggested) {
    const m = new Set(suggested || []);
    if (!p.destination) m.add('destination');
    if (!p.country || !window.TB.byId[p.country]) m.add('country');
    if (!p.date || !window.TB.date.isValid(p.date) || p.date < today()) m.add('date');
    if (!Number.isInteger(p.adults) || p.adults < 1 || p.adults > 8) m.add('adults');
    if (!Number.isInteger(p.nights) || p.nights < 1 || p.nights > 30) m.add('nights');
    return ASK_FIELDS.filter(f => m.has(f));
  }

  // Ishchi natijasi: shu operatorning shu yo'nalishdagi demo takliflari (eng arzon 8 tasi)
  function workerOffers(site, p) {
    const TB = window.TB, o = opOf(site);
    const city = p.destination.toLowerCase().replace(/[^a-z]/g, '');
    let hotels = TB.HOTELS.filter(h => h.country === p.country);
    const inCity = hotels.filter(h => city.indexOf(h.city) === 0 || h.city.indexOf(city) === 0);
    if (inCity.length) hotels = inCity;
    // Mehmonxona bo'yicha topshiriq: faqat shu mehmonxona (kurortdan qat'i nazar, davlat ichida)
    if (p.hotelName) hotels = TB.HOTELS.filter(h => h.country === p.country && hotelMatch(h.name, p.hotelName));
    const q = { from: p.departureAirport || 'tas', nights: p.nights, adults: p.adults, childAges: p.childrenAges, rooms: 1 };
    const rate = p.currency === 'UZS' ? TB.UZS_RATE : p.currency === 'EUR' ? 0.92 : 1;
    const list = [];
    hotels.forEach(h => TB.offersFor(h, q, p.date).forEach(x => {
      if (x.op.id !== o.id) return;
      const total = Math.round(x.price * rate);
      if (p.budget && total > p.budget) return;
      if (p.mealPlan && x.meal !== p.mealPlan) return;
      list.push({ hotelName: h.name + ' ' + '★'.repeat(h.stars), operatorName: site.name, totalPrice: total, currency: p.currency,
        mealPlan: x.meal, availability: x.avail === 'ok' ? 'available' : x.avail === 'few' ? 'few_left' : 'on_request',
        verificationStatus: 'verified', hotelKey: h.id });
    }));
    return list.sort((a, b) => a.totalPrice - b.totalPrice).slice(0, 8);
  }

  function createTask(params, command, idemKey) {
    const ag = agents();
    if (idemKey && ag.idem[idemKey]) { const t = ag.tasks.find(x => x.id === ag.idem[idemKey]); if (t) return { task: taskView(t), duplicate: true }; }
    const now = Date.now();
    const chosen = ag.sites.filter(s => s.enabled && s.integrationStatus === 'verified' && s.worker && supports(s, params));
    const conc = Math.max(1, ag.settings.worker_concurrency);
    const id = 'task-' + now.toString(36) + '-' + Math.random().toString(36).slice(2, 8);
    const t = { id, command: command || params.destination + ', ' + params.nights + ' kecha, ' + params.adults + ' kishi, ' + params.date,
      parameters: params, createdAt: now, cancelledAt: null, workers: [] };
    // Ishchilar navbat bilan: bir vaqtda ko'pi bilan worker_concurrency tasi; ~10 % — kutish vaqti tugashi (xato)
    let slots = new Array(conc).fill(now + 500);
    chosen.forEach(s => {
      slots.sort((a, b) => a - b);
      const start = slots[0], dur = 900 + Math.round(hrnd(id + s.id) * 2200);
      const failed = hrnd(id + s.id + 'f') < 0.1;
      slots[0] = start + dur;
      t.workers.push({ site: s.id, name: s.name, start, end: start + dur, failed, offers: failed ? [] : workerOffers(s, params) });
    });
    ag.tasks.unshift(t);
    ag.tasks = ag.tasks.slice(0, 50);
    if (idemKey) ag.idem[idemKey] = id;
    t.workers.filter(w => w.failed).forEach(w => ag.alerts.unshift({ id: 'al-' + id + '-' + w.site, type: 'worker_timeout',
      message: w.name + ': ishchi javob bermadi (kutish vaqti tugadi)', createdAt: w.end, status: 'open', taskId: id }));
    save();
    scheduleTask(t);
    agentNotify();
    return { task: taskView(t), selectedWorkers: chosen.length };
  }
  function scheduleTask(t) {
    const now = Date.now();
    [...new Set([].concat(...t.workers.map(w => [w.start, w.end])))].filter(x => x > now)
      .forEach(x => setTimeout(agentNotify, x - now + 30));
  }
  function workerState(t, w, now) {
    if (t.cancelledAt && t.cancelledAt < w.end) return 'cancelled';
    if (now < w.start) return 'queued';
    if (now < w.end) return 'running';
    return w.failed ? 'failed' : 'completed';
  }
  function taskView(t) {
    const now = Date.now(), st = t.workers.map(w => workerState(t, w, now));
    const done = st.filter(s => s === 'completed').length, failed = st.filter(s => s === 'failed').length;
    const fin = st.filter(s => s !== 'queued' && s !== 'running').length;
    let status;
    if (!t.workers.length) status = 'blocked';
    else if (t.cancelledAt && st.some(s => s === 'cancelled')) status = 'cancelled';
    else if (st.some(s => s === 'running')) status = 'running';
    else if (st.some(s => s === 'queued')) status = now < t.workers[0].start ? 'queued' : 'running';
    else status = failed === st.length ? 'failed' : failed ? 'partial' : 'completed';
    const offers = t.workers.reduce((n, w, i) => n + (st[i] === 'completed' ? w.offers.length : 0), 0);
    return { id: t.id, command: t.command, parameters: t.parameters, status, createdAt: t.createdAt,
      totalWorkers: t.workers.length, completedWorkers: done, failedWorkers: failed,
      progressPercent: t.workers.length ? Math.round(fin / t.workers.length * 100) : 0, offersFound: offers,
      errorCode: !t.workers.length ? 'no_verified_adapters' : null };
  }
  function siteView(s, tasks, now) {
    const running = tasks.some(t => t.workers.some(w => w.site === s.id && workerState(t, w, now) === 'running'));
    const last = Math.max(0, ...[].concat(...tasks.map(t => t.workers.filter(w => w.site === s.id && workerState(t, w, now) === 'completed').map(w => w.end))));
    // Kabinet: login bor operatorga birinchi qidiruvdan keyin "Kirildi", undan oldin "Login bor"
    const login = s.worker && hasLogin(s.id);
    return { id: s.id, name: s.name, url: s.url, enabled: s.enabled, integrationStatus: s.integrationStatus,
      workerStatus: !s.worker ? 'pending' : running ? 'running' : 'idle', lastSuccessfulSearch: last || null,
      authStatus: !login ? 'not_configured' : last ? 'authenticated' : 'required', lastSuccessfulLogin: login && last ? last : null };
  }

  function agentsRoute(method, r, search, body, hdr) {
    const ag = agents(), now = Date.now();
    const limit = Math.max(1, Math.min(100, parseInt(search.get('limit'), 10) || 50));
    const views = () => ag.tasks.map(taskView);
    if (method === 'GET') {
      if (r === '/overview') {
        const v = views();
        const doneT = ag.tasks.filter((t, i) => ['completed', 'partial'].includes(v[i].status) && t.workers.length);
        return ok({
          websites: { configured: ag.sites.length, enabled: ag.sites.filter(s => s.enabled).length, verified: ag.sites.filter(s => s.integrationStatus === 'verified').length,
            pending: ag.sites.filter(s => s.integrationStatus === 'pending').length, running: 0, failed: 0 },
          tasks: { active: v.filter(t => ['queued', 'running'].includes(t.status)).length, completed: v.filter(t => t.status === 'completed').length,
            partial: v.filter(t => t.status === 'partial').length, failed: v.filter(t => t.status === 'failed').length,
            averageCompletionMs: doneT.length ? Math.round(doneT.reduce((s, t) => s + Math.max(...t.workers.map(w => w.end)) - t.createdAt, 0) / doneT.length) : null },
          openAlerts: ag.alerts.filter(a => a.status === 'open' && a.createdAt <= now).length, runtime: {}
        });
      }
      if (r === '/main-agent') {
        const st = [].concat(...ag.tasks.map(t => t.workers.map(w => workerState(t, w, now))));
        const v = views();
        return ok({ workerCounts: { running: st.filter(s => s === 'running').length, blocked: v.filter(t => t.status === 'blocked').length,
          completed: st.filter(s => s === 'completed').length }, latestTask: v[0] || null, browserWorkers: 'demo_simulated',
        agentStatus: { parser: 'deterministic', llmEnabled: false, llmProvider: null, llmConfigurationError: null,
          adaptersRegistered: ag.sites.filter(s => s.worker).length } });
      }
      if (r === '/websites') return ok({ websites: ag.sites.map(s => siteView(s, ag.tasks, now)) });
      if (r === '/searches') return ok({ tasks: views().slice(0, limit) });
      if (r === '/alerts') return ok({ alerts: ag.alerts.filter(a => a.createdAt <= now).slice(0, limit) });
      if (r === '/activities') return ok({ activities: [] });
      if (r === '/settings') return ok({ settings: ag.settings });
      if (r === '/logs') {
        const logs = [].concat(...ag.tasks.map(t => t.workers.map(w => ({ t, w, s: workerState(t, w, now) }))))
          .filter(x => ['completed', 'failed'].includes(x.s))
          .map(x => ({ website: x.w.name, eventType: x.s === 'failed' ? 'worker_failed' : 'worker_completed', at: x.w.end, status: x.s, attempts: x.w.failed ? ag.settings.retry_limit + 1 : 1,
            errorCode: x.w.failed ? 'worker_timeout' : null, message: x.w.failed ? 'Javob kutish vaqti tugadi' : x.w.offers.length + ' ta taklif · ' + x.t.parameters.destination }))
          .sort((a, b) => b.at - a.at);
        return ok({ logs: logs.slice(0, limit) });
      }
      let m = r.match(/^\/searches\/([\w-]+)$/);
      if (m) { const t = ag.tasks.find(x => x.id === m[1]); return t ? ok({ task: taskView(t) }) : err(404, 'not_found'); }
      m = r.match(/^\/searches\/([\w-]+)\/offers$/);
      if (m) {
        const t = ag.tasks.find(x => x.id === m[1]); if (!t) return err(404, 'not_found');
        const offers = [].concat(...t.workers.filter(w => workerState(t, w, now) === 'completed').map(w => w.offers));
        const groups = {};
        offers.forEach(o => { (groups[o.hotelKey] = groups[o.hotelKey] || []).push(o); });
        const comparison = Object.keys(groups).map(k => ({ identityVerified: true, offers: groups[k].sort((a, b) => a.totalPrice - b.totalPrice) }))
          .sort((a, b) => a.offers[0].totalPrice - b.offers[0].totalPrice);
        return ok({ offers, comparison });
      }
      return err(404, 'not_found');
    }
    if (!body) return err(400, 'bad_request');
    if (r === '/agent/searches' && method === 'POST') {
      const P = window.TezAgentParser;
      if (!P) return err(503, 'agent_not_configured');
      if (typeof body.command !== 'string' || !body.command.trim() || body.command.length > 4000) return err(400, 'bad_command');
      const res = P.parseNaturalLanguage(body.command.trim());
      const p = res.parameters;
      const missing = missingOf(p, res.missing);
      const params = !missing.length && validParams(p);
      if (!params) return ok({ status: 'needs_clarification', parserMode: 'deterministic', parameters: p, missing: missing.length ? missing : ['date'] });
      const out = createTask(params, body.command.trim(), hdr['idempotency-key']);
      return json(out.duplicate ? 200 : 201, Object.assign(out, { status: 'task_created', parserMode: 'deterministic' }));
    }
    if (r === '/searches' && method === 'POST') {
      const params = validParams(body.parameters);
      if (!params) return err(400, 'bad_search_parameters');
      const out = createTask(params, typeof body.command === 'string' ? body.command.slice(0, 400) : '', hdr['idempotency-key']);
      return json(out.duplicate ? 200 : 201, out);
    }
    let m = r.match(/^\/searches\/([\w-]+)\/cancel$/);
    if (m && method === 'POST') {
      const t = ag.tasks.find(x => x.id === m[1]);
      if (!t || !['queued', 'running', 'blocked'].includes(taskView(t).status)) return err(409, 'invalid_task_transition');
      t.cancelledAt = now; save(); agentNotify();
      return ok({ task: taskView(t) });
    }
    m = r.match(/^\/alerts\/([\w-]+)\/resolve$/);
    if (m && method === 'POST') {
      const a = ag.alerts.find(x => x.id === m[1]); if (!a) return err(404, 'not_found');
      a.status = 'resolved'; save(); agentNotify(); return ok({ ok: true });
    }
    if (r === '/settings' && method === 'POST') {
      const next = Object.assign({}, ag.settings);
      for (const k of Object.keys(AG_LIMITS)) {
        if (body[k] === undefined) continue;
        const [lo, hi, col] = AG_LIMITS[k];
        if (!Number.isInteger(body[k]) || body[k] < lo || body[k] > hi) return err(400, 'bad_settings');
        next[col] = body[k];
      }
      if (next.per_operator_concurrency > next.worker_concurrency) return err(400, 'bad_settings');
      ag.settings = next; save(); agentNotify(); return ok({ settings: next });
    }
    if (r === '/websites' && method === 'POST') {
      const name = String(body.name || '').trim(), url = String(body.url || '').trim();
      if (!name || name.length > 120 || !/^https:\/\/[^\s/]+\.[^\s]+$/i.test(url)) return err(400, 'bad_website');
      const s = { id: 'site-' + Date.now().toString(36), name, url, op: '', worker: false, enabled: false, integrationStatus: 'pending', createdAt: now };
      ag.sites.push(s); save(); agentNotify();
      return json(201, { website: siteView(s, ag.tasks, now) });
    }
    m = r.match(/^\/websites\/([\w-]+)$/);
    if (m && method === 'PATCH') {
      const s = ag.sites.find(x => x.id === m[1]); if (!s) return err(404, 'not_found');
      if (typeof body.enabled !== 'boolean') return err(400, 'bad_website');
      s.enabled = body.enabled; save(); agentNotify();
      return ok({ website: siteView(s, ag.tasks, now) });
    }
    return err(404, 'not_found');
  }
  // Sahifa ochilganda: hali tugamagan vazifalar uchun jonli yangilanishlar
  try { const d = load(); if (d.agents) d.agents.tasks.forEach(scheduleTask); } catch (e) { /* yo'q */ }

  // AI yordamchi: demo'da Claude API'siz — qisqa tushuntirish
  function chatReply(body) {
    const lang = (body && body.lang) || 'uz';
    const text = {
      uz: "Bu — TezBooking'ning demo versiyasi. AI yordamchi to'liq versiyada ishlaydi: u yo'nalishlar, viza, mavsum va narxlar bo'yicha savollarga javob beradi va ekrandagi qidiruv natijalaridan mijozga taklif tayyorlab beradi.",
      ru: 'Это демо-версия TezBooking. AI-помощник работает в полной версии: отвечает на вопросы о направлениях, визах, сезонах и ценах и готовит предложение клиенту по результатам поиска.',
      en: "This is the TezBooking demo. The AI assistant works in the full version: it answers questions about destinations, visas, seasons and prices, and drafts client offers from your search results."
    }[lang] || '';
    return new Response(text, { status: 200, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  }

  // ---------- fetch'ni almashtirish ----------
  window.fetch = async function (input, init) {
    const url = new URL(typeof input === 'string' ? input : input.url, location.href);
    const m = url.pathname.match(/\/api\/.*$/);
    if (!m || url.origin !== location.origin && !/^https?:\/\/localhost/.test(url.origin)) return realFetch(input, init);
    // localhost:3000 ga so'rovlar ham demo'ga (sayt fayldan ochilgan bo'lsa)
    const method = ((init && init.method) || 'GET').toUpperCase();
    let body = null;
    if (init && typeof init.body === 'string') { try { body = JSON.parse(init.body); } catch (e) { body = null; } }
    const hdr = {};
    try { new Headers((init && init.headers) || {}).forEach((v, k) => { hdr[k.toLowerCase()] = v; }); } catch (e) { /* yo'q */ }
    await new Promise(r => setTimeout(r, 120 + Math.random() * 180));    // tarmoqdek kichik kechikish
    try { return await route(method, m[0], url.searchParams, body, hdr); }
    catch (e) { console.error('[demo]', e); return err(500, 'server'); }
  };

  // ---------- Demo bannari ----------
  function banner() {
    const isAdmin = /admin(\.html)?$/.test(location.pathname) || !!document.getElementById('admin');
    const L = LOGINS();
    const el = document.createElement('div');
    el.className = 'demo-ribbon';
    el.setAttribute('role', 'note');
    el.innerHTML = `
      <b>DEMO</b>
      <span>${isAdmin
        ? `Admin paroli: <code>${L.admin}</code>`
        : `Tur firma: <code>${L.agency.login}</code> / <code>${L.agency.password}</code> · tarifsiz: <code>${L.fresh.login}</code>`}</span>
      <a href="${isAdmin ? './' : 'admin.html'}" target="_blank" rel="noopener">${isAdmin ? 'Saytni ochish' : 'Admin panel'} ↗</a>
      <button type="button" data-demo-reset title="Demo ma'lumotlarini boshlang'ich holatga qaytarish">Qayta boshlash</button>
      <button type="button" data-demo-hide aria-label="Yopish">×</button>`;
    document.body.appendChild(el);
    el.querySelector('[data-demo-reset]').addEventListener('click', () => {
      if (!confirm("Demo ma'lumotlari boshlang'ich holatga qaytarilsinmi?")) return;
      try { Object.keys(localStorage).filter(k => k.indexOf('tezdemo.') === 0 || k.indexOf('tezbooking.') === 0).forEach(k => localStorage.removeItem(k)); } catch (e) { /* yo'q */ }
      if (chan) chan.postMessage({ v: ++version, reason: 'reset' });
      location.reload();
    });
    el.querySelector('[data-demo-hide]').addEventListener('click', () => el.remove());
    const css = document.createElement('style');
    css.textContent = `
      .demo-ribbon{position:fixed;left:16px;bottom:calc(var(--dock-h,0px) + 16px);z-index:45;display:flex;align-items:center;gap:10px;flex-wrap:wrap;
        max-width:calc(100vw - 120px);padding:6px 8px 6px 12px;border-radius:999px;background:rgba(10,35,80,.92);color:#fff;font:600 12.5px/1.3 Inter,system-ui,sans-serif;
        box-shadow:0 8px 24px rgba(0,0,0,.25);backdrop-filter:blur(8px)}
      .demo-ribbon b{background:linear-gradient(135deg,#FF9600,#0079E6);color:#0B2350;padding:2px 8px;border-radius:999px;font-size:11px;letter-spacing:.06em}
      .demo-ribbon code{background:rgba(255,255,255,.14);padding:1px 6px;border-radius:6px;font-size:12px;user-select:all}
      .demo-ribbon a{color:#FFC266;text-decoration:none}
      .demo-ribbon button{border:0;border-radius:999px;background:rgba(255,255,255,.12);color:#fff;font:inherit;padding:4px 10px;cursor:pointer;min-height:28px}
      .demo-ribbon [data-demo-hide]{width:28px;padding:0;font-size:16px}
      @media (max-width:760px){.demo-ribbon{left:8px;bottom:calc(var(--dock-h,0px) + 84px);max-width:calc(100vw - 16px);border-radius:16px}}`;
    document.head.appendChild(css);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', banner); else banner();

  window.TezDemo = { reset: () => { mem = fresh(); save(); notify('reset'); }, data: () => load() };
})();
