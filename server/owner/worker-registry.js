'use strict';

function createWorkerRegistry() {
  const adapters = new Map();

  function register(adapter) {
    if (!adapter || typeof adapter.operatorId !== 'string' || !/^[a-z0-9-]{1,80}$/i.test(adapter.operatorId)
      || typeof adapter.execute !== 'function'
      || (adapter.supports !== undefined && typeof adapter.supports !== 'function')) {
      throw new TypeError('worker adapter must define operatorId, execute, and optional supports');
    }
    if (adapters.has(adapter.operatorId)) throw new Error('worker adapter already registered');
    const registered = Object.freeze({
      operatorId: adapter.operatorId,
      workerType: typeof adapter.workerType === 'string' ? adapter.workerType.slice(0, 60) : 'custom',
      supports: adapter.supports || (() => true),
      execute: adapter.execute
    });
    adapters.set(registered.operatorId, registered);
    return () => adapters.delete(registered.operatorId);
  }

  function get(operatorId) {
    return adapters.get(operatorId) || null;
  }

  function select(websites, parameters) {
    return websites.filter(site => {
      const adapter = adapters.get(site.id);
      return !!adapter && site.enabled && site.integrationStatus === 'verified'
        && adapter.supports(parameters, site) === true;
    }).map(site => ({ site, adapter: adapters.get(site.id) }));
  }

  return { register, get, select, count: () => adapters.size };
}

module.exports = { createWorkerRegistry };
