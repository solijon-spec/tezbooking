'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { createLive } = require('../server/live');
const { parseLiveQuery } = require('../server/live/validation');
const { COUNTRY_RU } = require('../server/live/samo');

const NOW = Date.parse('2026-11-24T08:00:00Z');
const D = '2026-12-05';
const RET = '2026-12-12';

function makeLive(searches, extra) {
  let out = null;
  const live = createLive({
    sendJson: (_res, status, body) => { out = { status, body }; },
    operators: [{ id: 'kompas', search: 'https://op.example/search_tour' }],
    searches,
    config: Object.assign({ globalConcurrency: 4, operatorConcurrency: 2, maxQueue: 10, perClientRate: 100, globalRate: 100, tourTickets: true }, extra || {}),
    now: () => NOW
  });
  return { live, result: () => out };
}

const tourOffer = (extra) => Object.assign({ opId: 'kompas', hotel: 'Sea Hotel', stars: 4, city: 'Alanya', tour: 'Турция', checkIn: D, nights: 7, meal: 'AI', room: 'Std', price: 1000, avail: 'ok', seats: 'ok' }, extra);
const ticket = (extra) => Object.assign({ opId: 'kompas', date: D, price: 380, airline: 'Uzbekistan Airways', no: 'HY 271', dep: 330, arr: 520, fromCode: 'TAS', toCode: 'AYT',
  back: { date: RET, no: 'HY 272', dep: 600, arr: 840, seats: 'ok' } }, extra);

test('more departure cities are accepted (Bukhara, Urgench, Namangan ...), unknown ones rejected', () => {
  const q = (from) => parseLiveQuery('tours', new URL('http://x/api/live/tours?country=tr&date=' + D + '&nights=7&adults=2&from=' + from), { countries: COUNTRY_RU, now: () => NOW });
  ['tas', 'skd', 'bhk', 'ugc', 'nma', 'feg', 'azn', 'tmj', 'nvi', 'ksq', 'ncu', 'dyu'].forEach(f => assert.ok(q(f), f));
  assert.strictEqual(q('xxx'), null);
});

test('tour offers get the operator ticket (time, price) and hotel ≈ package − ticket; GDS tours are not matched to charter', async () => {
  let flightQuery = null;
  const { live, result } = makeLive({
    tours: async () => ({ offers: [tourOffer(), tourOffer({ hotel: 'GDS Hotel', tour: 'Турция GDS', gds: true, price: 1200 })] }),
    hotels: async () => ({ offers: [] }),
    flights: async (_op, fq) => { flightQuery = fq; return { offers: [ticket(), ticket({ price: 500 }), ticket({ back: { date: '2026-12-13' }, price: 100 })] }; }
  });
  await live.handle({ method: 'GET', headers: {}, socket: { remoteAddress: '10.0.0.1' } }, {}, '/api/live/tours',
    new URL('http://x/api/live/tours?country=tr&date=' + D + '&nights=7&adults=2&from=skd&window=0'));
  assert.strictEqual(flightQuery.from, 'skd');
  assert.strictEqual(flightQuery.ret, RET, 'qaytish — kirish + tunlar');
  const offers = result().body.offers;
  const sea = offers.find(o => o.hotel === 'Sea Hotel');
  assert.strictEqual(sea.ticket.price, 380, 'tunlarga mos eng arzon chipta');
  assert.strictEqual(sea.ticket.dep, 330);
  assert.strictEqual(sea.hotelPrice, 620);
  const gds = offers.find(o => o.hotel === 'GDS Hotel');
  assert.strictEqual(gds.gds, true);
  assert.strictEqual(gds.ticket, undefined, 'GDS paketga charter chipta biriktirilmaydi');
});

test('hotels: when the operator has no hotel-only search, the hotel is pulled from the tour package', async () => {
  const { live, result } = makeLive({
    tours: async () => ({ offers: [tourOffer()] }),
    hotels: async () => ({ offers: [], note: 'no_page' }),
    flights: async () => ({ offers: [ticket()] })
  });
  await live.handle({ method: 'GET', headers: {}, socket: { remoteAddress: '10.0.0.1' } }, {}, '/api/live/hotels',
    new URL('http://x/api/live/hotels?country=tr&date=' + D + '&nights=7&adults=2&window=0'));
  const offers = result().body.offers;
  assert.strictEqual(offers.length, 1);
  assert.strictEqual(offers[0].fromTour, true);
  assert.strictEqual(offers[0].price, 620);
  assert.strictEqual(offers[0].packagePrice, 1000);
  assert.strictEqual(offers[0].ticket, undefined);
});

test('hotels: no ticket price → hotel from the package is shown with the package price, marked "with flight" (no invented split)', async () => {
  const { live, result } = makeLive({
    tours: async () => ({ offers: [tourOffer({ dep: 625, depDate: D })] }),
    hotels: async () => ({ offers: [], note: 'no_page' }),
    flights: async () => { throw new Error('down'); }
  });
  await live.handle({ method: 'GET', headers: {}, socket: { remoteAddress: '10.0.0.1' } }, {}, '/api/live/hotels',
    new URL('http://x/api/live/hotels?country=tr&date=' + D + '&nights=7&adults=2&window=0'));
  const o = result().body.offers[0];
  assert.strictEqual(o.fromTour, true);
  assert.strictEqual(o.withFlight, true);
  assert.strictEqual(o.price, 1000);
  assert.strictEqual(o.hotelPrice, undefined);
});

test('ticket pages are not queried by default (LIVE_TOUR_TICKETS off); departure time comes from the tour row', async () => {
  let flightCalls = 0;
  const { live, result } = makeLive({
    tours: async () => ({ offers: [tourOffer({ dep: 625, depDate: D })] }),
    hotels: async () => ({ offers: [] }),
    flights: async () => { flightCalls++; return { offers: [ticket()] }; }
  }, { tourTickets: false });
  await live.handle({ method: 'GET', headers: {}, socket: { remoteAddress: '10.0.0.1' } }, {}, '/api/live/tours',
    new URL('http://x/api/live/tours?country=tr&date=' + D + '&nights=7&adults=2&window=0'));
  assert.strictEqual(flightCalls, 0);
  const o = result().body.offers[0];
  assert.strictEqual(o.dep, 625);
  assert.strictEqual(o.ticket, undefined);
});

test('SAMO row parsing: departure time, GDS (freight-external), route codes', () => {
  const { parseRows } = require('../server/live/samo');
  const row = (cls, sortie, info, tour) => `<tr class="even price_info ${cls} checkIn-20261206 nights-7 hotelKey-1 roomKey-2 mealKey-3" data-checkin="20261206" data-nights="7" data-hotel="1">
    <td></td><td class="arrival sortie transp_icon_1">${sortie}</td><td class="tour">${tour}</td><td class="c tour-nights">7</td>
    <td class="link-hotel"><a>Uni Sharm 3*</a> (Хадаба)</td><td class="nw hotel-seats"><span class="hotel_availability_Y"></span></td>
    <td class="hotel-meals">Half Board</td><td class="hotel-room">Standard</td>
    <td class="td_price"><span data-cat-price="1122" data-cat-currency="2">1122</span></td>
    <td class="type_price"><span>${info}</span></td><td class="transport"><span class="fr_place_r Y"></span></td></tr>`;
  const js = row('', '<div>06.12.2026</div><span data-popup="вылеты">10:25</span>', 'TAS-2-SSH', 'Sharm El Sheikh from Tashkent')
    + row('freight-external', '', 'UZ-7255-IST+ GDS/1541569', 'Отдых в Стамбуле из Ташкента');
  const [charter, gds] = parseRows({ id: 'x' }, js);
  assert.strictEqual(charter.dep, 10 * 60 + 25);
  assert.strictEqual(charter.depDate, '2026-12-06');
  assert.strictEqual(charter.fromCode, 'TAS');
  assert.strictEqual(charter.toCode, 'SSH');
  assert.strictEqual(charter.gds, false);
  assert.strictEqual(gds.gds, true);
  assert.strictEqual(gds.dep, null);
});

test('a ticket more expensive than 90 % of the package does not produce a hotel price', async () => {
  const { live, result } = makeLive({
    tours: async () => ({ offers: [tourOffer({ price: 400 })] }),
    hotels: async () => ({ offers: [] }),
    flights: async () => ({ offers: [ticket({ price: 380 })] })
  });
  await live.handle({ method: 'GET', headers: {}, socket: { remoteAddress: '10.0.0.1' } }, {}, '/api/live/tours',
    new URL('http://x/api/live/tours?country=tr&date=' + D + '&nights=7&adults=2&window=0'));
  const o = result().body.offers[0];
  assert.strictEqual(o.ticket.price, 380);
  assert.strictEqual(o.hotelPrice, undefined);
});
