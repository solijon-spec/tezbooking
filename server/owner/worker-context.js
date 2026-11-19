'use strict';

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.values(value).forEach(deepFreeze);
  return Object.freeze(value);
}

function createWorkerContext(source, signal, log = () => {}) {
  const task = structuredClone(source.task);
  const execution = structuredClone(source.execution);
  const website = structuredClone(source.website);
  return Object.freeze({
    task: deepFreeze(task),
    execution: deepFreeze(execution),
    website: deepFreeze(website),
    signal,
    log(eventType, details = {}) {
      if (typeof eventType !== 'string' || !/^[a-z0-9_-]{1,60}$/i.test(eventType)) return false;
      log(eventType, details && typeof details === 'object' && !Array.isArray(details) ? details : {});
      return true;
    }
  });
}

module.exports = { createWorkerContext };
