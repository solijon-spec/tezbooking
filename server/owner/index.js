'use strict';

const { createRateLimiter } = require('../live/limits');

const PREFIX = '/api/owner';

function sameOrigin(req) {
  const origin = req.headers.origin;
  const host = String(req.headers.host || '').toLowerCase();
  if (!origin || !host) return false;
  try {
    const url = new URL(origin);
    return ['http:', 'https:'].includes(url.protocol) && url.host.toLowerCase() === host;
  } catch (error) { return false; }
}

function createOwnerApi({ service, auth, sendJson, readBody, clientIp, agent = null, scheduler = null, now = Date.now }) {
  const loginLimiter = createRateLimiter({
    perClientLimit: 5, globalLimit: 100, windowMs: 60000, maxClients: 10000, now
  });
  const streams = new Set();

  function jsonResponse(res, status, value) {
    return sendJson(res, status, value);
  }

  async function bodyOf(req) {
    if (!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] || '')) return null;
    try {
      const body = JSON.parse(await readBody(req));
      return body && typeof body === 'object' && !Array.isArray(body) ? body : null;
    } catch (error) { return null; }
  }

  function requireOrigin(req, res) {
    if (sameOrigin(req)) return true;
    jsonResponse(res, 403, { error: 'origin_rejected' });
    return false;
  }

  function startStream(req, res) {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
      'X-Content-Type-Options': 'nosniff'
    });
    res.write(': connected\n\n');
    const stream = { req, res };
    streams.add(stream);
    const heartbeat = setInterval(() => {
      if (!auth.ownerOf(req)) {
        res.end();
        return;
      }
      if (!res.write(': heartbeat\n\n')) return;
    }, 20000);
    heartbeat.unref();
    res.on('close', () => {
      clearInterval(heartbeat);
      streams.delete(stream);
    });
  }

  function broadcast(event) {
    const payload = JSON.stringify({ type: event.type || 'update', at: now() });
    streams.forEach(stream => {
      if (!auth.ownerOf(stream.req)) {
        stream.res.end();
        return;
      }
      stream.res.write('event: update\ndata: ' + payload + '\n\n');
    });
  }

  async function handle(req, res, pathname, url) {
    const route = pathname.slice(PREFIX.length) || '/';
    const method = req.method;

    if (route === '/login') {
      if (method !== 'POST') return jsonResponse(res, 405, { error: 'method_not_allowed' });
      if (!requireOrigin(req, res)) return;
      const retryAfter = loginLimiter.check(String(clientIp(req) || 'unknown'));
      if (retryAfter) {
        res.setHeader('Retry-After', String(retryAfter));
        return jsonResponse(res, 429, { error: 'rate_limited' });
      }
      const body = await bodyOf(req);
      const session = body && auth.login(body.email, body.password);
      if (!session) return jsonResponse(res, auth.enabled ? 401 : 503, { error: auth.enabled ? 'bad_credentials' : 'owner_auth_not_configured' });
      res.setHeader('Set-Cookie', session.cookie);
      return jsonResponse(res, 200, { authenticated: true, owner: session.owner });
    }

    if (route === '/logout') {
      if (method !== 'POST') return jsonResponse(res, 405, { error: 'method_not_allowed' });
      if (!requireOrigin(req, res)) return;
      res.setHeader('Set-Cookie', auth.logout(req));
      return jsonResponse(res, 200, { authenticated: false });
    }

    if (route === '/me') {
      if (method !== 'GET') return jsonResponse(res, 405, { error: 'method_not_allowed' });
      const owner = auth.ownerOf(req);
      return jsonResponse(res, 200, owner ? { authenticated: true, owner } : { authenticated: false });
    }

    const owner = auth.ownerOf(req);
    if (!owner) return jsonResponse(res, 401, { error: 'owner_auth_required' });

    if (route === '/events') {
      if (method !== 'GET') return jsonResponse(res, 405, { error: 'method_not_allowed' });
      return startStream(req, res);
    }
    if (method === 'GET') {
      if (route === '/overview') return jsonResponse(res, 200, service.overview());
      if (route === '/main-agent') return jsonResponse(res, 200, {
        ...service.mainAgent(),
        agentStatus: agent ? agent.status() : { parser: 'not_configured', llmEnabled: false, adaptersRegistered: 0 }
      });
      if (route === '/websites') return jsonResponse(res, 200, { websites: service.listWebsites() });
      if (route === '/searches') return jsonResponse(res, 200, { tasks: service.listTasks(url.searchParams.get('limit')) });
      if (route === '/activities') return jsonResponse(res, 200, { activities: service.listActivities(url.searchParams.get('limit')) });
      if (route === '/alerts') return jsonResponse(res, 200, { alerts: service.listAlerts(url.searchParams.get('limit')) });
      if (route === '/logs') return jsonResponse(res, 200, { logs: service.listLogs(url.searchParams.get('limit')) });
      if (route === '/settings') return jsonResponse(res, 200, { settings: service.settings() });

      let match = route.match(/^\/searches\/([a-f0-9-]+)$/i);
      if (match) {
        const task = service.getTask(match[1]);
        return task ? jsonResponse(res, 200, { task }) : jsonResponse(res, 404, { error: 'not_found' });
      }
      match = route.match(/^\/searches\/([a-f0-9-]+)\/offers$/i);
      if (match) {
        const offers = service.listOffers(match[1]);
        return offers ? jsonResponse(res, 200, { offers, comparison: service.compareOffers(offers) }) : jsonResponse(res, 404, { error: 'not_found' });
      }
      return jsonResponse(res, 404, { error: 'not_found' });
    }

    if (method !== 'POST' && method !== 'PATCH') {
      res.setHeader('Allow', 'GET, POST, PATCH');
      return jsonResponse(res, 405, { error: 'method_not_allowed' });
    }
    if (!requireOrigin(req, res)) return;
    const body = await bodyOf(req);
    if (!body) return jsonResponse(res, 400, { error: 'bad_request' });

    if (route === '/websites' && method === 'POST') {
      const result = service.createWebsite(body);
      return result.error ? jsonResponse(res, 400, result) : jsonResponse(res, 201, result);
    }
    let match = route.match(/^\/websites\/([a-f0-9-]+)$/i);
    if (match && method === 'PATCH') {
      const website = service.updateWebsite(match[1], body);
      return website === null ? jsonResponse(res, 404, { error: 'not_found' })
        : website ? jsonResponse(res, 200, { website }) : jsonResponse(res, 400, { error: 'bad_website' });
    }
    if (route === '/searches' && method === 'POST') {
      const result = agent
        ? agent.createSearch(body.parameters, body.command, req.headers['idempotency-key'] || body.idempotencyKey)
        : service.createSearch(body);
      if (result.error) {
        return jsonResponse(res, result.error === 'idempotency_conflict' ? 409 : 400, result);
      }
      return jsonResponse(res, result.duplicate ? 200 : 201, result);
    }
    match = route.match(/^\/searches\/([a-f0-9-]+)\/cancel$/i);
    if (match && method === 'POST') {
      const task = scheduler ? scheduler.cancelTask(match[1]) : service.cancelTask(match[1]);
      return task ? jsonResponse(res, 200, { task }) : jsonResponse(res, 409, { error: 'invalid_task_transition' });
    }
    match = route.match(/^\/alerts\/([a-f0-9-]+)\/resolve$/i);
    if (match && method === 'POST') {
      return service.resolveAlert(match[1]) ? jsonResponse(res, 200, { ok: true }) : jsonResponse(res, 404, { error: 'not_found' });
    }
    if (route === '/settings' && method === 'POST') {
      const settings = service.updateSettings(body);
      return settings ? jsonResponse(res, 200, { settings }) : jsonResponse(res, 400, { error: 'bad_settings' });
    }
    if (route === '/agent/searches' && method === 'POST') {
      if (!agent) return jsonResponse(res, 503, { error: 'agent_not_configured' });
      const result = await agent.search(body.command, req.headers['idempotency-key'] || body.idempotencyKey);
      if (result.error) {
        const status = ['llm_provider_error', 'llm_timeout', 'llm_invalid_response'].includes(result.error) ? 502
          : result.error.startsWith('llm_') ? 503
            : result.error === 'idempotency_conflict' ? 409 : 400;
        return jsonResponse(res, status, { error: result.error });
      }
      return jsonResponse(res, result.status === 'needs_clarification' ? 200 : result.duplicate ? 200 : 201, result);
    }
    return jsonResponse(res, 404, { error: 'not_found' });
  }

  return {
    handle,
    emit: broadcast,
    close() {
      streams.forEach(stream => stream.res.end());
      streams.clear();
    }
  };
}

module.exports = { createOwnerApi, sameOrigin };
