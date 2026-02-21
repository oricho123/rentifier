-- Seed the mock source for development and testing
INSERT INTO sources (name, enabled) VALUES ('mock', 1)
ON CONFLICT(name) DO NOTHING;
