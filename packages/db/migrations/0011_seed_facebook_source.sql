-- Seed Facebook as a listing source
INSERT OR IGNORE INTO sources (name, enabled) VALUES ('facebook', 1);

INSERT OR IGNORE INTO source_state (source_id, cursor, last_run_at, last_status, last_error)
  SELECT id, NULL, NULL, NULL, NULL FROM sources WHERE name = 'facebook';
