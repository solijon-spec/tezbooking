'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { open } = require('./db');
const { createOwnerService } = require('./service');
const { createOwnerAuth, hashPassword } = require('./auth');
const { createOwnerApi } = require('./index');
const { createWorkerRegistry } = require('./worker-registry');
const { createScheduler } = require('./scheduler');
const { createMainAgent } = require('./agent/main');
const { createLlmParser } = require('./agent/llm');

const ROOT = path.resolve(__dirname, '..', '..');
const DEMO_EMAIL = 'demo@tezbooking.local';

function sendJson(res, status, value) {
  if (res.headersSent) return res.end();
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(value));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', chunk => {
      size += chunk.length;
      if (size > 64 * 1024) {
        const error = Object.assign(new Error('request body too large'), { status: 413 });
        reject(error);
        req.destroy();
      } else {
        chunks.push(chunk);
      }
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function addDays(date, nights) {
  const result = new Date(date + 'T00:00:00Z');
  result.setUTCDate(result.getUTCDate() + nights);
  return result.toISOString().slice(0, 10);
}

function createAgentDemo() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'tezbooking-agent-demo-'));
  const database = open(path.join(directory, 'owner.sqlite'));
  let api;
  const service = createOwnerService({
    db: database,
    emit: event => { if (api) api.emit(event); }
  });
  const email = DEMO_EMAIL;
  const password = crypto.randomBytes(24).toString('base64url') + 'A1!';
  const auth = createOwnerAuth({ email, passwordHash: hashPassword(password), secure: () => '' });
  const workers = createWorkerRegistry();
  const scheduler = createScheduler({ service, workers, pollMs: 100 });
  let closed = false;

  database.raw.prepare('UPDATE websites SET enabled = 0').run();
  database.raw.prepare(
    "UPDATE websites SET enabled = 1, integration_status = 'verified' WHERE id = 'aqua'"
  ).run();
  service.updateSettings({
    workerConcurrency: 2,
    perOperatorConcurrency: 1,
    retryLimit: 1,
    searchTimeoutSeconds: 10
  });
  workers.register({
    operatorId: 'aqua',
    workerType: 'demo-simulator',
    supports: parameters => parameters.country === 'tr',
    async execute(context) {
      context.log('demo_worker_started', { simulated: true });
      await new Promise((resolve, reject) => {
        const timer = setTimeout(resolve, 900);
        context.signal.addEventListener('abort', () => {
          clearTimeout(timer);
          reject(Object.assign(new Error('Demo worker cancelled'), { code: 'worker_aborted' }));
        }, { once: true });
      });
      const parameters = context.task.parameters;
      return {
        offers: [{
          hotelName: 'Demo Resort (simulated)',
          sourceUrl: 'https://demo.invalid/offers/fixture',
          totalPrice: 900 + parameters.nights * 100 + parameters.childrenAges.length * 50,
          currency: parameters.currency || 'USD',
          mealPlan: parameters.mealPlan || 'unknown',
          checkIn: parameters.date,
          checkOut: addDays(parameters.date, parameters.nights),
          nights: parameters.nights,
          adults: parameters.adults,
          children: parameters.childrenAges.length,
          availability: 'unknown',
          verified: false
        }]
      };
    }
  });

  const mainAgent = createMainAgent({
    service,
    workers,
    scheduler,
    llmParser: createLlmParser({ enabled: false })
  });
  api = createOwnerApi({
    service,
    auth,
    sendJson,
    readBody,
    clientIp: req => req.socket && req.socket.remoteAddress || 'local',
    agent: mainAgent,
    scheduler
  });

  const staticFiles = new Map([
    ['/owner-demo.css', [path.join(ROOT, 'css', 'owner-demo.css'), 'text/css; charset=utf-8']],
    ['/owner.css', [path.join(ROOT, 'css', 'owner.css'), 'text/css; charset=utf-8']],
    ['/owner.js', [path.join(ROOT, 'js', 'owner.js'), 'text/javascript; charset=utf-8']]
  ]);
  const server = http.createServer((req, res) => {
    let url;
    try { url = new URL(req.url, 'http://127.0.0.1'); }
    catch (error) { return sendJson(res, 400, { error: 'bad_path' }); }
    const pathname = url.pathname;
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'");

    if (pathname === '/api/owner' || pathname.startsWith('/api/owner/')) {
      return api.handle(req, res, pathname, url).catch(error => {
        console.error('[agent-demo] request failed:', error.code || 'internal');
        sendJson(res, 500, { error: 'server' });
      });
    }
    if (pathname === '/' || pathname === '/owner' || pathname === '/owner-demo') {
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.setHeader('Allow', 'GET, HEAD');
        return sendJson(res, 405, { error: 'method_not_allowed' });
      }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      return res.end(req.method === 'HEAD' ? '' : fs.readFileSync(path.join(ROOT, 'owner-demo.html')));
    }
    const file = staticFiles.get(pathname);
    if (file && (req.method === 'GET' || req.method === 'HEAD')) {
      res.writeHead(200, { 'Content-Type': file[1], 'Cache-Control': 'no-store' });
      return res.end(req.method === 'HEAD' ? '' : fs.readFileSync(file[0]));
    }
    return sendJson(res, 404, { error: 'not_found' });
  });
  server.requestTimeout = 15000;
  server.headersTimeout = 10000;
  server.keepAliveTimeout = 5000;

  scheduler.start();

  async function close() {
    if (closed) return;
    closed = true;
    scheduler.close();
    api.close();
    auth.close();
    if (server.listening) {
      await new Promise((resolve, reject) => {
        server.close(error => error ? reject(error) : resolve());
      });
    }
    database.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }

  return { server, email, password, close };
}

if (require.main === module) {
  const port = Number(process.env.AGENT_DEMO_PORT || 3210);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('AGENT_DEMO_PORT must be an integer from 1 to 65535.');
  }
  const demo = createAgentDemo();
  demo.server.once('error', error => {
    console.error('[agent-demo] server failed:', error.message);
    demo.close().catch(closeError => console.error('[agent-demo] cleanup failed:', closeError.message));
    process.exitCode = 1;
  });
  demo.server.listen(port, '127.0.0.1', () => {
    console.log('TezBooking agent demo: http://127.0.0.1:' + port + '/owner-demo');
    console.log('Demo login: ' + demo.email);
    console.log('Temporary password: ' + demo.password);
    console.log('Simulated worker only; no supplier requests. Press Ctrl+C to stop and delete the temporary database.');
  });
  ['SIGINT', 'SIGTERM'].forEach(signal => process.once(signal, () => {
    demo.close().catch(error => {
      console.error('[agent-demo] cleanup failed:', error.message);
      process.exitCode = 1;
    });
  }));
}

module.exports = { createAgentDemo, DEMO_EMAIL };
