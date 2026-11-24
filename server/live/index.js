/*
 * TezBooking — operator live-search API.
 *
 * A request is validated and cached, then dispatched to the configured SAMO adapters
 * under shared global and per-operator concurrency limits. A failed source never
 * prevents partial results from the remaining sources.
 *
 * Paket tarkibi:
 *   Uchish sanasi va soati — tur qatorining o'zidan (samo.js → dep, depDate). GDS paketlar — gds: true.
 *   Mehmonxonalar: operatorda "faqat mehmonxona" qidiruvi yo'q yoki bo'sh bo'lsa, mehmonxona tur paket ichidan olinadi
 *                  (fromTour: true). Chipta narxi ma'lum bo'lsa — narx = paket − chipta; aks holda narx — paket narxi
 *                  (withFlight: true, saytda "narx aviareys bilan" deb yoziladi — o'ylab topilgan bo'linma yo'q).
 *   LIVE_TOUR_TICKETS=1 (sukut bo'yicha o'chiq) — operatorning alohida aviachiptalar sahifasidan mos reysni olib, chipta narxini
 *                  biriktirishga urinadi. 2026-11-24 dagi sinovda operatorlarning ochiq chipta sahifalari charter reys qaytarmadi,
 *                  paket tarkibi (samo_action=CONTENT) ham narxni bo'lib bermaydi — shu sabab sukut bo'yicha o'chiq
 *                  (operatorlarga ortiqcha so'rov yubormaslik uchun).
 */
'use strict';

const samo = require('./samo');
const { createConcurrencyLimiter, createRateLimiter } = require('./limits');
const { parseLiveQuery } = require('./validation');

const OPERATORS = [
  { id: 'prestige', search: 'https://online.uz-prestige.com/search_tour' },
  { id: 'kazunion', search: 'https://online.kazunion.com/search_tour' },
  { id: 'selfie', search: 'https://b2b.selfietravel.kz/search_tour' },
  { id: 'savtour', search: 'https://online.savtour.az/search_tour' },
  { id: 'vietratour', search: 'https://b2b.vietratour.com/search_tour' },
  { id: 'fstravel', search: 'https://b2b.fstravel.asia/search_tour' },
  { id: 'flykhiva', search: 'https://b2b.flykhiva.travel/search_tour' },
  { id: 'malva', search: 'https://malvatouroperator.uz/search_tour' },
  { id: 'crystalbay', search: 'https://booking.crystalbay.com/search_tour' },
  { id: 'easybooking', search: 'https://tours.easybooking.uz/search_tour' },
  { id: 'kompas', search: 'https://online.uz.kompastour.com/search_tour' },
  { id: 'centrum', search: 'https://online.centrum-holidays.com/search_tour' },
  // anex: 2026-11 dan SAMO emas (yangi Next.js sayt, search_tour 404) — API kaliti bilan ulanadi
  { id: 'aqua', search: 'https://agency.aqua-travelgroup.com/search_tour' }
];
const CACHE_MS = 10 * 60000;
const PER_OP = 400;
const MAX_CACHE = 300;
const ROUTES = { '/api/live/tours': 'tours', '/api/live/hotels': 'hotels', '/api/live/flights': 'flights' };

function envInteger(env, name, fallback, min, max) {
  const raw = env[name];
  if (raw === undefined || raw === '') return fallback;
  if (!/^\d+$/.test(raw)) throw new Error(name + ' must be an integer');
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new Error(name + ' must be between ' + min + ' and ' + max);
  }
  return value;
}

function configFromEnv(env = process.env) {
  return {
    globalConcurrency: envInteger(env, 'LIVE_GLOBAL_CONCURRENCY', 12, 1, 100),
    operatorConcurrency: envInteger(env, 'LIVE_OPERATOR_CONCURRENCY', 2, 1, 20),
    // Har bir tur qidiruvi operator boshiga 2 ta vazifa (tur + chipta) — navbat shunga mos kattaroq
    maxQueue: envInteger(env, 'LIVE_MAX_QUEUE', 200, 0, 10000),
    perClientRate: envInteger(env, 'LIVE_RATE_PER_MIN', 20, 1, 10000),
    globalRate: envInteger(env, 'LIVE_GLOBAL_RATE_PER_MIN', 300, 1, 100000),
    timeoutMs: envInteger(env, 'LIVE_TIMEOUT_MS', 25000, 1000, 120000),
    tourTickets: (env.LIVE_TOUR_TICKETS || '0').trim() === '1'
  };
}

function safeFailure(error) {
  if (error && (error.code === 'LIVE_QUEUE_FULL')) return { status: 'busy', error: 'busy' };
  if (error && (error.name === 'AbortError' || error.code === 'ETIMEDOUT')) return { status: 'error', error: 'timeout' };
  if (error && /^LIVE_UNSAFE_/.test(error.code || '')) return { status: 'error', error: 'source_blocked' };
  return { status: 'error', error: 'upstream_unavailable' };
}

function createLive({
  sendJson,
  clientIp = req => req.socket && req.socket.remoteAddress || 'unknown',
  operators = OPERATORS,
  searches = { tours: samo.search, hotels: samo.searchHotels, flights: samo.searchFlights },
  now = Date.now,
  config
}) {
  const settings = Object.assign(configFromEnv(), config || {});
  const cache = new Map();
  const health = {};
  const limiter = createConcurrencyLimiter({
    globalLimit: settings.globalConcurrency,
    perKeyLimit: settings.operatorConcurrency,
    maxQueue: settings.maxQueue
  });
  const rateLimiter = createRateLimiter({
    perClientLimit: settings.perClientRate,
    globalLimit: settings.globalRate,
    windowMs: 60000,
    maxClients: 10000,
    now
  });

  const ticketsOn = settings.tourTickets !== false && typeof searches.flights === 'function';
  const addDaysIso = (iso, n) => new Date(Date.parse(iso + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);

  // Operatorning shu yo'nalish va tunlarga mos borish-qaytish chiptalari (xato bo'lsa — bo'sh ro'yxat, tur natijasi buzilmaydi)
  async function ticketsFor(operator, query, from) {
    if (!ticketsOn) return [];
    try {
      const fq = {
        to: query.country, from: from || query.from || 'tas', date: query.date, ret: addDaysIso(query.date, query.nights),
        adults: query.adults, childAges: (query.childAges || []).slice(0, 3), cabin: 'eco', window: query.window || 0
      };
      const r = await limiter.run(operator.id, () => searches.flights(operator, fq));
      return (r && r.offers) || [];
    } catch (error) { return []; }
  }
  // Har bir tur taklifiga: kirish kuni va tunlarga mos eng arzon chipta; mehmonxona ≈ paket − chipta (aqlga sig'sa)
  function withTickets(offers, tickets, nights) {
    if (!tickets.length) return offers;
    const best = {};
    tickets.forEach(t => {
      if (!t.back || t.back.date !== addDaysIso(t.date, nights) || !(t.price > 0)) return;
      if (!best[t.date] || t.price < best[t.date].price) best[t.date] = t;
    });
    return offers.map(o => {
      const t = !o.gds && best[o.checkIn];
      if (!t) return o;
      const ticket = {
        price: t.price, airline: t.airline || '', no: t.no || '', dep: t.dep, arr: t.arr, fromCode: t.fromCode || '', toCode: t.toCode || '',
        back: { no: t.back.no || '', dep: t.back.dep, arr: t.back.arr }
      };
      const hotelPrice = o.price - t.price;
      return Object.assign({}, o, { ticket }, hotelPrice >= o.price * 0.1 ? { hotelPrice } : {});
    });
  }

  async function searchOperator(kind, operator, query) {
    if (kind === 'tours') {
      const [tours, tickets] = await Promise.all([
        limiter.run(operator.id, () => searches.tours(operator, query)),
        ticketsFor(operator, query)
      ]);
      return { offers: withTickets(tours.offers, tickets, query.nights), note: tours.note };
    }
    if (kind === 'hotels') {
      const hotels = await limiter.run(operator.id, () => searches.hotels(operator, query));
      if (hotels.offers.length || typeof searches.tours !== 'function') return hotels;
      // "Faqat mehmonxona" yo'q — mehmonxona tur paket ichidan (Toshkentdan): chipta ma'lum bo'lsa paket − chipta,
      // aks holda paket narxi "aviareys bilan" belgisi bilan (bo'linma o'ylab topilmaydi)
      const tq = Object.assign({}, query, { from: 'tas' });
      const [tours, tickets] = await Promise.all([
        limiter.run(operator.id, () => searches.tours(operator, tq)).catch(() => ({ offers: [] })),
        ticketsFor(operator, tq, 'tas')
      ]);
      const derived = withTickets(tours.offers || [], tickets, query.nights).map(o => {
        const base = { packagePrice: o.price, fromTour: true, seats: 'ok', ticket: undefined, hotelPrice: undefined, dep: undefined, depDate: undefined };
        return o.hotelPrice > 0
          ? Object.assign({}, o, base, { price: Math.round(o.hotelPrice) })
          : Object.assign({}, o, base, { withFlight: true });
      });
      return { offers: derived, note: derived.length ? '' : hotels.note };
    }
    return limiter.run(operator.id, () => searches[kind](operator, query));
  }

  // Bitta operator: natija yoki xavfsiz xato holati (istisno otilmaydi)
  async function runOperator(kind, operator, query) {
    const started = now();
    let result;
    try {
      const response = await searchOperator(kind, operator, query);
      const offers = response.offers.filter(offer => offer.avail !== 'stop')
        .sort((a, b) => a.price - b.price).slice(0, PER_OP);
      result = {
        id: operator.id,
        status: offers.length ? 'ok' : (response.note || 'empty'),
        count: offers.length,
        ms: now() - started,
        offers
      };
    } catch (error) {
      const failure = safeFailure(error);
      result = { id: operator.id, ...failure, count: 0, ms: now() - started, offers: [] };
    }
    health[result.id] = { status: result.status, count: result.count, at: now() };
    return result;
  }

  async function searchAll(kind, query) {
    const results = await Promise.all(operators.map(operator => runOperator(kind, operator, query)));
    return {
      offers: [].concat(...results.map(result => result.offers)),
      operators: results.map(({ id, status, count, ms, error }) => ({ id, status, count, ms, error })),
      at: now()
    };
  }

  function rateLimited(req, res) {
    const retryAfter = rateLimiter.check(String(clientIp(req) || 'unknown'));
    if (!retryAfter) return false;
    res.setHeader('Retry-After', String(retryAfter));
    sendJson(res, 429, { error: 'rate_limited', retryAfter });
    return true;
  }

  async function handle(req, res, pathname, url) {
    const isStatus = pathname === '/api/live/status';
    const kind = ROUTES[pathname];
    if (!isStatus && !kind) return sendJson(res, 404, { error: 'not_found' });
    if (req.method !== 'GET') {
      res.setHeader('Allow', 'GET');
      return sendJson(res, 405, { error: 'method_not_allowed' });
    }
    if (rateLimited(req, res)) return;

    if (isStatus) {
      return sendJson(res, 200, {
        kinds: Object.keys(searches),
        operators: operators.map(operator => Object.assign({ id: operator.id }, health[operator.id] || {}))
      });
    }

    const query = parseLiveQuery(kind, url, { countries: samo.COUNTRY_RU, now });
    if (!query) return sendJson(res, 400, { error: 'bad_request' });

    const { entry, data } = await cachedSearch(kind, query);
    return sendJson(res, 200, Object.assign({ cached: !!entry.fromCache && now() - data.at > 1000 }, data));
  }

  // Kesh orqali qidiruv (sayt va Telegram bot uchun umumiy: bir xil so'rov operatorlarga ikki marta yuborilmaydi)
  async function cachedSearch(kind, query) {
    const key = kind + JSON.stringify(query);
    let entry = cache.get(key);
    if (entry && now() - entry.at > CACHE_MS) {
      cache.delete(key);
      entry = null;
    }
    if (entry) entry.fromCache = !!entry.data;
    if (!entry) {
      entry = { at: now(), promise: searchAll(kind, query) };
      cache.set(key, entry);
      if (cache.size > MAX_CACHE) cache.delete(cache.keys().next().value);
      entry.promise.then(data => {
        entry.data = data;
        entry.at = now();
      }, () => cache.delete(key));
    }
    const data = entry.data || await entry.promise;
    return { entry, data };
  }

  function queryOf(kind, params) {
    if (!ROUTES['/api/live/' + kind]) throw new Error('bad kind');
    const url = new URL('http://local/api/live/' + kind + '?' + new URLSearchParams(params));
    const query = parseLiveQuery(kind, url, { countries: samo.COUNTRY_RU, now });
    if (!query) throw new Error('bad query');
    return query;
  }

  // Server ichidan (Telegram bot): so'rov tekshiriladi xuddi saytdagidek, natija keshdan
  async function search(kind, params) {
    return (await cachedSearch(kind, queryOf(kind, params))).data;
  }

  // Bitta operator (agent ishchilari uchun). Sayt yoki bot xuddi shu so'rovni yaqinda qilgan bo'lsa — umumiy keshdan;
  // aks holda faqat shu operatorga so'rov (o'z keshi bilan). Xato natija keshlanmaydi — qayta urinish yangidan so'raydi.
  const oneCache = new Map();
  async function searchOne(kind, operatorId, params) {
    const operator = operators.find(op => op.id === operatorId);
    if (!operator) throw new Error('unknown operator');
    const query = queryOf(kind, params);
    const key = kind + JSON.stringify(query);
    const shared = cache.get(key);
    if (shared && shared.data && now() - shared.at <= CACHE_MS) {
      const status = shared.data.operators.find(op => op.id === operatorId);
      if (status && status.status !== 'error' && status.status !== 'busy') {
        return Object.assign({}, status, { offers: shared.data.offers.filter(o => o.opId === operatorId), cached: true });
      }
    }
    const oneKey = key + '|' + operatorId;
    let entry = oneCache.get(oneKey);
    if (entry && now() - entry.at > CACHE_MS) { oneCache.delete(oneKey); entry = null; }
    if (!entry) {
      entry = { at: now(), promise: runOperator(kind, operator, query) };
      oneCache.set(oneKey, entry);
      if (oneCache.size > MAX_CACHE) oneCache.delete(oneCache.keys().next().value);
      entry.promise.then(result => {
        if (result.status === 'error' || result.status === 'busy') oneCache.delete(oneKey);
        else entry.at = now();
      });
    }
    const result = await entry.promise;
    return Object.assign({}, result, { cached: false });
  }

  return { handle, search, searchOne, OPERATORS: operators, stats: () => limiter.stats() };
}

module.exports = { createLive, configFromEnv, parseLiveQuery, OPERATORS };
