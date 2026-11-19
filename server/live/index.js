/*
 * TezBooking — operatorlardan haqiqiy (jonli) narxlar.
 *
 *   GET /api/live/tours?country=tr&date=2026-11-26&nights=7&adults=2&children=7,4&from=tas
 *   -> { offers: [...], operators: [{ id, status: ok|empty|closed|no_country|no_departure|error, count, ms }], cached, at }
 *
 * Har bir operator parallel so'raladi (bitta sekin operator boshqalarini kutdirmaydi).
 * Natija 10 daqiqa keshda turadi — operator saytlariga ortiqcha yuk tushmasin.
 * Operatorlar ro'yxati js/data.js dagi OPS bilan bir xil id'larda.
 */
'use strict';

const samo = require('./samo');

// Ochiq SAMO qidiruvi bor operatorlar (sys: samo). Boshqa tizimlar (Pegas, RezLive, ...) API kaliti bilan qo'shiladi.
const OPERATORS = [
  { id: 'prestige', search: 'http://online.uz-prestige.com/search_tour' },
  { id: 'kazunion', search: 'https://online.kazunion.com/search_tour' },
  { id: 'selfie', search: 'http://b2b.selfietravel.kz/search_tour' },
  { id: 'savtour', search: 'https://online.savtour.az/search_tour' },
  { id: 'vietratour', search: 'https://b2b.vietratour.com/search_tour' },
  { id: 'fstravel', search: 'https://b2b.fstravel.asia/search_tour' },
  { id: 'flykhiva', search: 'https://b2b.flykhiva.travel/search_tour' },
  { id: 'malva', search: 'https://malvatouroperator.uz/search_tour' },
  { id: 'crystalbay', search: 'https://booking.crystalbay.com/search_tour' },
  { id: 'easybooking', search: 'https://tours.easybooking.uz/search_tour' },
  { id: 'kompas', search: 'https://online.uz.kompastour.com/search_tour' },
  { id: 'centrum', search: 'https://online.centrum-holidays.com/search_tour' },
  { id: 'anex', search: 'https://b2b.anextour.uz/search_tour' },
  { id: 'aqua', search: 'https://agency.aqua-travelgroup.com/search_tour' }
];
const CACHE_MS = 10 * 60000;
const PER_OP = 400;
const MAX_CACHE = 300;

function createLive({ sendJson }) {
  const cache = new Map();          // key -> { at, data } yoki { at, promise }
  const health = {};                // opId -> { status, at, count }

  async function searchAll(q) {
    const results = await Promise.all(OPERATORS.map(async op => {
      const t0 = Date.now();
      try {
        const r = await samo.search(op, q);
        // Sotuvi to'xtaganlar olinmaydi; operatordan eng arzon 200 tasi (javob yengil bo'lsin)
        const offers = r.offers.filter(o => o.avail !== 'stop').sort((a, b) => a.price - b.price).slice(0, PER_OP);
        return { id: op.id, status: offers.length ? 'ok' : (r.note || 'empty'), count: offers.length, ms: Date.now() - t0, offers };
      } catch (e) {
        return { id: op.id, status: 'error', error: e.name === 'AbortError' ? 'timeout' : e.message, count: 0, ms: Date.now() - t0, offers: [] };
      }
    }));
    results.forEach(r => { health[r.id] = { status: r.status, count: r.count, at: Date.now() }; });
    return {
      offers: [].concat(...results.map(r => r.offers)),
      operators: results.map(r => ({ id: r.id, status: r.status, count: r.count, ms: r.ms, error: r.error })),
      at: Date.now()
    };
  }

  function parse(url) {
    const p = url.searchParams;
    const country = p.get('country') || '';
    const date = p.get('date') || '';
    const nights = parseInt(p.get('nights'), 10);
    const adults = parseInt(p.get('adults'), 10);
    const childAges = (p.get('children') || '').split(',').filter(Boolean).map(Number).filter(n => n >= 0 && n < 18).slice(0, 4);
    const from = ['tas', 'skd', 'dyu'].includes(p.get('from')) ? p.get('from') : 'tas';
    if (!samo.COUNTRY_RU[country] || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !(nights >= 1 && nights <= 30) || !(adults >= 1 && adults <= 8)) return null;
    const window = Math.max(0, Math.min(3, parseInt(p.get('window'), 10) || 0));    // ± kunlar (sayt kunlar tasmasi)
    return { country, date, nights, adults, childAges, from, window };
  }

  async function handle(req, res, pathname, url) {
    if (pathname === '/api/live/status') return sendJson(res, 200, { operators: OPERATORS.map(o => Object.assign({ id: o.id }, health[o.id] || {})) });
    if (pathname !== '/api/live/tours' || req.method !== 'GET') return sendJson(res, 404, { error: 'not_found' });
    const q = parse(url);
    if (!q) return sendJson(res, 400, { error: 'bad_request' });
    const key = JSON.stringify(q);
    let c = cache.get(key);
    if (c && Date.now() - c.at > CACHE_MS) { cache.delete(key); c = null; }
    if (!c) {
      // Bir xil so'rov bir vaqtda kelsa — operatorlarga bitta so'rov ketadi
      c = { at: Date.now(), promise: searchAll(q) };
      cache.set(key, c);
      if (cache.size > MAX_CACHE) cache.delete(cache.keys().next().value);
      c.promise.then(d => { c.data = d; c.at = Date.now(); }, () => cache.delete(key));
    }
    const data = c.data || await c.promise;
    return sendJson(res, 200, Object.assign({ cached: !!c.data && Date.now() - data.at > 1000 }, data));
  }

  return { handle, OPERATORS };
}

module.exports = { createLive };
