'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createConcurrencyLimiter, createRateLimiter } = require('../server/live/limits');
const { createLive, parseLiveQuery } = require('../server/live');
const { createSafeFetch, isPublicAddress, requestOnce, validateUrl } = require('../server/live/safe-http');
const { seatsCode } = require('../server/live/samo');

const fixedNow = () => Date.parse('2026-11-19T12:00:00.000Z');

test('validates calendar dates, ranges, passenger ages, and enum values', () => {
  const countries = { tr: ['Turkey'] };
  const parse = search => parseLiveQuery('tours', new URL('http://local' + search), { countries, now: fixedNow });

  assert.deepEqual(parse('?country=tr&date=2026-11-20&nights=7&adults=2&children=7,4&from=tas'), {
    country: 'tr', date: '2026-11-20', nights: 7, adults: 2, childAges: [7, 4], from: 'tas', window: 0
  });
  assert.equal(parse('?country=tr&date=2026-02-29&nights=7&adults=2'), null);
  assert.equal(parse('?country=tr&date=2026-11-19&nights=7&adults=2'), null);
  assert.equal(parse('?country=tr&date=2026-11-20&nights=7days&adults=2'), null);
  assert.equal(parse('?country=tr&date=2026-11-20&nights=7&adults=2&children=4,,7'), null);
  assert.equal(parse('?country=tr&date=2026-11-20&nights=7&adults=2&from=localhost'), null);
  assert.equal(parse('?country=tr&date=2026-11-20&nights=7&adults=2&window=4'), null);
  assert.equal(parse('?country=constructor&date=2026-11-20&nights=7&adults=2'), null);
});

test('validates flight return dates and caps supported child ages', () => {
  const countries = { tr: ['Turkey'] };
  const parse = search => parseLiveQuery('flights', new URL('http://local' + search), { countries, now: fixedNow });

  assert.deepEqual(parse('?to=tr&date=2026-11-20&ret=2026-11-27&adults=2&children=7,4&cabin=eco'), {
    to: 'tr', date: '2026-11-20', ret: '2026-11-27', adults: 2, childAges: [7, 4], from: 'tas', cabin: 'eco', window: 0
  });
  assert.equal(parse('?to=tr&date=2026-11-20&ret=2026-11-20&adults=2'), null);
  assert.equal(parse('?to=tr&date=2026-11-20&adults=2&children=1,2,3,4'), null);
  assert.equal(parse('?to=tr&date=2026-11-20&adults=2&cabin=first'), null);
});

test('concurrency limiter enforces global and per-operator caps and bounds its queue', async () => {
  const limiter = createConcurrencyLimiter({ globalLimit: 2, perKeyLimit: 1, maxQueue: 1 });
  let releaseA;
  let releaseB;
  const a = limiter.run('a', () => new Promise(resolve => { releaseA = resolve; }));
  const b = limiter.run('b', () => new Promise(resolve => { releaseB = resolve; }));
  const queuedA = limiter.run('a', async () => 'queued');
  await assert.rejects(limiter.run('c', async () => 'overflow'), { code: 'LIVE_QUEUE_FULL' });
  assert.deepEqual(limiter.stats(), { active: 2, queued: 1 });

  await Promise.resolve();
  releaseA('a');
  releaseB('b');
  assert.deepEqual(await Promise.all([a, b, queuedA]), ['a', 'b', 'queued']);
  assert.deepEqual(limiter.stats(), { active: 0, queued: 0 });
});

test('rate limiter enforces per-client and global limits', () => {
  let now = 0;
  const limiter = createRateLimiter({ perClientLimit: 1, globalLimit: 2, windowMs: 60000, maxClients: 10, now: () => now });
  assert.equal(limiter.check('a'), 0);
  assert.ok(limiter.check('a') > 0);
  assert.equal(limiter.check('b'), 0);
  assert.ok(limiter.check('c') > 0);
  now = 60000;
  assert.equal(limiter.check('a'), 0);
});

test('public API rejects invalid requests and does not expose supplier error details', async () => {
  let searches = 0;
  const result = {};
  const live = createLive({
    sendJson: (_res, status, body) => Object.assign(result, { status, body }),
    operators: [{ id: 'one', search: 'https://one.example/search_tour' }],
    searches: { tours: async () => { searches++; throw new Error('secret internal URL'); }, hotels: async () => ({ offers: [] }), flights: async () => ({ offers: [] }) },
    config: { globalConcurrency: 1, operatorConcurrency: 1, maxQueue: 1, perClientRate: 10, globalRate: 10 },
    now: fixedNow
  });
  const req = { method: 'GET', socket: { remoteAddress: '127.0.0.1' }, headers: {} };

  await live.handle(req, {}, '/api/live/tours', new URL('http://local/api/live/tours?country=tr&date=2026-02-30&nights=7&adults=2'));
  assert.equal(result.status, 400);
  assert.equal(searches, 0);

  await live.handle(req, {}, '/api/live/tours', new URL('http://local/api/live/tours?country=tr&date=2026-11-20&nights=7&adults=2'));
  assert.equal(result.status, 200);
  assert.equal(result.body.operators[0].error, 'upstream_unavailable');
  assert.doesNotMatch(JSON.stringify(result.body), /secret internal URL/);
  assert.equal(searches, 1);
});

test('live API rate limits status requests and returns Retry-After', async () => {
  const result = {};
  const headers = {};
  const live = createLive({
    sendJson: (_res, status, body) => Object.assign(result, { status, body }),
    operators: [],
    config: { globalConcurrency: 1, operatorConcurrency: 1, maxQueue: 0, perClientRate: 1, globalRate: 10 },
    now: fixedNow
  });
  const req = { method: 'GET', socket: { remoteAddress: '192.0.2.1' }, headers: {} };
  const res = { setHeader: (name, value) => { headers[name] = value; } };

  await live.handle(req, res, '/api/live/status', new URL('http://local/api/live/status'));
  await live.handle(req, res, '/api/live/status', new URL('http://local/api/live/status'));
  assert.equal(result.status, 429);
  assert.equal(result.body.error, 'rate_limited');
  assert.ok(Number(headers['Retry-After']) > 0);
});

test('outbound requests reject private DNS results and unsafe redirects before another request', async () => {
  assert.equal(isPublicAddress('8.8.8.8'), true);
  assert.equal(isPublicAddress('127.0.0.1'), false);
  assert.equal(isPublicAddress('2606:4700:4700::1111'), true);
  assert.equal(isPublicAddress('::1'), false);
  assert.throws(() => validateUrl('http://127.0.0.1/admin', 'https://supplier.example'), { code: 'LIVE_UNSAFE_URL' });

  let requestCount = 0;
  const privateFetch = createSafeFetch({
    lookup: async () => [{ address: '10.0.0.1', family: 4 }],
    request: async () => { requestCount++; throw new Error('must not request'); }
  });
  await assert.rejects(privateFetch('https://supplier.example/search', { allowedOrigin: 'https://supplier.example' }), { code: 'LIVE_UNSAFE_ADDRESS' });
  assert.equal(requestCount, 0);

  const redirectFetch = createSafeFetch({
    lookup: async () => [{ address: '8.8.8.8', family: 4 }],
    request: async () => {
      requestCount++;
      return { status: 302, headers: { location: 'http://127.0.0.1/admin' } };
    }
  });
  await assert.rejects(redirectFetch('https://supplier.example/search', { allowedOrigin: 'https://supplier.example' }), { code: 'LIVE_UNSAFE_URL' });
  assert.equal(requestCount, 1);
});

test('outbound requests allow only same-origin redirects and enforce request timeouts', async () => {
  let requests = 0;
  const safeRedirectFetch = createSafeFetch({
    lookup: async () => [{ address: '8.8.8.8', family: 4 }],
    request: async url => {
      requests++;
      if (url.pathname === '/start') return { status: 302, headers: { location: '/result' } };
      return { status: 200, headers: {}, text: async () => 'ok' };
    }
  });
  const response = await safeRedirectFetch('https://supplier.example/start', { allowedOrigin: 'https://supplier.example' });
  assert.equal(response.status, 200);
  assert.equal(requests, 2);

  const http = require('node:http');
  const server = http.createServer(() => {});
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  try {
    await assert.rejects(requestOnce(new URL('http://127.0.0.1:' + address.port + '/slow'), {
      headers: {}, signal: undefined,
      addresses: [{ address: '127.0.0.1', family: 4 }],
      timeoutMs: 20, maxResponseBytes: 1024
    }), { code: 'ETIMEDOUT' });
  } finally {
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});

test('unknown flight seats are not presented as available', () => {
  assert.equal(seatsCode(undefined, ''), 'unknown');
  assert.equal(seatsCode(1, ''), 'unknown');
  assert.equal(seatsCode(0, ''), 'none');
});
