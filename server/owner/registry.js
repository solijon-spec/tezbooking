'use strict';

const INITIAL_SITES = [
  ['aqua', 'Aqua Travel', 'https://agency.aqua-travelgroup.com/tour-package'],
  ['asialuxe', 'Asialuxe', 'https://b2b.asialuxe.uz/login'],
  ['crystalbay', 'Crystal Bay', 'https://booking.crystalbay.com/search_tour'],
  ['kompas', 'Kompas Tour', 'https://online.uz.kompastour.com/search_tour'],
  ['prestige', 'Prestige', 'http://online.uz-prestige.com/'],
  ['pegas', 'Pegas', 'https://uz.pegast.asia/PackageSearch'],
  ['vietra', 'Vietra Tour', 'https://b2b.vietratour.com/'],
  ['fstravel', 'FS Travel', 'https://b2b.fstravel.asia/menu?samo_action=logon'],
  ['kazunion', 'Kazunion', 'https://online.kazunion.com/'],
  ['kazunion-uae', 'Kazunion UAE', 'https://uae.kazunion.com'],
  ['centrum', 'Centrum Holidays', 'https://online.centrum-holidays.com/search_tour'],
  ['flykhiva', 'Fly Khiva', 'https://b2b.flykhiva.travel/search_tour'],
  ['easybooking', 'Easybooking', 'https://tours.easybooking.uz/search_tour'],
  ['selfie', 'Selfie Travel', 'http://b2b.selfietravel.kz/search_tour'],
  ['velikolepniy-vek', 'Velikolepniy Vek', 'https://velikolepniy-vek.com/login'],
  ['rezlive', 'Rezlive', 'https://www.rezlive.com'],
  ['savtour', 'Savtour', 'https://online.savtour.az/search_tour'],
  ['mir-jahon', 'Mir Jahon', 'https://online.mir-jahon.uz'],
  ['malva', 'Malva Tour', 'https://malvatouroperator.uz/search_tour']
];

const INITIAL_SETTINGS = {
  worker_concurrency: 3,
  per_operator_concurrency: 1,
  retry_limit: 2,
  search_timeout_seconds: 45,
  retention_days: 90
};

function initialSites() {
  const seen = new Set();
  return INITIAL_SITES.filter(([, , url]) => {
    if (seen.has(url)) return false;
    seen.add(url);
    return true;
  }).map(([id, name, url]) => ({
    id,
    workerId: 'worker_' + id.replace(/[^a-z0-9]+/g, '_'),
    name,
    url,
    loginUrl: url,
    searchUrl: url,
    websiteType: 'pending'
  }));
}

module.exports = { INITIAL_SETTINGS, INITIAL_SITES, initialSites };
