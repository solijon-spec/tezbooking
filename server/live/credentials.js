'use strict';

/*
 * Operator kabinetlari uchun login/parollar — faqat .env dan (kodda va GitHub'da saqlanmaydi):
 *   OPERATOR_PRESTIGE_LOGIN=...   OPERATOR_PRESTIGE_PASSWORD=...
 * Kalit nomi — operator id'si katta harflarda, "-" o'rniga "_" (kazunion-uae -> KAZUNION_UAE).
 * Sayt (server/live) va Owner bazasidagi id'lar farq qiladigan joyda (vietratour/vietra) ikkalasi ham bitta kalitga tushadi.
 *
 * Parol hech qayerga yozilmaydi: log, javob, xato matni, holat — faqat "bor/yo'q" va kirish natijasi.
 */

const ALIASES = { vietratour: 'vietra' };

function envKey(id) {
  const base = ALIASES[id] || id;
  return 'OPERATOR_' + String(base).toUpperCase().replace(/[^A-Z0-9]+/g, '_');
}

// { login, password } yoki null (ikkalasi ham bo'lmasa — operatorga loginsiz, ochiq sahifa orqali)
function credentialsFor(id, env = process.env) {
  if (typeof id !== 'string' || !/^[a-z0-9-]{1,40}$/.test(id)) return null;
  const key = envKey(id);
  const login = typeof env[key + '_LOGIN'] === 'string' ? env[key + '_LOGIN'].trim() : '';
  const password = typeof env[key + '_PASSWORD'] === 'string' ? env[key + '_PASSWORD'] : '';   // parol kesilmaydi
  if (!login || !password || login.length > 200 || password.length > 200) return null;
  return Object.freeze({ login, password });
}

function hasCredentials(id, env = process.env) {
  return credentialsFor(id, env) !== null;
}

module.exports = { credentialsFor, hasCredentials, envKey };
