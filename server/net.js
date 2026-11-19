/*
 * TezBooking — tarmoq yordamchilari (internetga chiqarilganda).
 *
 *   TRUST_PROXY=1   server Caddy/Nginx orqasida: haqiqiy IP "X-Forwarded-For" dan olinadi
 *                   (aks holda hamma foydalanuvchi bitta IP'dan ko'rinadi va urinishlar chegarasi hammaga birdek ta'sir qiladi)
 *   COOKIE_SECURE=1 cookie'lar faqat HTTPS orqali yuboriladi (domen + HTTPS bo'lganda yoqing)
 */
'use strict';

const TRUST_PROXY = process.env.TRUST_PROXY === '1';
const COOKIE_SECURE = process.env.COOKIE_SECURE === '1';

function clientIp(req) {
  if (TRUST_PROXY) {
    const xff = String(req.headers['x-forwarded-for'] || '').split(',').map(s => s.trim()).filter(Boolean);
    if (xff.length) return xff[xff.length - 1];       // eng yaqin proksi qo'shgan qiymat (soxtalashtirib bo'lmaydi)
  }
  return req.socket.remoteAddress || '';
}
const secureAttr = () => (COOKIE_SECURE ? '; Secure' : '');

module.exports = { clientIp, secureAttr, TRUST_PROXY, COOKIE_SECURE };
