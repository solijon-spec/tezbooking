'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const { open } = require('../server/owner/db');
const { createOwnerService, validateSearchParameters } = require('../server/owner/service');
const { createOwnerAuth, hashPassword } = require('../server/owner/auth');
const { createOwnerApi } = require('../server/owner');
const { normalizeOffer, compareOffers } = require('../server/owner/normalize');
const { createMainAgent } = require('../server/owner/agent/main');
const { createLlmParser } = require('../server/owner/agent/llm');
const { createWorkerRegistry } = require('../server/owner/worker-registry');

const FIXED_NOW = Date.UTC(2030, 0, 1, 12);
const validParameters = {
  destination: 'Antalya',
  country: 'tr',
  date: '2030-01-03',
  nights: 7,
  adults: 2,
  childrenAges: [],
  currency: 'USD'
};

function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'tezbooking-owner-'));
  const database = open(path.join(directory, 'owner.sqlite'));
  const service = createOwnerService({ db: database, now: () => FIXED_NOW });
  t.after(() => {
    database.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });
  return { database, service, directory };
}

function apiResponse() {
  return {
    status: 0,
    headers: {},
    body: '',
    setHeader(name, value) { this.headers[name.toLowerCase()] = value; },
    writeHead(status, headers = {}) {
      this.status = status;
      Object.entries(headers).forEach(([name, value]) => this.setHeader(name, value));
    },
    end(body = '') { this.body = body; }
  };
}

async function callApi(api, { method = 'GET', route, body, cookie, origin = 'http://localhost:3000' }) {
  const req = {
    method,
    headers: {
      host: 'localhost:3000',
      origin,
      'content-type': 'application/json',
      cookie: cookie || ''
    },
    body: body === undefined ? '' : JSON.stringify(body)
  };
  const res = apiResponse();
  await api.handle(req, res, '/api/owner' + route, new URL('http://localhost:3000/api/owner' + route));
  return { ...res, json: res.body ? JSON.parse(res.body) : null };
}

test('Owner API denies unauthenticated access and rejects cross-origin mutations', async t => {
  const { service } = fixture(t);
  const auth = createOwnerAuth({
    email: 'owner@example.com',
    passwordHash: hashPassword('a-secure-owner-password'),
    secure: () => ''
  });
  assert.equal(auth.login('not-the-owner@example.com', 'a-secure-owner-password'), null);
  assert.equal(auth.login('owner@example.com', 'short'), null);
  t.after(() => auth.close());
  const api = createOwnerApi({
    service,
    auth,
    sendJson: (res, status, value) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(value));
    },
    readBody: async req => req.body,
    clientIp: () => '127.0.0.1',
    now: () => FIXED_NOW
  });

  assert.equal((await callApi(api, { route: '/overview' })).status, 401);
  assert.equal((await callApi(api, {
    method: 'POST', route: '/agent/searches', body: { command: 'unauthorized request' }
  })).status, 401);
  const rejected = await callApi(api, {
    method: 'POST', route: '/login', origin: 'https://attacker.example',
    body: { email: 'owner@example.com', password: 'a-secure-owner-password' }
  });
  assert.equal(rejected.status, 403);

  const login = await callApi(api, {
    method: 'POST', route: '/login',
    body: { email: 'owner@example.com', password: 'a-secure-owner-password' }
  });
  assert.equal(login.status, 200);
  assert.equal(login.json.authenticated, true);
  assert.match(login.headers['set-cookie'], /HttpOnly/);
  assert.match(login.headers['set-cookie'], /SameSite=Strict/);
  const cookie = login.headers['set-cookie'].split(';')[0];
  assert.equal((await callApi(api, { route: '/overview', cookie })).status, 200);
  assert.equal((await callApi(api, { route: '/overview', cookie: 'tb_owner=invalid' })).status, 401);
  api.close();
});

test('authenticated Owner can submit a Main Agent task and receive clarification safely', async t => {
  const { service, database } = fixture(t);
  const auth = createOwnerAuth({
    email: 'owner@example.com',
    passwordHash: hashPassword('a-secure-owner-password'),
    secure: () => ''
  });
  t.after(() => auth.close());
  const agent = createMainAgent({
    service,
    workers: createWorkerRegistry(),
    scheduler: { wake() {} },
    llmParser: createLlmParser({ enabled: false }),
    now: () => FIXED_NOW
  });
  const api = createOwnerApi({
    service,
    auth,
    agent,
    sendJson: (res, status, value) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(value));
    },
    readBody: async req => req.body,
    clientIp: () => '127.0.0.1',
    now: () => FIXED_NOW
  });
  t.after(() => api.close());
  const login = await callApi(api, {
    method: 'POST', route: '/login',
    body: { email: 'owner@example.com', password: 'a-secure-owner-password' }
  });
  const cookie = login.headers['set-cookie'].split(';')[0];

  const clarification = await callApi(api, {
    method: 'POST', route: '/agent/searches', cookie,
    body: { command: 'Find 2 adults in Antalya, Turkey' }
  });
  assert.equal(clarification.status, 200);
  assert.equal(clarification.json.status, 'needs_clarification');
  assert.equal(database.raw.prepare('SELECT COUNT(*) AS count FROM search_tasks').get().count, 0);

  const created = await callApi(api, {
    method: 'POST', route: '/agent/searches', cookie,
    body: { command: 'Find 2 adults, 7 nights in Antalya, Turkey from 2030-01-03' }
  });
  assert.equal(created.status, 201);
  assert.equal(created.json.status, 'task_created');
  assert.equal(created.json.task.status, 'blocked');
  assert.equal(database.raw.prepare('SELECT COUNT(*) AS count FROM search_tasks').get().count, 1);
});

test('registry seeds all 19 sources as pending and creates blocked tasks without supplier calls', t => {
  const { service, database } = fixture(t);
  assert.equal(validateSearchParameters({ ...validParameters, departureAirport: 'unknown' }, () => FIXED_NOW), null);
  assert.equal(validateSearchParameters({ ...validParameters, date: '2030-02-30' }, () => FIXED_NOW), null);
  const websites = service.listWebsites();
  assert.equal(websites.length, 19);
  assert.ok(websites.every(site => site.integrationStatus === 'pending' && site.workerStatus === 'pending'));

  const result = service.createSearch({ parameters: validParameters });
  assert.equal(result.task.status, 'blocked');
  assert.equal(result.task.errorCode, 'no_verified_adapters');
  assert.equal(result.task.totalWorkers, 19);
  assert.equal(result.task.executions.length, 19);
  assert.ok(result.task.executions.every(execution => execution.status === 'blocked'));
  assert.equal(database.raw.prepare("SELECT COUNT(*) AS n FROM hotel_offers").get().n, 0);
});

test('execution state transitions enforce verification and per-operator concurrency', t => {
  const { service, database } = fixture(t);
  const raw = database.raw;
  const pendingTask = service.createSearch({ parameters: validParameters }).task;
  assert.equal(service.transitionExecution(pendingTask.executions[0].id, 'queued'), null);
  raw.prepare('UPDATE websites SET enabled = 0').run();
  raw.prepare("UPDATE websites SET enabled = 1, integration_status = 'verified' WHERE id = 'aqua'").run();
  assert.equal(service.updateSettings({ workerConcurrency: 3, perOperatorConcurrency: 1 }).worker_concurrency, 3);

  const first = service.createSearch({ parameters: validParameters }).task;
  const firstExecution = first.executions[0];
  assert.equal(service.transitionExecution(firstExecution.id, 'queued').status, 'queued');
  assert.equal(service.transitionExecution(firstExecution.id, 'running').attempts, 1);
  assert.equal(service.getTask(first.id).status, 'running');

  const second = service.createSearch({ parameters: validParameters }).task;
  const secondExecution = second.executions[0];
  assert.equal(service.transitionExecution(secondExecution.id, 'queued').status, 'queued');
  assert.equal(service.transitionExecution(secondExecution.id, 'running'), null);

  assert.equal(service.transitionExecution(firstExecution.id, 'completed').status, 'completed');
  assert.equal(service.getTask(first.id).status, 'completed');
  assert.equal(service.transitionExecution(secondExecution.id, 'running').status, 'running');
  assert.equal(service.transitionExecution(secondExecution.id, 'completed').status, 'completed');
  assert.equal(service.getTask(second.id).status, 'completed');
  assert.equal(service.transitionTask(first.id, 'failed'), null);
});

test('global worker concurrency caps executions across different operators', t => {
  const { service, database } = fixture(t);
  const raw = database.raw;
  raw.prepare('UPDATE websites SET enabled = 0').run();
  raw.prepare("UPDATE websites SET enabled = 1, integration_status = 'verified' WHERE id IN ('aqua', 'malva')").run();
  service.updateSettings({ workerConcurrency: 1, perOperatorConcurrency: 1 });
  const task = service.createSearch({ parameters: validParameters }).task;
  assert.equal(task.executions.length, 2);
  const aqua = task.executions.find(execution => execution.websiteId === 'aqua');
  const malva = task.executions.find(execution => execution.websiteId === 'malva');
  service.transitionExecution(aqua.id, 'queued');
  service.transitionExecution(malva.id, 'queued');
  assert.equal(service.transitionExecution(aqua.id, 'running').status, 'running');
  assert.equal(service.transitionExecution(malva.id, 'running'), null);
  assert.equal(service.transitionExecution(aqua.id, 'completed').status, 'completed');
  assert.equal(service.transitionExecution(malva.id, 'running').status, 'running');
  assert.equal(service.transitionExecution(malva.id, 'completed').status, 'completed');
  assert.equal(service.getTask(task.id).status, 'completed');
});

test('worker failures retry only within the configured attempt limit', t => {
  const { service, database } = fixture(t);
  const raw = database.raw;
  raw.prepare('UPDATE websites SET enabled = 0').run();
  raw.prepare("UPDATE websites SET enabled = 1, integration_status = 'verified' WHERE id = 'aqua'").run();
  service.updateSettings({ retryLimit: 1 });
  const task = service.createSearch({ parameters: validParameters }).task;
  const executionId = task.executions[0].id;

  assert.equal(service.transitionExecution(executionId, 'queued').status, 'queued');
  assert.equal(service.transitionExecution(executionId, 'running').attempts, 1);
  assert.equal(service.transitionExecution(executionId, 'failed', 'supplier_timeout').status, 'failed');
  assert.equal(service.getTask(task.id).status, 'failed');
  assert.equal(service.transitionExecution(executionId, 'queued').status, 'queued');
  assert.equal(service.getTask(task.id).status, 'queued');
  assert.equal(service.transitionExecution(executionId, 'running').attempts, 2);
  assert.equal(service.transitionExecution(executionId, 'failed', 'supplier_timeout').status, 'failed');
  assert.equal(service.transitionExecution(executionId, 'queued'), null);
});

test('Owner settings, task state and schema persist in a separate SQLite database', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'tezbooking-owner-persist-'));
  const file = path.join(directory, 'owner.sqlite');
  let database = open(file);
  let service = createOwnerService({ db: database, now: () => FIXED_NOW });
  const task = service.createSearch({ parameters: validParameters }).task;
  service.updateSettings({ retryLimit: 4, perOperatorConcurrency: 2 });
  database.close();

  database = open(file);
  service = createOwnerService({ db: database, now: () => FIXED_NOW });
  assert.equal(service.getTask(task.id).status, 'blocked');
  assert.equal(service.settings().retry_limit, 4);
  assert.equal(service.settings().per_operator_concurrency, 2);
  assert.equal(database.raw.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table' AND name IN ('bookings', 'agencies')").get().n, 0);
  database.close();
  fs.rmSync(directory, { recursive: true, force: true });
  t.after(() => { if (fs.existsSync(directory)) fs.rmSync(directory, { recursive: true, force: true }); });
});

test('offer normalization does not invent flight, baggage, dates, or cross-currency comparisons', () => {
  const base = {
    operatorName: 'Operator', sourceUrl: 'https://supplier.example/offer',
    hotelName: 'Example Hotel', totalPrice: 100, currency: 'USD',
    flightIncluded: true, directFlight: true, baggage: '20 kg',
    hotelIdentity: 'hotel-1', identityVerified: true
  };
  const offer = normalizeOffer(base, () => FIXED_NOW);
  assert.equal(offer.flightIncluded, null);
  assert.equal(offer.directFlight, null);
  assert.equal(offer.baggage, null);
  assert.equal(offer.checkIn, null);
  assert.throws(() => normalizeOffer({ ...base, checkIn: '2030-02-30' }, () => FIXED_NOW), /invalid travel dates/);
  const verified = normalizeOffer({
    ...base, baggageVerified: true, directFlightVerified: true, flightIncludedVerified: true
  }, () => FIXED_NOW);
  assert.equal(verified.baggage, '20 kg');
  assert.equal(verified.directFlight, true);
  assert.equal(verified.flightIncluded, true);

  const euro = normalizeOffer({ ...base, currency: 'EUR', totalPrice: 90 }, () => FIXED_NOW);
  const usd = normalizeOffer({ ...base, currency: 'USD', totalPrice: 100 }, () => FIXED_NOW);
  const groups = compareOffers([usd, euro]);
  assert.equal(groups.length, 2);
  assert.deepEqual(new Set(groups.map(group => group.currency)), new Set(['EUR', 'USD']));
});
