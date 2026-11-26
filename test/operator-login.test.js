'use strict';

// Operator kabinetiga kirish (SAMO logon), mehmonxona nomi bo'yicha qidiruv va login holati — tarmoqqa chiqilmaydi
const test = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, rmSync } = require('node:fs');
const { join } = require('node:path');
const { tmpdir } = require('node:os');
const { credentialsFor, hasCredentials, envKey } = require('../server/live/credentials');
const { logon, authCookie, authStatus, resetAuth, mergeCookies } = require('../server/live/samo');
const { createSafeFetch } = require('../server/live/safe-http');
const { hotelMatcher } = require('../server/live/hotel-match');
const { parseLiveQuery } = require('../server/live/validation');
const { selectOffers, liveParams } = require('../server/owner/live-workers');
const { parseNaturalLanguage } = require('../js/agent-parser.js');
const { open } = require('../server/owner/db');
const { createOwnerService, validateSearchParameters } = require('../server/owner/service');

const ORIGIN = 'https://op.example';
const OP = { id: 'testop', search: ORIGIN + '/search_tour' };
const ENV = { OPERATOR_TESTOP_LOGIN: 'agent_one', OPERATOR_TESTOP_PASSWORD: 'p@ss]word=1' };
const FORM_PAGE = '<form method="post" id="loginForm"><input type="hidden" name="logon_key" id="logon_key" value="k123"></form>';
const CABINET = '<ul><li class="profile"><span class="login-name">AGENT</span></li></ul>';

// Soxta safeFetch: SAMO kabineti. accept(body) — parol to'g'rimi
function fakeSamo({ accept = () => true } = {}) {
  const calls = [];
  let loggedIn = false;
  const res = (status, body, cookies = [], location) => ({
    status, ok: status >= 200 && status < 300, url: '',
    headers: { getSetCookie: () => cookies, location },
    text: async () => body
  });
  const fetchImpl = async (url, opts = {}) => {
    calls.push({ url: String(url), method: opts.method || 'GET', body: opts.body, headers: opts.headers || {}, allowedOrigin: opts.allowedOrigin });
    if ((opts.method || 'GET') === 'POST') {
      loggedIn = accept(new URLSearchParams(opts.body));
      return res(301, '', ['SAMO=session2; path=/; HttpOnly'], '/cl_refer');
    }
    const cookie = (opts.headers || {}).Cookie || '';
    if (!cookie) return res(200, FORM_PAGE, ['SAMO=session1; path=/']);
    return res(200, loggedIn && /SAMO=session2/.test(cookie) ? CABINET : FORM_PAGE);
  };
  return { fetchImpl, calls };
}

test('loginlar faqat .env dan: kalit nomi, sayt/Owner id farqi, bo\'sh qiymat', () => {
  assert.equal(envKey('prestige'), 'OPERATOR_PRESTIGE');
  assert.equal(envKey('kazunion-uae'), 'OPERATOR_KAZUNION_UAE');
  assert.equal(envKey('vietratour'), 'OPERATOR_VIETRA');            // sayt id'si Owner id'siga tushadi
  const env = { OPERATOR_VIETRA_LOGIN: ' AGENT_X ', OPERATOR_VIETRA_PASSWORD: ' pw with space ' };
  assert.deepEqual({ ...credentialsFor('vietratour', env) }, { login: 'AGENT_X', password: ' pw with space ' });
  assert.equal(hasCredentials('vietra', env), true);
  assert.equal(credentialsFor('prestige', env), null);
  assert.equal(credentialsFor('prestige', { OPERATOR_PRESTIGE_LOGIN: 'x', OPERATOR_PRESTIGE_PASSWORD: '' }), null);
  assert.equal(credentialsFor('../etc', env), null);
});

test('SAMO kirish: forma kaliti va cookie bilan POST, parol faqat forma tanasida, kabinet tekshiriladi', async () => {
  const { fetchImpl, calls } = fakeSamo({ accept: form => form.get('login') === 'agent_one' && form.get('password') === 'p@ss]word=1' });
  const cookie = await logon(OP, credentialsFor('testop', ENV), undefined, fetchImpl);
  assert.equal(cookie, 'SAMO=session2');
  assert.deepEqual(calls.map(c => c.method + ' ' + c.url), [
    'GET ' + ORIGIN + '/cl_refer', 'POST ' + ORIGIN + '/cl_refer', 'GET ' + ORIGIN + '/cl_refer'
  ]);
  const post = calls[1];
  const form = new URLSearchParams(post.body);
  assert.equal(form.get('samo_action'), 'logon');
  assert.equal(form.get('logon_type'), 'agency');
  assert.equal(form.get('logon_key'), 'k123');
  assert.equal(post.headers.Cookie, 'SAMO=session1');
  assert.equal(post.allowedOrigin, ORIGIN);                       // faqat operatorning o'z saytiga
  // Parol URL'da yoki sarlavhalarda yo'q
  calls.forEach(c => assert.doesNotMatch(c.url + JSON.stringify(c.headers), /p@ss|word=1/));
});

test('noto\'g\'ri parol: LIVE_AUTH_FAILED; 30 daqiqa qayta urinilmaydi, qidiruv loginsiz davom etadi', async () => {
  resetAuth('testop');
  let time = Date.parse('2026-11-25T10:00:00Z');
  const now = () => time;
  const bad = fakeSamo({ accept: () => false });
  await assert.rejects(logon(OP, credentialsFor('testop', ENV), undefined, bad.fetchImpl), { code: 'LIVE_AUTH_FAILED' });

  bad.calls.length = 0;
  assert.equal(await authCookie(OP, undefined, { fetchImpl: bad.fetchImpl, env: ENV, now }), '');
  assert.deepEqual(authStatus('testop', ENV), { status: 'failed', at: time, error: 'auth_failed' });
  const attempts = bad.calls.length;
  time += 10 * 60000;
  assert.equal(await authCookie(OP, undefined, { fetchImpl: bad.fetchImpl, env: ENV, now }), '');
  assert.equal(bad.calls.length, attempts);                        // hisob bloklanmasin: qayta POST yo'q
  time += 25 * 60000;
  const good = fakeSamo();
  assert.equal(await authCookie(OP, undefined, { fetchImpl: good.fetchImpl, env: ENV, now }), 'SAMO=session2');
  assert.equal(authStatus('testop', ENV).status, 'authenticated');
  assert.equal(authStatus('nologin', ENV).status, 'none');
  resetAuth('testop');
  assert.equal(authStatus('testop', ENV).status, 'pending');
});

test('bir vaqtdagi qidiruvlar bitta kirishni kutadi; sessiya 20 daqiqa qayta ishlatiladi', async () => {
  resetAuth('testop');
  let time = Date.parse('2026-11-25T12:00:00Z');
  const now = () => time;
  const { fetchImpl, calls } = fakeSamo();
  const [a, b] = await Promise.all([
    authCookie(OP, undefined, { fetchImpl, env: ENV, now }),
    authCookie(OP, undefined, { fetchImpl, env: ENV, now })
  ]);
  assert.equal(a, 'SAMO=session2');
  assert.equal(b, 'SAMO=session2');
  assert.equal(calls.filter(c => c.method === 'POST').length, 1);
  time += 5 * 60000;
  await authCookie(OP, undefined, { fetchImpl, env: ENV, now });
  assert.equal(calls.filter(c => c.method === 'POST').length, 1);
  time += 20 * 60000;
  await authCookie(OP, undefined, { fetchImpl, env: ENV, now });
  assert.equal(calls.filter(c => c.method === 'POST').length, 2);   // muddati o'tdi — qayta kirish
  // Login yo'q operator — kirishga urinilmaydi
  assert.equal(await authCookie({ id: 'other', search: ORIGIN + '/search_tour' }, undefined, { fetchImpl, env: ENV, now }), '');
  resetAuth('testop');
});

test('reysdagi joy: F — "мало мест" (kam), N — yo\'q; operator yozuvi harfdan ustun', () => {
  const { seatsOf } = require('../server/live/samo');
  const seat = (side, code, title) => `<span class="fr_place_${side} ${code} helpalt" data-helpalt-arrow="hide"${title ? ` title="${title}"` : ''}></span>`;
  // 2026-11-26, Kazunion va FS Travel javobidagi haqiqiy belgilar
  assert.equal(seatsOf(seat('r', 'F', 'мало мест') + seat('l', 'F', 'мало мест')), 'few');
  assert.equal(seatsOf(seat('r', 'Y', 'есть места') + seat('l', 'F', 'мало мест')), 'few');
  assert.equal(seatsOf(seat('r', 'N', 'нет мест') + seat('l', 'N', 'нет мест')), 'none');
  assert.equal(seatsOf(seat('r', 'Y', 'есть места') + seat('l', 'Y', 'есть места')), 'ok');
  assert.equal(seatsOf(seat('r', 'Y') + seat('l', 'Y')), 'ok');          // Kompas: yozuvsiz
  assert.equal(seatsOf(seat('r', 'F') + seat('l', 'Y')), 'few');
  assert.equal(seatsOf(seat('r', 'N') + seat('l', 'Y')), 'none');
  assert.equal(seatsOf('<td>no flight info</td>'), 'ok');
});

test('cookie birlashtirish: yangi qiymat eskisini almashtiradi', () => {
  assert.equal(mergeCookies('SAMO=1; lang=ru', ['SAMO=2; path=/', 'x=y; HttpOnly']), 'SAMO=2; lang=ru; x=y');
  assert.equal(mergeCookies('', []), '');
});

test('safe-http POST: tana yuboriladi, redirect manual qaytariladi, 303 dan keyin GET tanasiz', async () => {
  const seen = [];
  const fetch = createSafeFetch({
    lookup: async () => [{ address: '8.8.8.8', family: 4 }],
    request: async (url, opts) => {
      seen.push({ path: url.pathname, method: opts.method, body: opts.body, type: opts.headers['Content-Type'] });
      if (url.pathname === '/login') return { status: 303, headers: { location: '/home' } };
      return { status: 200, ok: true, headers: {}, text: async () => 'ok' };
    }
  });
  const manual = await fetch(ORIGIN + '/login', { method: 'POST', body: 'a=1', redirect: 'manual', allowedOrigin: ORIGIN, headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
  assert.equal(manual.status, 303);
  const followed = await fetch(ORIGIN + '/login', { method: 'POST', body: 'a=1', allowedOrigin: ORIGIN, headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
  assert.equal(followed.status, 200);
  assert.deepEqual(seen.slice(1), [
    { path: '/login', method: 'POST', body: 'a=1', type: 'application/x-www-form-urlencoded' },
    { path: '/home', method: 'GET', body: undefined, type: undefined }
  ]);
});

test('mehmonxona nomi mosligi: muhim so\'zlar, umumiy so\'zlar majburiy emas', () => {
  const camia = hotelMatcher('CAMIA RESORT');
  assert.ok(camia('Camia Resort & Spa'));
  assert.ok(camia('CAMIA PHU QUOC'));
  assert.equal(camia('Vinpearl Resort'), false);
  const rixos = hotelMatcher('Rixos Belek');
  assert.ok(rixos('RIXOS PREMIUM BELEK'));
  assert.equal(rixos('RIXOS THE PALM DUBAI'), false);
  assert.ok(hotelMatcher('Hotel')('Grand Hotel'));                   // faqat umumiy so'z — o'zi talab qilinadi
  assert.equal(hotelMatcher('  '), null);
  // Eski nom va yulduz talab qilinmaydi (2026-11-26: Asialuxe nomi bilan Kazunion'dagi shu mehmonxona topilmasdi)
  const orchid = hotelMatcher('ORCHID HOTEL AL BARSHA EX. (GOLDEN TULIP AL BARSHA)');
  assert.ok(orchid('Orchid Hotel Al Barsha'));
  assert.ok(orchid('Orchid Hotel Al Barsha (ex.Golden Tulip Al Barsha)'));
  assert.equal(orchid('Golden Tulip Media Hotel'), false);
  assert.ok(hotelMatcher('Concorde Deira Hotel (ex. Golden Tulip Deira)')('CONCORDE DEIRA HOTEL (EX.GOLDEN TULIP DEIRA HOTEL)'));
  assert.ok(hotelMatcher('Rixos Premium 5*')('RIXOS PREMIUM DUBAI'));
  assert.ok(hotelMatcher('Expo Hotel')('EXPO HOTEL'));                 // "ex" so'z boshi emas — nom kesilmaydi
});

test('tahlilchi: buyruqdagi mehmonxona nomi (katta harf, kalit so\'z, qo\'shtirnoq) va Fukuok', () => {
  const caps = parseNaturalLanguage('CAMIA RESORT 4* - PHU QUOC NORTH 15 dekabr 7 kecha 2 kishi');
  assert.equal(caps.parameters.hotelName, 'CAMIA RESORT');
  assert.equal(caps.parameters.destination, 'Phu Quoc');
  assert.equal(caps.parameters.country, 'vn');
  assert.equal(caps.parameters.hotelStars, 4);
  assert.deepEqual(caps.missing, []);
  assert.equal(parseNaturalLanguage('Vietnam Fukuok, hotel Camia Resort, 20-dekabr 7 kecha 2 kishi').parameters.hotelName, 'Camia Resort');
  assert.equal(parseNaturalLanguage('Antalya "Rixos Premium Belek" 15-dekabr 7 kecha 2 kishi').parameters.hotelName, 'Rixos Premium Belek');
  assert.equal(parseNaturalLanguage('отель Rixos Premium Belek 5*, Анталья, 15 декабря 7 ночей 2 взрослых').parameters.hotelName, 'Rixos Premium Belek');
  // Mehmonxona bor, kurort yo'q — davlat bo'yicha, savol berilmaydi
  const uae = parseNaturalLanguage('mehmonxona: Rixos The Palm, BAA, 12-yanvar 5 kecha 2 kishi');
  assert.equal(uae.parameters.hotelName, 'Rixos The Palm');
  assert.equal(uae.parameters.country, 'ae');
  assert.deepEqual(uae.missing, []);
  // Mehmonxona yo'q buyruqlar o'zgarmaydi
  assert.equal(parseNaturalLanguage('Dubai 10 dekabr 5 kecha 2 kishi ALL INCLUSIVE').parameters.hotelName, null);
  assert.equal(parseNaturalLanguage('TURKIYA ANTALYA 15 DEKABR 7 KECHA 2 KISHI').parameters.hotelName, null);
  assert.deepEqual(parseNaturalLanguage('Turkiya 15-dekabr 7 kecha 2 kishi').missing, ['destination']);
});

test('mehmonxona nomi qidiruv parametrlarida: tekshiruv, operatorga uzatish, saralash', () => {
  const now = () => Date.parse('2026-11-25T08:00:00Z');
  const url = (s) => new URL('http://local/api/live/tours?country=vn&date=2026-12-15&nights=7&adults=2' + s);
  const countries = { vn: ['Вьетнам'] };
  assert.equal(parseLiveQuery('tours', url('&hotel=Camia%20Resort'), { countries, now }).hotel, 'Camia Resort');
  assert.equal('hotel' in parseLiveQuery('tours', url(''), { countries, now }), false);
  assert.equal(parseLiveQuery('tours', url('&hotel=%3Cscript%3E'), { countries, now }), null);
  assert.equal(parseLiveQuery('tours', url('&hotel=a&hotel=b'), { countries, now }), null);

  const base = { destination: 'Phu Quoc', country: 'vn', date: '2026-12-15', nights: 7, adults: 2, childrenAges: [], currency: 'USD' };
  assert.equal(validateSearchParameters({ ...base, hotelName: ' Camia  Resort ' }, now).hotelName, 'Camia Resort');
  assert.equal(validateSearchParameters(base, now).hotelName, null);
  assert.equal(validateSearchParameters({ ...base, hotelName: 'x'.repeat(81) }, now), null);
  assert.equal(validateSearchParameters({ ...base, hotelName: 42 }, now), null);
  assert.equal(liveParams({ ...base, hotelName: 'Camia Resort' }).hotel, 'Camia Resort');
  assert.equal('hotel' in liveParams(base), false);

  const offer = (hotel, price) => ({ hotel, price, city: 'Phu Quoc', stars: 4, meal: 'BB', checkIn: '2026-12-15', avail: 'ok', seats: 'ok' });
  const list = [offer('CAMIA RESORT & SPA', 900), offer('VINPEARL RESORT', 700)];
  const picked = selectOffers(list, { ...base, hotelName: 'Camia Resort' }, { limit: 30 });
  assert.deepEqual(picked.offers.map(o => o.hotel), ['CAMIA RESORT & SPA']);
  const none = selectOffers([offer('VINPEARL RESORT', 700)], { ...base, hotelName: 'Camia Resort' }, { limit: 30 });
  assert.equal(none.offers.length, 0);
  assert.equal(none.hotelFiltered, true);
});

test('Owner bazasi: kabinet holati (parolsiz), muvaffaqiyatsiz kirishda ogohlantirish', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'tezbooking-auth-'));
  const database = open(join(directory, 'owner.sqlite'));
  t.after(() => { database.close(); rmSync(directory, { recursive: true, force: true }); });
  let time = 1000;
  const service = createOwnerService({ db: database, now: () => time });
  const site = () => service.listWebsites().find(s => s.id === 'prestige');
  assert.equal(site().authStatus, 'not_configured');
  assert.equal(service.markAuthStatus('prestige', 'pending'), true);
  assert.equal(site().authStatus, 'required');
  service.markAuthStatus('prestige', 'authenticated', { at: 5000 });
  assert.equal(site().authStatus, 'authenticated');
  assert.equal(site().lastSuccessfulLogin, 5000);
  time = 9000;
  service.markAuthStatus('prestige', 'failed', { at: 9000, error: 'auth_failed' });
  assert.equal(site().authStatus, 'manual_action');
  assert.equal(site().lastSuccessfulLogin, 5000);
  assert.ok(service.listActivities(50).some(a => a.type === 'website_auth_failed'));
  assert.equal(service.listAlerts(50).filter(a => a.type === 'website_auth_failed').length, 1);
  service.markAuthStatus('prestige', 'failed', { at: 9500, error: 'auth_failed' });   // takroriy — yangi ogohlantirish yo'q
  assert.equal(service.listAlerts(50).filter(a => a.type === 'website_auth_failed').length, 1);
  assert.equal(service.markAuthStatus('prestige', 'bogus'), false);
  assert.equal(service.markAuthStatus('missing-site', 'pending'), false);
  assert.doesNotMatch(JSON.stringify(service.listWebsites()), /password/i);
});
