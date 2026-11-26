'use strict';

// Pegas va Asialuxe (faqat agentlik logini bilan): javobni o'qish, kirish, sayt/botdan ajratish — tarmoqqa chiqilmaydi
const test = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, rmSync } = require('node:fs');
const { join } = require('node:path');
const { tmpdir } = require('node:os');
const pegas = require('../server/live/pegas');
const asialuxe = require('../server/live/asialuxe');
const { createAuth } = require('../server/live/auth');
const { createLive, OPERATORS } = require('../server/live');
const { open } = require('../server/owner/db');
const { createOwnerService } = require('../server/owner/service');
const { createWorkerRegistry } = require('../server/owner/worker-registry');
const { registerLiveWorkers } = require('../server/owner/live-workers');

const PEGAS = OPERATORS.find(o => o.id === 'pegas');
const ASIALUXE = OPERATORS.find(o => o.id === 'asialuxe');

// Pegas /PackageSearch/Search javobining qisqartirilgan nusxasi (2026-11-25 dagi haqiqiy tuzilish)
const pegasResponse = () => ({
  Items: [{
    PackageId: 731743442, Duration: 7, Price: 1510.26, CurrencyId: 37, HasExternalServices: false,
    HotelServices: [{ HotelId: 744577816, IsMainHotel: true, CheckInDate: '2026-12-15T00:00:00', DurationInNights: 7, RoomCategoryId: 6029, Accommodation: 'DBL', MealId: 3205, Availability: 1 }],
    FlightServices: [
      { Availability: 0, Segments: [{ DepartureAirportId: 1, ArrivalAirportId: 2, DepartureDateTime: '2026-12-15T05:40:00' }] },
      { Availability: 2, Segments: [{ DepartureAirportId: 2, ArrivalAirportId: 1, DepartureDateTime: '2026-12-22T10:30:00' }] }
    ]
  }, {
    PackageId: 731743442, Duration: 7, Price: 18381385, CurrencyId: 284845951,   // so'mdagi narx — olinmaydi
    HotelServices: [{ HotelId: 744577816, IsMainHotel: true, CheckInDate: '2026-12-15T00:00:00', DurationInNights: 7, MealId: 3205, Availability: 0 }],
    FlightServices: []
  }, {
    PackageId: 731743442, Duration: 7, Price: 900, CurrencyId: 37,
    HotelServices: [{ HotelId: 5, IsMainHotel: true, CheckInDate: '2026-12-16T00:00:00', DurationInNights: 7, MealId: 7000, Availability: 3 }],
    FlightServices: [{ Availability: 3, Segments: [] }]
  }],
  Reference: {
    IdToHotelIndex: { 744577816: { CategoryGroupId: 3579161, LocationId: 900, LocationAreaId: 901 }, 5: { CategoryRating: 30, LocationId: 900 } },
    IdToMealIndex: { 3205: { Code: 'BB' }, 7000: { Code: 'RO' } },
    IdToAirportIndex: { 1: { Code: 'TAS' }, 2: { Code: 'PQC' } },
    IdToCurrencyIndex: { 37: { co: 'USD' }, 284845951: { co: 'UZS' } },
    IdToPackageIndex: { 731743442: { na: 'Phu Quoc (Tashkent) ' } },
    LocationIdToRegionIdIndex: { 900: 902 },
    soitni: { 744577816: 'Camia Resort & Spa', 5: 'Budget Inn', 3579161: '4*', 900: 'Онг Ланг', 901: 'Онг Ланг', 902: 'Фукуок', 6029: 'Стандартный номер' }
  }
});

test('Pegas: natija qatorlari — USD narx, yulduz, joy, ovqat, xona, reys va mavjudlik', () => {
  const offers = pegas.parseItems(PEGAS, pegasResponse());
  assert.equal(offers.length, 2);                                   // so'mdagi qator tashlandi
  const [camia, budget] = offers;
  assert.deepEqual({ ...camia }, {
    opId: 'pegas', hotelKey: '744577816', hotel: 'Camia Resort & Spa', stars: 4, city: 'Фукуок, Онг Ланг',
    tour: 'Phu Quoc (Tashkent)', gds: false, dep: 5 * 60 + 40, depDate: '2026-12-15', fromCode: 'TAS', toCode: 'PQC',
    checkIn: '2026-12-15', nights: 7, meal: 'BB', mealRaw: 'BB', room: 'Стандартный номер / DBL', roomKey: '6029', mealKey: '3205',
    price: 1510, avail: 'few', seats: 'few'
  });
  assert.equal(budget.stars, 3);                                    // CategoryRating 30 -> 3*
  assert.equal(budget.avail, 'stop');
  assert.equal(budget.seats, 'none');
});

test('Pegas: kirish — antiforgery token va JSON, IsSucceeded=false — noto\'g\'ri parol', async () => {
  const calls = [];
  const fake = (ok) => async (url, opts = {}) => {
    calls.push({ url, method: opts.method || 'GET', body: opts.body, headers: opts.headers || {} });
    const res = (status, body, cookies = []) => ({ status, ok: status < 300, headers: { getSetCookie: () => cookies }, text: async () => body });
    if ((opts.method || 'GET') === 'GET') return res(200, '<input name="__RequestVerificationToken" type="hidden" value="tok1">', ['af=1; path=/']);
    return res(200, JSON.stringify({ IsSucceeded: ok }), ok ? ['.AspNetCore.Cookies=s1; path=/'] : []);
  };
  const cookie = await pegas.logon(PEGAS, { login: 'agent', password: 'pw-123' }, undefined, fake(true));
  assert.equal(cookie, 'af=1; .AspNetCore.Cookies=s1');
  assert.deepEqual(JSON.parse(calls[1].body), { Username: 'agent', Password: 'pw-123' });
  assert.equal(calls[1].headers.RequestVerificationToken, 'tok1');
  assert.equal(calls[1].url, 'https://uz.pegast.asia/Account/Login');
  await assert.rejects(pegas.logon(PEGAS, { login: 'agent', password: 'bad' }, undefined, fake(false)), { code: 'LIVE_AUTH_FAILED' });
});

// Asialuxe /v2/tour/list javobining qisqartirilgan nusxasi
const asxResponse = () => ({
  ok: true, pending: true,
  direction: { name: 'Дубай', channel: 'charter', arrive: 'DXB' },
  flight: { offers: [{ result_id: 'F1', segments: [
    { departure: 'TAS', departure_date: '2026-12-10', departure_time: '07:10', arrival: 'DXB', is_return: false },
    { departure: 'DXB', departure_date: '2026-12-17', departure_time: '12:20', arrival: 'TAS', is_return: true }
  ] }] },
  hotels: [
    { id: 8731, name: 'SAN MARINO HOTEL DEIRA', city: 'DEIRA,DUBAI', content: { stars: 2 }, currency: 'USD', nights: 7, total: 1200, flight: { result_id: 'F1' },
      rooms: [{ name: 'Standard Room King/Twin', board: 'RO', boards: ['RO'], package_total: 1200, room_code: '1524', board_code: '7', currency: 'USD' }] },
    { id: 1, name: 'EUR HOTEL', currency: 'EUR', total: 900, rooms: [{ package_total: 900, board: 'BB' }] }
  ]
});

test('Asialuxe: paket qatorlari — USD, reys vaqti, ovqat, shahar', () => {
  const offers = asialuxe.parseHotels(ASIALUXE, asxResponse(), { date: '2026-12-10', nights: 7 }, 'Дубай');
  assert.equal(offers.length, 1);
  assert.deepEqual({ ...offers[0] }, {
    opId: 'asialuxe', hotelKey: '8731', hotel: 'SAN MARINO HOTEL DEIRA', stars: 2, city: 'Дубай, DEIRA, DUBAI', tour: 'Дубай', gds: false,
    dep: 7 * 60 + 10, depDate: '2026-12-10', fromCode: 'TAS', toCode: 'DXB', checkIn: '2026-12-10', nights: 7,
    meal: 'RO', mealRaw: 'RO', room: 'Standard Room King/Twin', roomKey: '1524', mealKey: '7', price: 1200, avail: 'ok', seats: 'ok'
  });
  // Tuman nomi bilan yozilgan mehmonxona ham kurort filtridan o'tadi (Istanbul -> SULTANAHMET)
  const { destinationMatcher } = require('../server/owner/live-workers');
  const ist = asxResponse();
  ist.hotels[0].city = 'SULTANAHMET'; ist.hotels[0].name = 'SANTA SOPHIA HOTEL';
  const [santa] = asialuxe.parseHotels(ASIALUXE, ist, { date: '2026-12-15', nights: 7 }, 'Стамбул');
  assert.ok(destinationMatcher('Istanbul', 'tr')(santa));
});

test('Asialuxe: topshiriqdagi kurort birinchi qidiriladi (Istanbul, Alanya, Dubay)', () => {
  assert.ok(asialuxe.cityAliases('Istanbul').includes('стамбул'));
  assert.ok(asialuxe.cityAliases('Alanyaga').includes('аланья'));
  assert.ok(asialuxe.cityAliases('Дубай').includes('dubai'));
  assert.deepEqual(asialuxe.cityAliases('Fethiye'), ['fethiye']);
  const { parseLiveQuery } = require('../server/live/validation');
  const url = (s) => new URL('http://x/api/live/tours?country=tr&date=2026-12-15&nights=7&adults=2' + s);
  const opts = { countries: { tr: ['Турция'] }, now: () => Date.parse('2026-11-26T08:00:00Z') };
  assert.equal(parseLiveQuery('tours', url('&city=Istanbul'), opts).city, 'Istanbul');
  assert.equal(parseLiveQuery('tours', url('&city=%3Cx%3E'), opts), null);
});

test('Asialuxe: kirish — token; token yo\'q javob — noto\'g\'ri parol', async () => {
  let sent = null;
  const fake = (answer) => async (url, opts) => { sent = { url, body: JSON.parse(opts.body) }; return { status: 200, text: async () => JSON.stringify(answer) }; };
  assert.equal(await asialuxe.logon(ASIALUXE, { login: 'a@b.uz', password: 'pw' }, undefined, fake({ data: { token: 'T1' } })), 'T1');
  assert.deepEqual(sent, { url: 'https://api.asialuxe.app/v1/user/b2b-sign-in', body: { phone_or_email: 'a@b.uz', password: 'pw' } });
  await assert.rejects(asialuxe.logon(ASIALUXE, { login: 'a@b.uz', password: 'x' }, undefined, fake({ message: 'error' })), { code: 'LIVE_AUTH_FAILED' });
});

test('sessiya muddati: operator yopgan sessiya (expire) — keyingi so\'rovda qayta kiriladi', async () => {
  let logins = 0;
  const auth = createAuth({ logon: async () => 'S' + (++logins), ttlMs: 60000 });
  const env = { OPERATOR_X_LOGIN: 'a', OPERATOR_X_PASSWORD: 'b' };
  const op = { id: 'x' };
  assert.equal(await auth.session(op, undefined, { env }), 'S1');
  assert.equal(await auth.session(op, undefined, { env }), 'S1');
  auth.expire('x');
  assert.equal(await auth.session(op, undefined, { env }), 'S2');
  assert.equal(auth.status('x', env).status, 'authenticated');
});

test('login talab qiladigan operator: login bo\'lsa sayt va botda ham, bo\'lmasa hech qayerda; sekin operator javobni ushlab turmaydi', async () => {
  const make = (env, tours) => {
    const called = [];
    const live = createLive({
      sendJson: () => {},
      operators: [{ id: 'kompas', search: 'https://op.example/search_tour' }, { id: 'pegas', search: 'https://uz.pegast.asia/PackageSearch', adapter: 'pegas', loginOnly: true }],
      searches: { tours: async (op, q) => { called.push(op.id); return tours(op, q); }, hotels: async () => ({ offers: [] }), flights: async () => ({ offers: [] }) },
      config: { globalConcurrency: 4, operatorConcurrency: 2, maxQueue: 10, perClientRate: 100, globalRate: 100, tourTickets: false },
      now: () => Date.parse('2026-11-25T08:00:00Z'), env, siteWaitMs: 80
    });
    return { live, called };
  };
  const offer = (id) => ({ offers: [{ opId: id, hotel: 'H', price: 100, checkIn: '2026-12-15', nights: 7 }] });
  const params = { country: 'tr', date: '2026-12-15', nights: '7', adults: '2' };
  // Login bor — sayt qidiruvida ikkalasi
  const withLogin = make({ OPERATOR_PEGAS_LOGIN: 'a', OPERATOR_PEGAS_PASSWORD: 'b' }, async (op) => offer(op.id));
  const site = await withLogin.live.search('tours', params);
  assert.deepEqual(site.operators.map(o => o.id), ['kompas', 'pegas']);
  assert.equal(site.offers.length, 2);
  // Login yo'q — sayt uni so'ramaydi
  const noLogin = make({}, async (op) => offer(op.id));
  assert.deepEqual((await noLogin.live.search('tours', params)).operators.map(o => o.id), ['kompas']);
  assert.deepEqual(noLogin.called, ['kompas']);
  // Sekin operator: kutish chegarasidan keyin "timeout", qolganlar natijasi qaytadi
  const slow = make({ OPERATOR_PEGAS_LOGIN: 'a', OPERATOR_PEGAS_PASSWORD: 'b' }, (op) => op.id === 'pegas' ? new Promise(r => setTimeout(() => r(offer(op.id)), 400)) : offer(op.id));
  const partial = await slow.live.search('tours', Object.assign({}, params, { nights: '8' }));
  assert.deepEqual(partial.operators.map(o => [o.id, o.status, o.error || '']), [['kompas', 'ok', ''], ['pegas', 'error', 'timeout']]);
  assert.equal(partial.offers.length, 1);
});

test('agent ishchisi: Pegas/Asialuxe login bo\'lsagina ulanadi, sekin operatorga uzoqroq vaqt', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'tezbooking-login-only-'));
  const database = open(join(directory, 'owner.sqlite'));
  const keys = ['OPERATOR_PEGAS_LOGIN', 'OPERATOR_PEGAS_PASSWORD'];
  const saved = keys.map(k => process.env[k]);
  t.after(() => { keys.forEach((k, i) => { if (saved[i] === undefined) delete process.env[k]; else process.env[k] = saved[i]; }); database.close(); rmSync(directory, { recursive: true, force: true }); });
  process.env.OPERATOR_PEGAS_LOGIN = 'agent';
  process.env.OPERATOR_PEGAS_PASSWORD = 'pw-123';
  const service = createOwnerService({ db: database });
  const workers = createWorkerRegistry();
  const live = { OPERATORS, searchOne: async () => ({ status: 'ok', offers: [] }) };
  const registered = registerLiveWorkers({ live, service, workers });
  assert.ok(registered.includes('pegas'));
  assert.ok(!registered.includes('asialuxe'));                     // Asialuxe logini bu testda yo'q
  assert.equal(workers.get('pegas').timeoutMs, 120000);
  assert.equal(workers.get('pegas').workerType, 'pegas-live');
  const site = service.listWebsites().find(s => s.id === 'pegas');
  assert.equal(site.integrationStatus, 'verified');
  assert.equal(site.websiteType, 'b2b');
  assert.equal(site.authStatus, 'required');
  assert.equal(service.listWebsites().find(s => s.id === 'asialuxe').integrationStatus, 'pending');
});
