const test = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, rmSync } = require('node:fs');
const { join } = require('node:path');
const { tmpdir } = require('node:os');
const { open } = require('../server/owner/db');
const { createOwnerService } = require('../server/owner/service');
const { createMainAgent } = require('../server/owner/agent/main');
const { parseNaturalLanguage } = require('../server/owner/agent/parser');
const { createLlmParser } = require('../server/owner/agent/llm');
const { createWorkerRegistry } = require('../server/owner/worker-registry');
const { createWorkerContext } = require('../server/owner/worker-context');

function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'tezbooking-agent-'));
  const database = open(join(directory, 'owner.sqlite'));
  const service = createOwnerService({ db: database });
  t.after(() => {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  });
  return { database, service };
}

function completeCommand() {
  const date = new Date(Date.now() + 40 * 86400000).toISOString().slice(0, 10);
  return `Find 2 adults, 7 nights in Antalya, Turkey from ${date}, all inclusive with budget $1,200 USD`;
}

test('natural language parser extracts supported deterministic fields', () => {
  const parsed = parseNaturalLanguage(completeCommand());
  assert.equal(parsed.parameters.destination, 'Antalya');
  assert.equal(parsed.parameters.country, 'tr');
  assert.equal(parsed.parameters.adults, 2);
  assert.equal(parsed.parameters.nights, 7);
  assert.equal(parsed.parameters.mealPlan, 'AI');
  assert.equal(parsed.parameters.budget, 1200);
  assert.equal(parsed.parameters.currency, 'USD');
});

test('Main Agent asks for missing dates, nights, and child ages without creating a task', async t => {
  const { database, service } = fixture(t);
  const agent = createMainAgent({
    service,
    workers: createWorkerRegistry(),
    scheduler: { wake() {} },
    llmParser: createLlmParser({ enabled: false })
  });

  const result = await agent.search('Find 2 adults and 1 child in Antalya, Turkey');
  assert.equal(result.status, 'needs_clarification');
  assert.ok(result.missing.includes('date'));
  assert.ok(result.missing.includes('nights'));
  assert.ok(result.missing.includes('childrenAges'));
  assert.equal(database.raw.prepare('SELECT COUNT(*) AS count FROM search_tasks').get().count, 0);
});

test('Main Agent validates, persists, and idempotently returns a blocked task without verified adapters', async t => {
  const { database, service } = fixture(t);
  const agent = createMainAgent({
    service,
    workers: createWorkerRegistry(),
    scheduler: { wake() {} },
    llmParser: createLlmParser({ enabled: false })
  });
  const command = completeCommand();
  const first = await agent.search(command, 'natural-search-001');
  const repeated = await agent.search(command, 'natural-search-001');

  assert.equal(first.status, 'task_created');
  assert.equal(first.task.status, 'blocked');
  assert.equal(first.task.totalWorkers, 0);
  assert.equal(first.task.parameters.budget, 1200);
  assert.equal(repeated.task.id, first.task.id);
  assert.equal(repeated.duplicate, true);
  assert.equal(database.raw.prepare('SELECT COUNT(*) AS count FROM search_tasks').get().count, 1);
});

test('Main Agent returns a conflict when an idempotency key is reused for different content', async t => {
  const { service } = fixture(t);
  const agent = createMainAgent({
    service,
    workers: createWorkerRegistry(),
    scheduler: { wake() {} },
    llmParser: createLlmParser({ enabled: false })
  });
  await agent.search(completeCommand(), 'natural-search-002');
  const conflict = await agent.search(completeCommand().replace('1,200', '1,300'), 'natural-search-002');
  assert.equal(conflict.error, 'idempotency_conflict');
});

test('Main Agent falls back to deterministic parsing when the optional LLM key is absent', async t => {
  const { service } = fixture(t);
  const llmParser = createLlmParser({ enabled: true, provider: 'anthropic', apiKey: '' });
  const agent = createMainAgent({
    service,
    workers: createWorkerRegistry(),
    scheduler: { wake() {} },
    llmParser
  });
  const result = await agent.search(completeCommand());
  assert.equal(result.status, 'task_created');
  assert.equal(result.parserMode, 'deterministic');
  assert.equal(agent.status().llmEnabled, false);
  assert.equal(agent.status().llmConfigurationError, 'llm_key_missing');
});

test('Main Agent requests a corrected date instead of persisting an invalid date', async t => {
  const { service, database } = fixture(t);
  const agent = createMainAgent({
    service,
    workers: createWorkerRegistry(),
    scheduler: { wake() {} },
    llmParser: createLlmParser({ enabled: false })
  });
  const result = await agent.search('Find 2 adults, 7 nights in Antalya, Turkey from 2030-02-31');
  assert.equal(result.status, 'needs_clarification');
  assert.ok(result.missing.includes('date'));
  assert.equal(database.raw.prepare('SELECT COUNT(*) AS count FROM search_tasks').get().count, 0);
});

test('LLM parsing uses the configured provider response without an external request', async () => {
  const command = completeCommand();
  const parameters = parseNaturalLanguage(command).parameters;
  const parser = createLlmParser({
    enabled: true,
    provider: 'openai',
    apiKey: 'test-key',
    fetchImpl: async (url, options) => {
      assert.equal(url, 'https://api.openai.com/v1/chat/completions');
      assert.equal(options.headers.Authorization, 'Bearer test-key');
      return {
        ok: true,
        json: async () => ({
          choices: [{ message: { content: JSON.stringify(parameters) } }]
        })
      };
    }
  });
  const result = await parser.parse(command);
  assert.equal(result.destination, parameters.destination);
});

test('registry dispatches only enabled, compatible, verified operators', () => {
  const registry = createWorkerRegistry();
  const adapter = { operatorId: 'aqua', supports: parameters => parameters.country === 'tr', execute: async () => ({ offers: [] }) };
  registry.register(adapter);
  registry.register({ operatorId: 'malva', supports: () => true, execute: adapter.execute });
  const parameters = { country: 'tr' };
  const selected = registry.select([
    { id: 'aqua', enabled: true, integrationStatus: 'verified' },
    { id: 'malva', enabled: true, integrationStatus: 'pending' },
    { id: 'disabled', enabled: false, integrationStatus: 'verified' }
  ], parameters);
  assert.deepEqual(selected.map(item => item.site.id), ['aqua']);
  assert.throws(() => registry.register(adapter), /already registered/);
});

test('worker contexts are isolated, immutable, and provide cancellation only', () => {
  const controller = new AbortController();
  const context = createWorkerContext({
    task: { id: 'task-1', parameters: { destination: 'Antalya', nested: { adults: 2 } } },
    execution: { id: 'execution-1', attempts: 1 },
    website: { id: 'aqua' }
  }, controller.signal);
  assert.equal(context.task.parameters.destination, 'Antalya');
  assert.equal(Object.isFrozen(context.task.parameters.nested), true);
  assert.equal('database' in context, false);
  assert.equal('credentials' in context, false);
  assert.equal(context.signal, controller.signal);
  assert.equal(Reflect.set(context.task.parameters.nested, 'adults', 3), false);
});
