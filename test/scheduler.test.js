const test = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, rmSync } = require('node:fs');
const { join } = require('node:path');
const { tmpdir } = require('node:os');
const { open } = require('../server/owner/db');
const { createOwnerService } = require('../server/owner/service');
const { createWorkerRegistry } = require('../server/owner/worker-registry');
const { createScheduler } = require('../server/owner/scheduler');
const { normalizeOffer } = require('../server/owner/normalize');

function futureDate() {
  return new Date(Date.now() + 40 * 86400000).toISOString().slice(0, 10);
}

function parameters(destination) {
  return {
    destination,
    country: 'tr',
    date: futureDate(),
    nights: 7,
    adults: 2,
    childrenAges: [],
    mealPlan: null,
    budget: null,
    currency: 'USD',
    departureAirport: null
  };
}

function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'tezbooking-scheduler-'));
  let database = open(join(directory, 'owner.sqlite'));
  let service = createOwnerService({ db: database });
  let scheduler = null;
  t.after(() => {
    if (scheduler) scheduler.close();
    database.close();
    rmSync(directory, { recursive: true, force: true });
  });
  return {
    directory,
    get database() { return database; },
    get service() { return service; },
    reopen() {
      database.close();
      database = open(join(directory, 'owner.sqlite'));
      service = createOwnerService({ db: database });
      return { database, service };
    },
    createScheduler(workers, options) {
      scheduler = createScheduler({ service, workers, ...options });
      return scheduler;
    }
  };
}

function enableSites(database, ids) {
  database.raw.prepare("UPDATE websites SET enabled = 0").run();
  for (const id of ids) {
    database.raw.prepare("UPDATE websites SET enabled = 1, integration_status = 'verified' WHERE id = ?").run(id);
  }
}

async function waitFor(predicate, timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 15));
  }
  assert.fail('Timed out waiting for scheduler state');
}

test('normalizer rejects malformed offers and constrains accepted values', () => {
  const normalized = normalizeOffer({
    operatorName: 'Aqua',
    hotelName: 'Example Resort',
    totalPrice: 1200,
    currency: 'USD',
    directFlight: true,
    baggage: '20kg',
    sourceUrl: 'https://supplier.example/offers/1'
  });
  assert.equal(normalized.directFlight, null);
  assert.equal(normalized.baggage, null);
  assert.equal(normalized.verificationStatus, 'unverified');
  assert.throws(() => normalizeOffer({ hotelName: 'Missing required data' }), /missing valid source/);
});

test('scheduler completes local adapter work and persists normalized offers', async t => {
  const f = fixture(t);
  enableSites(f.database, ['aqua']);
  const registry = createWorkerRegistry();
  registry.register({
    operatorId: 'aqua',
    supports: () => true,
    async execute(context) {
      assert.equal(Object.isFrozen(context.task.parameters), true);
      return {
        offers: [{
          hotelName: 'Fixture Resort',
          totalPrice: 1400,
          currency: 'USD',
          mealPlan: 'all inclusive',
          sourceUrl: 'https://supplier.example/fixture'
        }]
      };
    }
  });
  const task = f.service.createSearch({ command: 'Antalya fixture', parameters: parameters('Antalya') }, ['aqua']).task;
  const scheduler = f.createScheduler(registry, { pollMs: 10 });
  scheduler.start();
  await waitFor(() => f.service.getTask(task.id).status === 'completed');
  const offers = f.service.listOffers(task.id);
  assert.equal(offers.length, 1);
  assert.equal(offers[0].offer.hotelName, 'Fixture Resort');
  assert.equal(offers[0].offer.directFlight, null);
  assert.equal(offers[0].offer.baggage, null);
  assert.equal(f.service.getTask(task.id).progressPercent, 100);
});

test('scheduler enforces global concurrency and aggregates partial results', async t => {
  const f = fixture(t);
  enableSites(f.database, ['aqua', 'malva']);
  const registry = createWorkerRegistry();
  let active = 0;
  let maximumActive = 0;
  registry.register({
    operatorId: 'aqua',
    supports: () => true,
    async execute() {
      active++;
      maximumActive = Math.max(maximumActive, active);
      await new Promise(resolve => setTimeout(resolve, 80));
      active--;
      return { offers: [{
        hotelName: 'Aqua Fixture',
        totalPrice: 1000,
        currency: 'USD',
        sourceUrl: 'https://supplier.example/aqua-fixture'
      }] };
    }
  });
  registry.register({
    operatorId: 'malva',
    supports: () => true,
    async execute() {
      active++;
      maximumActive = Math.max(maximumActive, active);
      await new Promise(resolve => setTimeout(resolve, 50));
      active--;
      throw Object.assign(new Error('simulated fixture failure'), { code: 'fixture_failure' });
    }
  });
  f.service.updateSettings({ workerConcurrency: 1, retryLimit: 0 });
  const task = f.service.createSearch({ command: 'Bodrum fixture', parameters: parameters('Bodrum') }, ['aqua', 'malva']).task;
  const scheduler = f.createScheduler(registry, { pollMs: 10 });
  scheduler.start();
  await waitFor(() => f.service.getTask(task.id).status === 'partial');
  assert.equal(maximumActive, 1);
  assert.equal(f.service.getTask(task.id).completedWorkers, 1);
  assert.equal(f.service.getTask(task.id).failedWorkers, 1);
  assert.equal(f.service.listOffers(task.id).length, 1);
});

test('scheduler enforces per-operator concurrency across separate tasks', async t => {
  const f = fixture(t);
  enableSites(f.database, ['aqua']);
  f.service.updateSettings({ workerConcurrency: 2, perOperatorConcurrency: 1 });
  let active = 0;
  let maximumActive = 0;
  const workers = createWorkerRegistry();
  workers.register({
    operatorId: 'aqua',
    async execute() {
      active++;
      maximumActive = Math.max(maximumActive, active);
      await new Promise(resolve => setTimeout(resolve, 60));
      active--;
      return { offers: [] };
    }
  });
  const first = f.service.createSearch(
    { command: 'Antalya first', parameters: parameters('Antalya') }, ['aqua']
  ).task;
  const second = f.service.createSearch(
    { command: 'Antalya second', parameters: parameters('Antalya') }, ['aqua']
  ).task;
  const scheduler = f.createScheduler(workers, { pollMs: 10 });
  scheduler.start();
  await waitFor(() => f.service.getTask(first.id).status === 'completed'
    && f.service.getTask(second.id).status === 'completed');
  assert.equal(maximumActive, 1);
});

test('scheduler retries a timed-out execution within the configured retry bound', async t => {
  const f = fixture(t);
  enableSites(f.database, ['aqua']);
  const registry = createWorkerRegistry();
  let attempts = 0;
  registry.register({
    operatorId: 'aqua',
    supports: () => true,
    execute(context) {
      attempts++;
      if (attempts === 1) {
        return new Promise((resolve, reject) => {
          context.signal.addEventListener('abort', () => reject(new Error('aborted by timeout')), { once: true });
        });
      }
      return Promise.resolve({ offers: [] });
    }
  });
  f.service.updateSettings({ searchTimeoutSeconds: 5, retryLimit: 1 });
  const task = f.service.createSearch({ command: 'Antalya timeout fixture', parameters: parameters('Antalya') }, ['aqua']).task;
  const scheduler = f.createScheduler(registry, { timeoutMs: 25, pollMs: 10 });
  scheduler.start();
  await waitFor(() => f.service.getTask(task.id).status === 'completed');
  assert.equal(attempts, 2);
  assert.equal(f.service.listLogs({ taskId: task.id }).some(log => log.errorCode === 'worker_timeout'), true);
});

test('cancellation stops a running worker and persists the cancelled state', async t => {
  const f = fixture(t);
  enableSites(f.database, ['aqua']);
  const registry = createWorkerRegistry();
  registry.register({
    operatorId: 'aqua',
    supports: () => true,
    execute(context) {
      return new Promise((resolve, reject) => {
        context.signal.addEventListener('abort', () => reject(new Error('cancelled')), { once: true });
      });
    }
  });
  const task = f.service.createSearch({ command: 'Antalya cancellation fixture', parameters: parameters('Antalya') }, ['aqua']).task;
  const scheduler = f.createScheduler(registry, { pollMs: 10 });
  scheduler.start();
  await waitFor(() => scheduler.activeCount === 1);
  const cancelled = scheduler.cancelTask(task.id);
  assert.equal(cancelled.status, 'cancelled');
  await waitFor(() => scheduler.activeCount === 0);
  assert.equal(f.service.getTask(task.id).status, 'cancelled');
});

test('startup recovery requeues an interrupted execution and finishes it', async t => {
  const f = fixture(t);
  enableSites(f.database, ['aqua']);
  const task = f.service.createSearch({ command: 'Antalya recovery fixture', parameters: parameters('Antalya') }, ['aqua']).task;
  const executionId = f.service.listQueuedExecutions(1)[0];
  assert.ok(f.service.claimExecution(executionId));
  assert.equal(f.service.getTask(task.id).status, 'running');

  f.reopen();
  assert.equal(f.service.recoverInterruptedExecutions(), 1);
  assert.equal(f.service.getTask(task.id).status, 'queued');
  const registry = createWorkerRegistry();
  registry.register({ operatorId: 'aqua', supports: () => true, execute: async () => ({ offers: [] }) });
  const scheduler = f.createScheduler(registry, { pollMs: 10 });
  scheduler.start();
  await waitFor(() => f.service.getTask(task.id).status === 'completed');
  assert.equal(f.service.getTask(task.id).completedWorkers, 1);
});
