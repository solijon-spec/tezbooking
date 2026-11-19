'use strict';

class QueueFullError extends Error {
  constructor() {
    super('live queue full');
    this.code = 'LIVE_QUEUE_FULL';
  }
}

function createConcurrencyLimiter({ globalLimit, perKeyLimit, maxQueue }) {
  const queue = [];
  const activeByKey = new Map();
  let active = 0;

  function pump() {
    while (active < globalLimit) {
      const index = queue.findIndex(job => (activeByKey.get(job.key) || 0) < perKeyLimit);
      if (index < 0) return;

      const job = queue.splice(index, 1)[0];
      active++;
      activeByKey.set(job.key, (activeByKey.get(job.key) || 0) + 1);
      Promise.resolve().then(job.work).then(job.resolve, job.reject).finally(() => {
        active--;
        const count = activeByKey.get(job.key) - 1;
        if (count) activeByKey.set(job.key, count);
        else activeByKey.delete(job.key);
        pump();
      });
    }
  }

  return {
    run(key, work) {
      if (queue.length >= maxQueue && (active >= globalLimit || (activeByKey.get(key) || 0) >= perKeyLimit)) {
        return Promise.reject(new QueueFullError());
      }
      return new Promise((resolve, reject) => {
        queue.push({ key, work, resolve, reject });
        pump();
      });
    },
    stats() {
      return { active, queued: queue.length };
    }
  };
}

function createRateLimiter({ perClientLimit, globalLimit, windowMs, maxClients, now = Date.now }) {
  const clients = new Map();
  let global = { start: 0, count: 0 };

  function current(bucket, time) {
    if (time - bucket.start >= windowMs || time < bucket.start) {
      bucket.start = time;
      bucket.count = 0;
    }
    return bucket;
  }

  return {
    check(client) {
      const time = now();
      global = current(global, time);
      let bucket = clients.get(client);
      if (!bucket) {
        if (clients.size >= maxClients) {
          for (const [key, value] of clients) {
            if (time - value.start >= windowMs) clients.delete(key);
          }
          if (clients.size >= maxClients) clients.delete(clients.keys().next().value);
        }
        bucket = { start: time, count: 0 };
        clients.set(client, bucket);
      } else {
        current(bucket, time);
      }

      if (global.count >= globalLimit) return Math.max(1, Math.ceil((windowMs - (time - global.start)) / 1000));
      if (bucket.count >= perClientLimit) return Math.max(1, Math.ceil((windowMs - (time - bucket.start)) / 1000));

      global.count++;
      bucket.count++;
      return 0;
    }
  };
}

module.exports = { createConcurrencyLimiter, createRateLimiter, QueueFullError };
