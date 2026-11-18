/*
 * TezBooking — bronlar API'si va jonli yangilanishlar.
 *
 *   GET  /api/bookings           faol bronlar ro'yxati
 *   POST /api/bookings           yangi bron       { key, product, title, op, price?, at? }
 *                                -> 201 yangi | 409 bu taklif allaqachon bron qilingan
 *   POST /api/bookings/cancel    bronni bekor qilish  { key }
 *   GET  /api/bookings/history?key=...   bitta bron tarixi
 *   GET  /api/events             jonli yangilanishlar (Server-Sent Events):
 *                                bron qo'shilsa yoki bekor qilinsa, barcha ochiq sahifalarga "bookings" hodisasi boradi
 *
 * Keyingi bosqichda ta'minotchi kuzatuvchisi (cron / webhook) ham shu yerdagi notify() orqali saytga xabar beradi.
 */
'use strict';

const { PRODUCTS } = require('./db');

const MAX_KEY = 300, MAX_TEXT = 200;

function createBookingsApi({ db, sendJson, readBody, accounts }) {
  // ---------- Jonli ulanishlar (SSE) ----------
  const clients = new Set();
  let version = 0;

  function notify(reason) {
    version++;
    const msg = `event: bookings\ndata: ${JSON.stringify({ v: version, reason })}\n\n`;
    clients.forEach(res => { try { res.write(msg); } catch (e) { clients.delete(res); } });
  }
  // Har 25 soniyada bo'sh xabar — proksi va brauzer ulanishni uzib qo'ymasligi uchun
  const ping = setInterval(() => clients.forEach(res => { try { res.write(': ping\n\n'); } catch (e) { clients.delete(res); } }), 25000);
  ping.unref();

  function handleEvents(req, res) {
    if (clients.size >= 200) return sendJson(res, 503, { error: 'busy' });
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no'
    });
    res.write(`retry: 3000\nevent: hello\ndata: ${JSON.stringify({ v: version })}\n\n`);
    clients.add(res);
    req.on('close', () => clients.delete(res));
  }

  // ---------- Tekshirish ----------
  const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
  function cleanBooking(b) {
    if (!b || typeof b !== 'object') return null;
    const key = typeof b.key === 'string' ? b.key : '';
    if (!key || key.length > MAX_KEY || /[\u0000-\u001f]/.test(key)) return null;
    const product = PRODUCTS.includes(b.product) ? b.product : (key.startsWith('F|') ? 'flight' : 'tour');
    const title = str(b.title, MAX_TEXT);
    if (!title) return null;
    const price = typeof b.price === 'number' && isFinite(b.price) && b.price >= 0 && b.price < 1e7 ? Math.round(b.price * 100) / 100 : null;
    const at = typeof b.at === 'number' && isFinite(b.at) ? b.at : null;
    return { key, product, title, op: str(b.op, MAX_TEXT), price, at, source: b.source === 'import' ? 'import' : 'site' };
  }
  async function jsonBody(req) {
    // Faqat JSON (cookie bilan ishlaydigan so'rovlarni boshqa saytdan oddiy forma orqali yuborib bo'lmasin)
    if (!/^application\/json/i.test(req.headers['content-type'] || '')) return null;
    try { return JSON.parse(await readBody(req)); } catch (e) { return null; }
  }

  // ---------- Marshrutlar ----------
  async function handle(req, res, pathname, url) {
    if (pathname === '/api/events') {
      if (req.method !== 'GET') return sendJson(res, 405, { error: 'method' });
      return handleEvents(req, res);
    }
    // Kim so'rayapti: tur firma (login qilgan) yoki mehmon
    const agency = accounts.agencyOf(req);

    if (pathname === '/api/bookings') {
      if (req.method === 'GET') {
        // Hamma bronlar kaliti qaytariladi (band takliflar qidiruvda ko'rinmasligi uchun),
        // lekin nomi va narxi — faqat firmaning o'z bronlari uchun
        const list = db.listActive().map(b => (agency && b.agencyId === agency.id)
          ? { key: b.key, product: b.product, title: b.title, op: b.op, price: b.price, from: b.from, to: b.to, at: b.at, mine: true }
          : { key: b.key, mine: false });
        return sendJson(res, 200, { bookings: list, v: version });
      }
      if (req.method !== 'POST') return sendJson(res, 405, { error: 'method' });
      // Bron qilish: faqat login qilgan va tarifi faol tur firma
      if (!agency) return sendJson(res, 401, { error: 'login_required' });
      if (!accounts.isActive(agency)) return sendJson(res, 402, { error: 'subscription_required' });
      const input = cleanBooking(await jsonBody(req));
      if (!input) return sendJson(res, 400, { error: 'bad_request' });
      input.agencyId = agency.id;
      input.agencyName = agency.name;
      const r = db.createBooking(input);
      if (!r.created) return sendJson(res, 409, { error: 'already_booked', booking: r.booking });
      notify('created');
      return sendJson(res, 201, { booking: r.booking });
    }
    if (pathname === '/api/bookings/cancel') {
      if (req.method !== 'POST') return sendJson(res, 405, { error: 'method' });
      if (!agency) return sendJson(res, 401, { error: 'login_required' });
      const body = await jsonBody(req);
      const key = body && typeof body.key === 'string' ? body.key : '';
      if (!key || key.length > MAX_KEY) return sendJson(res, 400, { error: 'bad_request' });
      const b = db.cancelBooking(key, 'site', agency.id);
      if (b === 'forbidden') return sendJson(res, 403, { error: 'not_yours' });
      if (!b) return sendJson(res, 404, { error: 'not_found' });
      notify('cancelled');
      return sendJson(res, 200, { booking: b });
    }
    if (pathname === '/api/bookings/history') {
      if (!agency) return sendJson(res, 401, { error: 'login_required' });
      const key = url.searchParams.get('key') || '';
      const own = db.listActive().some(b => b.key === key && b.agencyId === agency.id);
      if (!own) return sendJson(res, 404, { error: 'not_found' });
      const h = db.history(key);
      return h ? sendJson(res, 200, { events: h }) : sendJson(res, 404, { error: 'not_found' });
    }
    return sendJson(res, 404, { error: 'not_found' });
  }

  return { handle, notify, clientCount: () => clients.size };
}

module.exports = { createBookingsApi };
