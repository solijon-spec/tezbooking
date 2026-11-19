/*
 * TezBooking — demo ma'lumotlar (tur firmalar, to'lovlar, bronlar).
 *
 * Ikki joyda ishlatiladi:
 *   - brauzerdagi demo (js/demo-api.js, GitHub Pages)  -> window.TezDemoSeed(TB, now)
 *   - lokal demo baza (server/demo-seed.js, npm run demo) -> require('../js/demo-seed.js')(TB, now)
 *
 * Bronlar saytning o'z narx generatoridan (js/data.js -> TB) olinadi, shuning uchun ular qidiruvdagi
 * haqiqiy takliflarga mos keladi va bron qilinganlari qidiruvdan yashiriladi.
 * Sanalar bugungi kunga nisbatan: demo har kuni "yangi" ko'rinadi.
 */
(function (root) {
  'use strict';

  const DAY = 86400000;
  const TARIFFS = [
    { id: 'm3', months: 3, price: 450000, active: 1 },
    { id: 'm6', months: 6, price: 800000, active: 1 },
    { id: 'm12', months: 12, price: 1400000, active: 1 }
  ];
  // Demo kirish ma'lumotlari (faqat demo uchun!)
  const LOGINS = {
    agency: { login: 'demo', password: 'demo12345' },        // tarifi faol firma
    fresh: { login: 'yangi', password: 'demo12345' },        // tarifsiz firma — sotib olishni sinash uchun
    admin: 'admin12345'                                        // demo admin paroli
  };

  function addMonths(ms, months) {
    const d = new Date(ms);
    const day = d.getUTCDate();
    d.setUTCDate(1);
    d.setUTCMonth(d.getUTCMonth() + months);
    const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
    d.setUTCDate(Math.min(day, last));
    return d.getTime();
  }

  function build(TB, nowMs) {
    const now = nowMs || Date.now();
    const dt = TB.date;
    const n = new Date(now);
    const today = dt.iso(new Date(Date.UTC(n.getFullYear(), n.getMonth(), n.getDate())));
    let seq = 0;
    const id = (p) => p + '-demo-' + (++seq).toString(36).padStart(4, '0');

    // ---------- Tur firmalar ----------
    const A = [
      ['Sayyoh Travel', LOGINS.agency.login, '+998 90 123 45 67', 'Aziza Karimova', 'active', 210],
      ['Orzu Tour', 'orzu', '+998 91 555 12 34', 'Jasur Aliyev', 'active', 260],
      ['Samarqand Voyage', 'samvoyage', '+998 93 777 88 99', 'Dilnoza Rahimova', 'active', 95],
      ['Buxoro Sayohat', 'buxoro', '+998 94 222 33 44', 'Sardor Toshev', 'active', 3],
      ['Navbahor Travel', 'navbahor', '+998 97 410 20 30', 'Malika Yusupova', 'active', 140],
      ['Silk Road Agency', 'silkroad', '+998 99 300 40 50', 'Bekzod Umarov', 'blocked', 40],
      ['Yangi Firma (demo)', LOGINS.fresh.login, '+998 90 000 00 00', 'Sinov uchun', 'active', 1]
    ].map(([name, login, phone, contact, status, daysAgo]) => ({
      id: id('ag'), name, login, password: login === LOGINS.agency.login || login === LOGINS.fresh.login ? LOGINS.agency.password : 'demo-' + login,
      phone, contact, status, paid_until: 0, created_at: now - daysAgo * DAY,
      last_login: status === 'active' && daysAgo > 2 ? now - (1 + (daysAgo % 5)) * DAY - (daysAgo % 9) * 3600000 : null
    }));

    // ---------- To'lovlar (ketma-ket: har biri tarif muddatini uzaytiradi) ----------
    const payments = [];
    function pay(ai, tariffId, daysAgo, status, provider) {
      const a = A[ai], t = TARIFFS.find(x => x.id === tariffId), at = now - daysAgo * DAY;
      const p = { id: id('pay'), agency_id: a.id, tariff_id: t.id, months: t.months, amount: t.price, status, provider: provider || 'manual',
        created_at: at - 2 * 3600000, paid_at: null, period_from: null, period_to: null, note: null };
      if (status === 'paid') {
        p.paid_at = at;
        p.period_from = Math.max(at, a.paid_until);
        p.period_to = addMonths(p.period_from, t.months);
        a.paid_until = p.period_to;
      }
      payments.push(p);
    }
    pay(0, 'm12', 6, 'paid');                  // Sayyoh — 1 yillik, faol (shu oy tushumida ko'rinadi)
    pay(1, 'm3', 240, 'paid'); pay(1, 'm6', 150, 'paid');   // Orzu — uzaytirgan, ~1 oy qolgan
    pay(2, 'm3', 80, 'paid');                  // Samarqand — 10 kun ichida tugaydi
    pay(3, 'm6', 1, 'pending');                // Buxoro — to'lov tasdiqlanishini kutmoqda
    pay(4, 'm3', 120, 'paid');                 // Navbahor — muddati tugagan
    pay(5, 'm3', 20, 'paid');                  // Silk Road — bloklangan
    pay(2, 'm6', 30, 'cancelled');             // bekor qilingan so'rov (tarix uchun)

    // ---------- Bronlar (haqiqiy takliflardan) ----------
    const bookings = [], events = [];
    const tourQ = (nights, hotel) => ({ from: 'tas', nights, adults: 2, childAges: [], rooms: 1, noFlight: !!hotel });
    function pickOffer(seed, offset, nights, hotel) {
      const date = dt.addDays(today, offset);
      for (let k = 0; k < TB.HOTELS.length; k++) {
        const h = TB.HOTELS[(seed * 7 + k * 3) % TB.HOTELS.length];
        const o = TB.offersFor(h, tourQ(nights, hotel), date).find(x => x.avail === 'ok' || x.avail === 'few');
        if (o) return { key: o.key, product: hotel ? 'hotel' : 'tour', title: h.name, op: o.op.name, price: o.price, from: date, to: dt.addDays(date, nights - 1) };
      }
      return null;
    }
    function pickFlight(seed, offset, days) {
      const date = dt.addDays(today, offset), ret = dt.addDays(date, days);
      const dests = ['tr', 'ae', 'ge', 'eg', 'th', 'my'];
      for (let k = 0; k < dests.length; k++) {
        const f = TB.flightsFor({ from: 'tas', to: dests[(seed + k) % dests.length], ret, adults: 2, childAges: [], cabin: 'eco' }, date)[0];
        if (f) return { key: f.key, product: 'flight', title: f.no + ' ' + f.fromCode + ' → ' + f.toCode, op: f.al.name, price: f.price, from: date, to: ret };
      }
      return null;
    }
    // [firma, turi, necha kundan keyin, tunlar/kunlar, holat, necha kun oldin yaratilgan]
    const PLAN = [
      [0, 'tour', 5, 7, 'confirmed', 3], [0, 'hotel', 12, 5, 'confirmed', 2], [0, 'flight', 20, 7, 'confirmed', 1],
      [0, 'tour', -3, 7, 'confirmed', 21], [0, 'tour', 35, 10, 'cancelled', 6],
      [1, 'tour', 8, 7, 'confirmed', 4], [1, 'tour', 15, 9, 'confirmed', 9], [1, 'hotel', -2, 4, 'confirmed', 12], [1, 'flight', 9, 10, 'confirmed', 5],
      [2, 'tour', 25, 7, 'confirmed', 2], [2, 'hotel', 3, 3, 'confirmed', 7],
      [4, 'tour', -40, 7, 'confirmed', 62]
    ];
    PLAN.forEach(([ai, kind, offset, len, status, daysAgo], i) => {
      const o = kind === 'flight' ? pickFlight(i, offset, len) : pickOffer(i + 1, offset, len, kind === 'hotel');
      if (!o || bookings.some(b => b.key === o.key)) return;
      const a = A[ai], at = now - daysAgo * DAY - (i % 6) * 2400000;
      const b = { id: id('bk'), key: o.key, product: o.product, title: o.title, op: o.op, price: o.price,
        date_from: o.from, date_to: o.to, status, created_at: at, updated_at: at, agency_id: a.id };
      bookings.push(b);
      events.push({ booking_id: b.id, type: 'created', payload: { price: o.price, source: 'site', agency: a.name }, at });
      if (status === 'cancelled') { b.updated_at = at + DAY; events.push({ booking_id: b.id, type: 'cancelled', payload: { by: 'site' }, at: at + DAY }); }
    });

    return { today, tariffs: TARIFFS.map(t => Object.assign({}, t)), agencies: A, payments, bookings, events, logins: LOGINS };
  }

  build.LOGINS = LOGINS;
  build.addMonths = addMonths;
  if (typeof module === 'object' && module.exports) module.exports = build;
  else root.TezDemoSeed = build;
})(typeof window !== 'undefined' ? window : globalThis);
