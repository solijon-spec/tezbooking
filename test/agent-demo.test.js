const test = require('node:test');
const assert = require('node:assert/strict');
const { createAgentDemo } = require('../server/owner/demo-server');

test('local agent demo runs the real scheduler with a simulated worker and temporary owner database', async t => {
  const demo = createAgentDemo();
  t.after(() => demo.close());
  const address = await new Promise((resolve, reject) => {
    demo.server.once('error', reject);
    demo.server.listen(0, '127.0.0.1', () => resolve(demo.server.address()));
  });
  const base = `http://127.0.0.1:${address.port}`;

  const page = await fetch(base + '/owner-demo');
  assert.equal(page.status, 200);
  assert.match(await page.text(), /DEMO SIMULATION/);
  assert.equal((await fetch(base + '/api/owner/main-agent')).status, 401);

  const login = await fetch(base + '/api/owner/login', {
    method: 'POST',
    headers: { Origin: base, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: demo.email, password: demo.password })
  });
  assert.equal(login.status, 200);
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const authHeaders = { Cookie: cookie };
  const statusResponse = await fetch(base + '/api/owner/main-agent', { headers: authHeaders });
  assert.equal(statusResponse.status, 200);
  assert.equal((await statusResponse.json()).agentStatus.adaptersRegistered, 1);

  const date = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
  const submit = await fetch(base + '/api/owner/searches', {
    method: 'POST',
    headers: {
      ...authHeaders,
      Origin: base,
      'Content-Type': 'application/json',
      'Idempotency-Key': 'agent-demo-test-001'
    },
    body: JSON.stringify({
      command: 'Local simulated Antalya search',
      parameters: {
        destination: 'Antalya',
        country: 'tr',
        date,
        nights: 5,
        adults: 2,
        childrenAges: [],
        mealPlan: 'AI',
        budget: 2000,
        currency: 'USD'
      }
    })
  });
  assert.equal(submit.status, 201);
  const submitted = await submit.json();
  assert.equal(submitted.task.status, 'queued');

  const deadline = Date.now() + 4000;
  let task;
  while (Date.now() < deadline) {
    const response = await fetch(base + '/api/owner/searches/' + encodeURIComponent(submitted.task.id), {
      headers: authHeaders
    });
    task = (await response.json()).task;
    if (task.status === 'completed') break;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  assert.equal(task.status, 'completed');
  assert.equal(task.completedWorkers, 1);

  const result = await fetch(base + '/api/owner/searches/' + encodeURIComponent(task.id) + '/offers', {
    headers: authHeaders
  });
  const offers = await result.json();
  assert.equal(offers.offers.length, 1);
  assert.equal(offers.offers[0].verificationStatus, 'unverified');
  assert.match(offers.offers[0].sourceUrl, /\.invalid\//);
});
