const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { requestOnce } = require('../server/live/safe-http');

// Regressiya: Node'ning umumiy keep-alive agenti ulanishga 5 soniyalik timeout qo'yardi va
// 5 soniyadan sekin javob beradigan operatorlar LIVE_TIMEOUT_MS (25 s) o'rniga 5 soniyada uzilardi.
test('a supplier answering after more than 5 seconds is not cut off before the configured timeout', async t => {
  const server = http.createServer((req, res) => setTimeout(() => res.end('slow-ok'), 5500));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const url = new URL(`http://slow.test:${server.address().port}/search_tour`);
  const response = await requestOnce(url, {
    headers: {}, addresses: [{ address: '127.0.0.1', family: 4 }], timeoutMs: 9000, maxResponseBytes: 1024
  });
  assert.equal(response.status, 200);
  assert.equal(await response.text(), 'slow-ok');
});

test('the configured supplier timeout still applies', async t => {
  const server = http.createServer(() => { /* hech qachon javob bermaydi */ });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const url = new URL(`http://slow.test:${server.address().port}/search_tour`);
  await assert.rejects(
    requestOnce(url, { headers: {}, addresses: [{ address: '127.0.0.1', family: 4 }], timeoutMs: 300, maxResponseBytes: 1024 }),
    error => error.code === 'ETIMEDOUT'
  );
});
