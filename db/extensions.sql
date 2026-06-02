-- Run once against the Neon database before the first migration.
-- Neon supports both extensions; enable them in the target branch.
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS vector;
