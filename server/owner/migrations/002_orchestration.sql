ALTER TABLE search_tasks ADD COLUMN idempotency_key TEXT;
ALTER TABLE search_tasks ADD COLUMN request_hash TEXT;
CREATE UNIQUE INDEX search_tasks_idempotency ON search_tasks(idempotency_key) WHERE idempotency_key IS NOT NULL;

ALTER TABLE worker_executions ADD COLUMN idempotency_key TEXT;
ALTER TABLE worker_executions ADD COLUMN lease_until INTEGER;
ALTER TABLE worker_executions ADD COLUMN heartbeat_at INTEGER;
CREATE UNIQUE INDEX worker_executions_idempotency ON worker_executions(idempotency_key) WHERE idempotency_key IS NOT NULL;

ALTER TABLE hotel_offers ADD COLUMN dedupe_key TEXT;
CREATE UNIQUE INDEX hotel_offers_execution_dedupe ON hotel_offers(execution_id, dedupe_key) WHERE dedupe_key IS NOT NULL;

CREATE TABLE worker_execution_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  execution_id TEXT NOT NULL REFERENCES worker_executions(id) ON DELETE CASCADE,
  task_id TEXT NOT NULL REFERENCES search_tasks(id) ON DELETE CASCADE,
  attempt INTEGER NOT NULL DEFAULT 0,
  event_type TEXT NOT NULL,
  error_code TEXT,
  message TEXT NOT NULL,
  details_json TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL
);
CREATE INDEX worker_execution_events_created ON worker_execution_events(created_at DESC);
CREATE INDEX worker_execution_events_execution ON worker_execution_events(execution_id, created_at DESC);
