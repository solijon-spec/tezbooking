'use strict';

const { createWorkerContext } = require('./worker-context');

function safeErrorCode(error) {
  const value = error && error.code;
  return typeof value === 'string' && /^[a-z0-9_-]{1,80}$/i.test(value) ? value : 'worker_error';
}

function createScheduler({ service, workers, pollMs = 500, timeoutMs = null }) {
  const active = new Map();
  let interval = null;
  let closed = true;
  let pumping = false;
  let wakeQueued = false;

  function release(executionId, entry) {
    if (active.get(executionId) !== entry) return;
    active.delete(executionId);
    if (!closed) wake();
  }

  function runClaimed(executionId, adapter, context, entry) {
    const settings = service.settings();
    const timeout = Number.isInteger(timeoutMs) ? timeoutMs : settings.search_timeout_seconds * 1000;
    let timer;
    let timeoutResolve;
    const timeoutPromise = new Promise(resolve => { timeoutResolve = resolve; });
    const workerContext = createWorkerContext(context, entry.controller.signal, (eventType, details) => {
      service.logWorkerEvent(executionId, eventType, details);
    });
    const work = Promise.resolve().then(() => adapter.execute(workerContext));
    entry.work = work;
    work.then(() => release(executionId, entry), () => release(executionId, entry));

    timer = setTimeout(() => {
      entry.timedOut = true;
      entry.controller.abort();
      timeoutResolve({ kind: 'timeout' });
    }, Math.max(1, timeout));
    entry.timer = timer;

    Promise.race([
      work.then(value => ({ kind: 'result', value }), error => ({ kind: 'error', error })),
      timeoutPromise
    ]).then(result => {
      if (closed) return;
      if (result.kind === 'timeout') {
        service.failExecution(executionId, 'worker_timeout', true);
        return;
      }
      if (result.kind === 'error') {
        service.failExecution(executionId,
          entry.timedOut ? 'worker_timeout' : entry.controller.signal.aborted ? 'worker_aborted' : safeErrorCode(result.error), true);
        return;
      }
      const offers = Array.isArray(result.value) ? result.value : result.value && result.value.offers;
      if (!Array.isArray(offers)) {
        service.failExecution(executionId, 'invalid_worker_result', false);
        return;
      }
      const completed = service.completeExecution(executionId, offers);
      if (completed && completed.error) service.failExecution(executionId, completed.error, false);
    }).catch(() => {
      if (!closed) service.failExecution(executionId, 'scheduler_error', false);
    }).finally(() => {
      clearTimeout(timer);
      if (!entry.timedOut || !entry.work) release(executionId, entry);
      if (!closed) wake();
    });
  }

  function pump() {
    if (closed || pumping) return;
    pumping = true;
    try {
      const limit = service.settings().worker_concurrency;
      while (active.size < limit) {
        const queued = service.listQueuedExecutions(500);
        let started = false;
        for (const id of queued) {
          if (active.has(id)) continue;
          const context = service.executionContext(id);
          if (!context) continue;
          const adapter = workers.get(context.website.id);
          let compatible = false;
          try {
            compatible = !!adapter && context.website.enabled && context.website.integrationStatus === 'verified'
              && adapter.supports(context.task.parameters, context.website) === true;
          } catch (error) {
            service.blockExecution(id, 'adapter_selection_error');
            continue;
          }
          if (!compatible) {
            service.blockExecution(id, 'adapter_unavailable');
            continue;
          }
          const claimed = service.claimExecution(id);
          if (!claimed) continue;
          const entry = { taskId: claimed.task.id, controller: new AbortController(), timedOut: false, timer: null, work: null };
          active.set(id, entry);
          runClaimed(id, adapter, claimed, entry);
          started = true;
          break;
        }
        if (!started) break;
      }
    } finally {
      pumping = false;
      if (wakeQueued) {
        wakeQueued = false;
        wake();
      }
    }
  }

  function wake() {
    if (closed) return;
    if (pumping) { wakeQueued = true; return; }
    setImmediate(pump);
  }

  function start() {
    if (!closed) return;
    closed = false;
    service.recoverInterruptedExecutions();
    interval = setInterval(wake, Math.max(50, pollMs));
    interval.unref();
    wake();
  }

  function cancelTask(taskId) {
    const task = service.cancelTask(taskId);
    if (!task) return null;
    active.forEach(entry => {
      if (entry.taskId === taskId) entry.controller.abort();
    });
    wake();
    return task;
  }

  function close() {
    if (closed) return;
    closed = true;
    clearInterval(interval);
    interval = null;
    active.forEach(entry => entry.controller.abort());
  }

  return {
    start,
    wake,
    cancelTask,
    close,
    get activeCount() { return active.size; },
    get isRunning() { return !closed; }
  };
}

module.exports = { createScheduler, safeErrorCode };
