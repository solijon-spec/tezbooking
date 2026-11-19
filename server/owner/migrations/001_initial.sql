CREATE TABLE IF NOT EXISTS websites (
  id TEXT PRIMARY KEY,
  worker_id TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  url TEXT NOT NULL,
  login_url TEXT NOT NULL,
  search_url TEXT NOT NULL,
  website_type TEXT NOT NULL DEFAULT 'pending',
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  integration_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (integration_status IN ('pending', 'verified', 'failed')),
  auth_status TEXT NOT NULL DEFAULT 'not_configured'
    CHECK (auth_status IN ('not_configured', 'required', 'authenticated', 'manual_action')),
  worker_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (worker_status IN ('pending', 'idle', 'running', 'paused', 'failed')),
  custom_instructions TEXT NOT NULL DEFAULT '',
  field_mappings_json TEXT NOT NULL DEFAULT '{}',
  last_successful_login INTEGER,
  last_successful_search INTEGER,
  last_error TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS websites_enabled_status ON websites(enabled, integration_status);

CREATE TABLE IF NOT EXISTS search_tasks (
  id TEXT PRIMARY KEY,
  command TEXT NOT NULL,
  parameters_json TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('blocked', 'queued', 'running', 'completed', 'partial', 'failed', 'cancelled')),
  total_workers INTEGER NOT NULL DEFAULT 0,
  completed_workers INTEGER NOT NULL DEFAULT 0,
  failed_workers INTEGER NOT NULL DEFAULT 0,
  offers_found INTEGER NOT NULL DEFAULT 0,
  aggregation_status TEXT NOT NULL DEFAULT 'not_started',
  error_code TEXT,
  created_at INTEGER NOT NULL,
  started_at INTEGER,
  finished_at INTEGER
);
CREATE INDEX IF NOT EXISTS search_tasks_created ON search_tasks(created_at DESC);
CREATE INDEX IF NOT EXISTS search_tasks_status ON search_tasks(status);

CREATE TABLE IF NOT EXISTS worker_executions (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES search_tasks(id) ON DELETE CASCADE,
  website_id TEXT NOT NULL REFERENCES websites(id),
  worker_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('blocked', 'queued', 'running', 'completed', 'failed', 'cancelled')),
  attempts INTEGER NOT NULL DEFAULT 0,
  offers_found INTEGER NOT NULL DEFAULT 0,
  error_code TEXT,
  queued_at INTEGER NOT NULL,
  started_at INTEGER,
  finished_at INTEGER,
  UNIQUE(task_id, website_id)
);
CREATE INDEX IF NOT EXISTS worker_executions_task ON worker_executions(task_id, status);
CREATE INDEX IF NOT EXISTS worker_executions_status ON worker_executions(status);

CREATE TABLE IF NOT EXISTS hotel_offers (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES search_tasks(id) ON DELETE CASCADE,
  execution_id TEXT NOT NULL REFERENCES worker_executions(id) ON DELETE CASCADE,
  operator_name TEXT NOT NULL,
  source_url TEXT NOT NULL,
  hotel_name TEXT NOT NULL,
  hotel_identity TEXT,
  total_price REAL NOT NULL CHECK (total_price > 0),
  currency TEXT NOT NULL,
  availability TEXT NOT NULL,
  offer_json TEXT NOT NULL,
  verification_status TEXT NOT NULL DEFAULT 'unverified'
    CHECK (verification_status IN ('unverified', 'verified', 'expired')),
  retrieved_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS hotel_offers_task_price ON hotel_offers(task_id, total_price);
CREATE INDEX IF NOT EXISTS hotel_offers_identity ON hotel_offers(hotel_identity);

CREATE TABLE IF NOT EXISTS activities (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_type TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'info' CHECK (severity IN ('info', 'warning', 'error')),
  message TEXT NOT NULL,
  details_json TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS activities_created ON activities(created_at DESC);

CREATE TABLE IF NOT EXISTS system_alerts (
  id TEXT PRIMARY KEY,
  alert_type TEXT NOT NULL,
  severity TEXT NOT NULL CHECK (severity IN ('warning', 'error', 'critical')),
  message TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved')),
  created_at INTEGER NOT NULL,
  resolved_at INTEGER
);
CREATE INDEX IF NOT EXISTS system_alerts_status ON system_alerts(status, created_at DESC);

CREATE TABLE IF NOT EXISTS system_settings (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS owner_schema_migrations (
  version INTEGER PRIMARY KEY,
  applied_at INTEGER NOT NULL
);
