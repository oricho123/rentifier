-- Seed the mock source for development and testing
-- Created as disabled - tests can enable it if needed
INSERT INTO sources (name, enabled) VALUES ('mock', 0)
ON CONFLICT(name) DO NOTHING;
