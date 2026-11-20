const test = require('node:test');
const assert = require('node:assert/strict');
const { parseNaturalLanguage } = require('../server/owner/agent/parser');

const nextYearIfPast = (mmdd) => {
  const now = new Date().toISOString().slice(0, 10);
  const y = Number(now.slice(0, 4));
  return `${y}-${mmdd}` < now ? `${y + 1}-${mmdd}` : `${y}-${mmdd}`;
};

test('Uzbek request with suffixes, month name and "kishi" is understood', () => {
  const { parameters: p, missing } = parseNaturalLanguage('Antalyaga 15-dekabr 7 kecha 2 kishi hammasi kiritilgan 2000 dollargacha');
  assert.equal(p.destination, 'Antalya');
  assert.equal(p.country, 'tr');
  assert.equal(p.date, nextYearIfPast('12-15'));
  assert.equal(p.nights, 7);
  assert.equal(p.adults, 2);
  assert.equal(p.mealPlan, 'AI');
  assert.deepEqual(missing, []);
});

test('Uzbek short request asks only for what is missing', () => {
  const { parameters: p, missing } = parseNaturalLanguage('Antalyaga 2 kishi tur kerak');
  assert.equal(p.destination, 'Antalya');
  assert.equal(p.country, 'tr');
  assert.equal(p.adults, 2);
  assert.deepEqual(missing.sort(), ['date', 'nights']);
});

test('Russian request with case endings is understood', () => {
  const { parameters: p } = parseNaturalLanguage('Тур в Дубай 3 января 2027, 5 ночей, 2 взрослых, завтрак, бюджет 1500 USD');
  assert.equal(p.destination, 'Dubai');
  assert.equal(p.country, 'ae');
  assert.equal(p.date, '2027-01-03');
  assert.equal(p.nights, 5);
  assert.equal(p.adults, 2);
  assert.equal(p.mealPlan, 'BB');
  assert.equal(p.budget, 1500);
  assert.equal(p.currency, 'USD');
});

test('country-only Uzbek and Russian forms resolve the country', () => {
  assert.equal(parseNaturalLanguage('Turkiyaga tur').parameters.country, 'tr');
  assert.equal(parseNaturalLanguage('в Турцию').parameters.country, 'tr');
  assert.equal(parseNaturalLanguage('Misrga').parameters.country, 'eg');
  assert.equal(parseNaturalLanguage('Gruziyaga').parameters.country, 'ge');
});

test('numbers are not mistaken for dates or budgets', () => {
  const { parameters: p } = parseNaturalLanguage('Turkey 7 nights 2 adults');
  assert.equal(p.date, null);
  assert.equal(p.budget, null);
});
