'use strict';

const DAY_MS = 24 * 60 * 60 * 1000;
// Jo'nash shaharlari: Toshkent, Samarqand, Buxoro, Urganch, Namangan, Farg'ona, Andijon, Termiz, Navoiy, Qarshi, Nukus, Dushanbe
const FROM_IDS = ['tas', 'skd', 'bhk', 'ugc', 'nma', 'feg', 'azn', 'tmj', 'nvi', 'ksq', 'ncu', 'dyu'];

function validDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return false;
  const date = new Date(value + 'T00:00:00.000Z');
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function hasCountry(countries, country) {
  return Object.prototype.hasOwnProperty.call(countries, country);
}

function addDays(value, days) {
  return new Date(Date.parse(value + 'T00:00:00.000Z') + days * DAY_MS).toISOString().slice(0, 10);
}

function integerParam(params, name, min, max, fallback) {
  const values = params.getAll(name);
  if (!values.length) return fallback;
  if (values.length !== 1 || !/^\d+$/.test(values[0])) return null;
  const value = Number(values[0]);
  return Number.isSafeInteger(value) && value >= min && value <= max ? value : null;
}

function parseLiveQuery(kind, url, { countries, now = Date.now() }) {
  if (url.search.length > 512) return null;
  const params = url.searchParams;
  const dateValues = params.getAll('date');
  const adults = integerParam(params, 'adults', 1, 8);
  const window = integerParam(params, 'window', 0, 3, 0);
  const date = dateValues.length === 1 ? dateValues[0] : '';
  const today = new Date(now()).toISOString().slice(0, 10);
  const maxDate = addDays(today, 365);

  if (adults === null || window === null || !validDate(date) || date < today || date > maxDate) return null;
  if (addDays(date, window) < addDays(today, 1)) return null;

  const childValues = params.getAll('children');
  if (childValues.length > 1) return null;
  const childrenText = childValues[0] || '';
  const maxChildren = kind === 'flights' ? 3 : 4;
  let childAges = [];
  if (childrenText) {
    if (!/^\d{1,2}(,\d{1,2})*$/.test(childrenText)) return null;
    childAges = childrenText.split(',').map(Number);
    if (childAges.length > maxChildren || childAges.some(age => age < 0 || age > 17)) return null;
  }

  const fromValues = params.getAll('from');
  if (fromValues.length > 1) return null;
  const from = fromValues.length ? fromValues[0] : 'tas';
  if (!FROM_IDS.includes(from)) return null;

  if (kind === 'flights') {
    const toValues = params.getAll('to');
    const returnValues = params.getAll('ret');
    const cabinValues = params.getAll('cabin');
    if (toValues.length !== 1 || !hasCountry(countries, toValues[0]) || returnValues.length > 1 || cabinValues.length > 1) return null;
    const retText = returnValues[0] || '';
    if (retText && (!validDate(retText) || retText <= date || retText > maxDate)) return null;
    const cabin = cabinValues.length ? cabinValues[0] : 'eco';
    if (!['eco', 'bus'].includes(cabin)) return null;
    return { to: toValues[0], date, ret: retText || null, adults, childAges, from, cabin, window };
  }

  const countryValues = params.getAll('country');
  const nights = integerParam(params, 'nights', 1, 30);
  if (countryValues.length !== 1 || !hasCountry(countries, countryValues[0]) || nights === null) return null;
  if (kind === 'hotels') return { country: countryValues[0], date, nights, adults, childAges, window };
  return { country: countryValues[0], date, nights, adults, childAges, from, window };
}

module.exports = { validDate, parseLiveQuery, FROM_IDS };
