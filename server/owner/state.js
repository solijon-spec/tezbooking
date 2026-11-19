'use strict';

const TASK_TRANSITIONS = {
  blocked: new Set(['queued', 'cancelled']),
  queued: new Set(['running', 'blocked', 'failed', 'cancelled']),
  running: new Set(['completed', 'partial', 'failed', 'blocked', 'cancelled']),
  partial: new Set(['queued', 'cancelled']),
  completed: new Set(),
  failed: new Set(['queued', 'cancelled']),
  cancelled: new Set()
};

const EXECUTION_TRANSITIONS = {
  blocked: new Set(['queued', 'cancelled']),
  queued: new Set(['running', 'blocked', 'failed', 'cancelled']),
  running: new Set(['completed', 'failed', 'cancelled']),
  completed: new Set(),
  failed: new Set(['queued', 'cancelled']),
  cancelled: new Set()
};

function canTransition(map, from, to) {
  return !!map[from] && map[from].has(to);
}

module.exports = { TASK_TRANSITIONS, EXECUTION_TRANSITIONS, canTransition };
