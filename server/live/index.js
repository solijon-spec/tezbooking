/*
 * TezBooking — operator live-search API.
 *
 * A request is validated and cached, then dispatched to the configured SAMO adapters
 * under shared global and per-operator concurrency limits. A failed source never
 * prevents partial results from the remaining sources.
 */
'use strict';

const samo = require('./samo');
const { createConcurrencyLimiter, createRateLimiter } = require('./limits');
const { parseLiveQuery } = require('./validation');

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
    maxQueue: envInteger(env, 'LIVE_MAX_QUEUE', 100, 0, 10000),
    perClientRate: envInteger(env, 'LIVE_RATE_PER_MIN', 20, 1, 10000),
    globalRate: envInteger(env, 'LIVE_GLOBAL_RATE_PER_MIN', 300, 1, 100000),
    timeoutMs: envInteger(env, 'LIVE_TIMEOUT_MS', 25000, 1000, 120000)
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

  async function searchAll(kind, query) {
    const results = await Promise.all(operators.map(async operator => {
      const started = now();
      try {
        const search = searches[kind];
        const response = await limiter.run(operator.id, () => search(operator, query));
        const offers = response.offers.filter(offer => offer.avail !== 'stop')
          .sort((a, b) => a.price - b.price).slice(0, PER_OP);
        return {
          id: operator.id,
          status: offers.length ? 'ok' : (response.note || 'empty'),
          count: offers.length,
          ms: now() - started,
          offers
        };
      } catch (error) {
        const failure = safeFailure(error);
        return { id: operator.id, ...failure, count: 0, ms: now() - started, offers: [] };
      }
    }));

    results.forEach(result => {
      health[result.id] = { status: result.status, count: result.count, at: now() };
    });
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

    const key = kind + JSON.stringify(query);
    let entry = cache.get(key);
    if (entry && now() - entry.at > CACHE_MS) {
      cache.delete(key);
      entry = null;
    }
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
    return sendJson(res, 200, Object.assign({ cached: !!entry.data && now() - data.at > 1000 }, data));
  }

  return { handle, OPERATORS: operators, stats: () => limiter.stats() };
}

module.exports = { createLive, configFromEnv, parseLiveQuery, OPERATORS };
