'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

test('live flight normalization preserves unknown baggage, stops, and availability', () => {
  const context = { window: {}, Date, Math, JSON, Object, String, Number, Array, localStorage: { getItem: () => null, setItem: () => {} } };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'js', 'data.js'), 'utf8'), context);
  const query = { from: 'tas', to: 'tr', ret: null, adults: 2, childAges: [], cabin: 'eco' };
  const date = '2027-01-20';

  context.window.TB.live.setFlights(query, date, { offers: [{
    opId: 'kompas', freight: '1', airline: 'Example Air', no: 'EA100', date, price: 250,
    fromCode: 'TAS', toCode: 'AYT', dep: 600, arr: 900, dur: 300, seats: 'unknown', bagKg: null
  }] });

  const flight = context.window.TB.live.flightEntry(query, date).flights[0];
  assert.equal(flight.bag, 'unknown');
  assert.equal(flight.bagKg, null);
  assert.equal(flight.direct, null);
  assert.equal(flight.out.direct, null);
  assert.equal(flight.seats, 'unknown');
});
