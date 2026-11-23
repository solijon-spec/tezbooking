'use strict';

// Agentlarni admin paneldan boshqarish: Owner API /api/admin/agents ostida, admin sessiyasi bilan
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const { open } = require('../server/owner/db');
const { createOwnerService } = require('../server/owner/service');
const { createOwnerApi } = require('../server/owner');
const { createWorkerRegistry } = require('../server/owner/worker-registry');
const { createScheduler } = require('../server/owner/scheduler');
const { createMainAgent } = require('../server/owner/agent/main');
const { createLlmParser } = require('../server/owner/agent/llm');
const { setupDemoWorker } = require('../server/owner/demo-server');

const PREFIX = '/api/admin/agents';

function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'tezbooking-admin-agents-'));
  const database = open(path.join(directory, 'owner.sqlite'));
  const service = createOwnerService({ db: database });
  const workers = createWorkerRegistry();
  setupDemoWorker({ database, service, workers });
  const scheduler = createScheduler({ service, workers, pollMs: 20 });
  const agent = createMainAgent({ service, workers, scheduler, llmParser: createLlmParser({ enabled: false }) });
  let adminCookieOk = false;
  const api = createOwnerApi({
    service,
    auth: { enabled: true, ownerOf: req => (adminCookieOk && /tb_admin=/.test(req.headers.cookie || '') ? { email: 'admin' } : null) },
    sendJson: (res, status, value) => { res.status = status; res.body = JSON.stringify(value); },
    readBody: req => Promise.resolve(req.body),
    clientIp: () => '127.0.0.1',
    agent, scheduler, prefix: PREFIX, manageSession: false
  });
  scheduler.start();
  t.after(() => {
    scheduler.close();
    api.close();
    database.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });
  return { api, service, login: () => { adminCookieOk = true; } };
}

async function call(api, { method = 'GET', route, body, cookie = 'tb_admin=x', headers = {} }) {
  const req = {
    method,
    headers: Object.assign({ host: 'localhost:3001', origin: 'http://localhost:3001', 'content-type': 'application/json', cookie }, headers),
    body: body === undefined ? '' : JSON.stringify(body)
  };
  const res = { status: 0, body: '', headers: {}, setHeader(n, v) { this.headers[n.toLowerCase()] = v; } };
  await api.handle(req, res, PREFIX + route, new URL('http://localhost:3001' + PREFIX + route));
  return { status: res.status, json: res.body ? JSON.parse(res.body) : null };
}

test('admin agents API requires an admin session and has no own login', async t => {
  const { api } = fixture(t);
  assert.equal((await call(api, { route: '/overview' })).status, 401);
  assert.equal((await call(api, { method: 'POST', route: '/login', body: { email: 'a@b.c', password: 'x'.repeat(16) } })).status, 404);
  assert.equal((await call(api, { method: 'POST', route: '/logout', body: {} })).status, 404);
});

test('admin can queue an agent task, see the simulated result and change settings', async t => {
  const { api, login } = fixture(t);
  login();
  const overview = await call(api, { route: '/overview' });
  assert.equal(overview.status, 200);
  assert.equal(overview.json.websites.verified, 1);

  // Boshqa manzildan o'zgartirish rad etiladi
  const foreign = await call(api, { method: 'POST', route: '/settings', body: { workerConcurrency: 3 }, headers: { origin: 'http://evil.example' } });
  assert.equal(foreign.status, 403);

  const date = new Date(Date.now() + 20 * 86400000).toISOString().slice(0, 10);
  const created = await call(api, {
    method: 'POST', route: '/searches', headers: { 'idempotency-key': 'admin-test-1' },
    body: { parameters: { destination: 'Antalya', country: 'tr', date, nights: 7, adults: 2, childrenAges: [], currency: 'USD' } }
  });
  assert.equal(created.status, 201);
  assert.equal(created.json.task.status, 'queued');

  let task;
  for (let i = 0; i < 100; i++) {
    task = (await call(api, { route: '/searches/' + created.json.task.id })).json.task;
    if (task.status === 'completed') break;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  assert.equal(task.status, 'completed');
  const offers = await call(api, { route: '/searches/' + task.id + '/offers' });
  assert.equal(offers.json.offers.length, 1);

  const settings = await call(api, {
    method: 'POST', route: '/settings',
    body: { workerConcurrency: 3, perOperatorConcurrency: 1, retryLimit: 1, searchTimeoutSeconds: 15, retentionDays: 30 }
  });
  assert.equal(settings.status, 200);
  assert.equal(settings.json.settings.worker_concurrency, 3);
});
