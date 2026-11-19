'use strict';

const crypto = require('node:crypto');
const { secureAttr } = require('../net');

const COOKIE = 'tb_owner';
const SESSION_MS = 12 * 60 * 60 * 1000;

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  return 'scrypt$' + salt + '$' + crypto.scryptSync(String(password), salt, 32).toString('hex');
}

function validHash(value) {
  return /^scrypt\$[a-f0-9]{32}\$[a-f0-9]{64}$/i.test(String(value || ''));
}

function checkPassword(password, stored) {
  if (!validHash(stored) || typeof password !== 'string' || password.length < 12 || password.length > 1024) return false;
  const [, salt, hash] = stored.split('$');
  const expected = Buffer.from(hash, 'hex');
  const actual = crypto.scryptSync(password, salt, expected.length);
  return crypto.timingSafeEqual(expected, actual);
}

function createOwnerAuth({ email, passwordHash, now = Date.now, secure = () => secureAttr() }) {
  const ownerEmail = String(email || '').trim().toLowerCase();
  const enabled = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(ownerEmail) && validHash(passwordHash);
  const sessions = new Map();

  function tokenOf(req) {
    const cookie = String(req.headers.cookie || '');
    const match = cookie.match(new RegExp('(?:^|;\\s*)' + COOKIE + '=([a-f0-9]{64})(?:;|$)', 'i'));
    return match ? match[1] : null;
  }

  function ownerOf(req) {
    const token = tokenOf(req);
    const session = token && sessions.get(token);
    if (!session) return null;
    if (session.expiresAt <= now()) {
      sessions.delete(token);
      return null;
    }
    return { email: ownerEmail };
  }

  function cookie(token, maxAge) {
    return `${COOKIE}=${token}; Path=/api/owner; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure()}`;
  }

  function login(requestEmail, password) {
    if (!enabled || String(requestEmail || '').trim().toLowerCase() !== ownerEmail || !checkPassword(password, passwordHash)) return null;
    const token = crypto.randomBytes(32).toString('hex');
    sessions.set(token, { expiresAt: now() + SESSION_MS });
    return { token, cookie: cookie(token, SESSION_MS / 1000), owner: { email: ownerEmail } };
  }

  function logout(req) {
    const token = tokenOf(req);
    if (token) sessions.delete(token);
    return cookie('', 0);
  }

  const cleanup = setInterval(() => {
    const time = now();
    sessions.forEach((session, token) => {
      if (session.expiresAt <= time) sessions.delete(token);
    });
  }, 10 * 60 * 1000);
  cleanup.unref();

  return { enabled, ownerOf, login, logout, close: () => clearInterval(cleanup) };
}

module.exports = { createOwnerAuth, hashPassword, checkPassword, validHash, COOKIE, SESSION_MS };
