PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  telegram_id INTEGER PRIMARY KEY,
  username TEXT,
  first_name TEXT,
  state TEXT NOT NULL DEFAULT 'idle',
  draft_json TEXT NOT NULL DEFAULT '{}',
  subscription_until INTEGER,
  subscription_charge_id TEXT,
  quota_used INTEGER NOT NULL DEFAULT 0,
  quota_reset_at INTEGER,
  free_used INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS payments (
  telegram_charge_id TEXT PRIMARY KEY,
  telegram_id INTEGER NOT NULL,
  invoice_payload TEXT NOT NULL,
  currency TEXT NOT NULL,
  amount INTEGER NOT NULL,
  is_recurring INTEGER NOT NULL DEFAULT 0,
  is_first_recurring INTEGER NOT NULL DEFAULT 0,
  subscription_until INTEGER,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (telegram_id) REFERENCES users(telegram_id)
);

CREATE INDEX IF NOT EXISTS idx_payments_user_created
  ON payments(telegram_id, created_at DESC);

CREATE TABLE IF NOT EXISTS generations (
  id TEXT PRIMARY KEY,
  telegram_id INTEGER NOT NULL,
  chat_id INTEGER NOT NULL,
  marketplace TEXT NOT NULL,
  style TEXT NOT NULL,
  title TEXT NOT NULL,
  features_json TEXT NOT NULL,
  source_file_id TEXT NOT NULL,
  source_mime_type TEXT,
  status TEXT NOT NULL,
  quota_kind TEXT NOT NULL,
  ai_used INTEGER NOT NULL DEFAULT 0,
  result_file_id TEXT,
  error_code TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (telegram_id) REFERENCES users(telegram_id)
);

CREATE INDEX IF NOT EXISTS idx_generations_user_created
  ON generations(telegram_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_generations_status
  ON generations(status, created_at);

CREATE TABLE IF NOT EXISTS processed_updates (
  update_id INTEGER PRIMARY KEY,
  processed_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_processed_updates_time
  ON processed_updates(processed_at);
