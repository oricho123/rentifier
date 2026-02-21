-- Seed yad2 source
INSERT INTO sources (name, enabled) VALUES ('yad2', 1)
ON CONFLICT(name) DO NOTHING;
