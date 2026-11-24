'use strict';

const { randomUUID } = require('node:crypto');

const AVAILABILITY = new Set(['available', 'on_request', 'sold_out', 'unknown']);
const MEAL_PLANS = new Set(['RO', 'BB', 'HB', 'FB', 'AI', 'UAI', 'unknown']);

function validDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(value + 'T00:00:00Z');
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function normalizeOffer(input, now = Date.now) {
  if (!input || typeof input !== 'object') throw new TypeError('offer must be an object');
  const operatorName = String(input.operatorName || '').trim();
  const sourceUrl = String(input.sourceUrl || '').trim();
  const hotelName = String(input.hotelName || '').trim();
  const totalPrice = Number(input.totalPrice);
  const currency = String(input.currency || '').trim().toUpperCase();
  let url;
  try { url = new URL(sourceUrl); } catch (error) { url = null; }

  if (!operatorName || operatorName.length > 120 || !hotelName || hotelName.length > 240
    || !url || !['https:', 'http:'].includes(url.protocol) || url.username || url.password
    || !Number.isFinite(totalPrice) || totalPrice <= 0 || !/^[A-Z]{3}$/.test(currency)) {
    throw new TypeError('offer is missing valid source, hotel, or price data');
  }

  const availability = AVAILABILITY.has(input.availability) ? input.availability : 'unknown';
  const mealPlan = MEAL_PLANS.has(input.mealPlan) ? input.mealPlan : 'unknown';
  const identity = typeof input.hotelIdentity === 'string' && input.identityVerified === true
    ? input.hotelIdentity.trim().slice(0, 200) || null
    : null;
  const optionalText = (value, limit = 160) => typeof value === 'string' && value.trim() ? value.trim().slice(0, limit) : null;
  const checkIn = input.checkIn == null || input.checkIn === '' ? null : validDate(input.checkIn) ? input.checkIn : false;
  const checkOut = input.checkOut == null || input.checkOut === '' ? null : validDate(input.checkOut) ? input.checkOut : false;
  if (checkIn === false || checkOut === false || (checkIn && checkOut && checkOut <= checkIn)) {
    throw new TypeError('offer has invalid travel dates');
  }
  const baggage = input.baggageVerified === true ? optionalText(input.baggage, 120) : null;
  const directFlight = input.directFlightVerified === true && typeof input.directFlight === 'boolean' ? input.directFlight : null;

  return {
    id: randomUUID(),
    operatorName,
    sourceUrl: url.href,
    hotelName,
    hotelIdentity: identity,
    identityVerified: !!identity,
    hotelLocation: optionalText(input.hotelLocation),
    country: optionalText(input.country, 80),
    city: optionalText(input.city, 80),
    hotelStars: Number.isInteger(input.hotelStars) && input.hotelStars >= 1 && input.hotelStars <= 5 ? input.hotelStars : null,
    roomType: optionalText(input.roomType),
    mealPlan,
    checkIn,
    checkOut,
    nights: Number.isInteger(input.nights) && input.nights > 0 && input.nights <= 60 ? input.nights : null,
    adults: Number.isInteger(input.adults) && input.adults > 0 && input.adults <= 8 ? input.adults : null,
    children: Number.isInteger(input.children) && input.children >= 0 && input.children <= 4 ? input.children : null,
    totalPrice,
    currency,
    availability,
    flightIncluded: input.flightIncludedVerified === true && typeof input.flightIncluded === 'boolean' ? input.flightIncluded : null,
    flightIncludedVerified: input.flightIncludedVerified === true && typeof input.flightIncluded === 'boolean',
    directFlight,
    directFlightVerified: directFlight !== null,
    baggage,
    baggageVerified: !!baggage,
    transferIncluded: typeof input.transferIncluded === 'boolean' ? input.transferIncluded : null,
    // Tur paket: uchish (masalan "TAS → SSH · 2026-12-06 10:25") va GDS (muntazam reys) belgisi
    departure: optionalText(input.departure, 80),
    gds: typeof input.gds === 'boolean' ? input.gds : null,
    verificationStatus: input.verified === true ? 'verified' : 'unverified',
    retrievedAt: now()
  };
}

function compareOffers(offers) {
  const sorted = offers.slice().sort((a, b) => a.totalPrice - b.totalPrice || a.operatorName.localeCompare(b.operatorName));
  const groups = new Map();
  sorted.forEach(offer => {
    const key = offer.identityVerified && offer.hotelIdentity
      ? 'verified:' + offer.hotelIdentity + ':' + offer.currency
      : 'offer:' + offer.id;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(offer);
  });
  return [...groups.values()].map(group => ({
    hotelIdentity: group[0].identityVerified ? group[0].hotelIdentity : null,
    identityVerified: group[0].identityVerified,
    hotelName: group[0].hotelName,
    offers: group,
    cheapestPrice: group[0].totalPrice,
    currency: group[0].currency
  }));
}

module.exports = { normalizeOffer, compareOffers };
