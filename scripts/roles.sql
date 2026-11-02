-- Read-only role used by the MCP server (principle of least privilege).
-- Run this once in the Neon SQL Editor, as the database owner.
-- Replace CHANGE_ME with a long password (letters and numbers only).

CREATE ROLE agent_reader WITH LOGIN PASSWORD 'CHANGE_ME';

-- Allow connecting and reading, nothing else
GRANT CONNECT ON DATABASE neondb TO agent_reader;
GRANT USAGE ON SCHEMA public TO agent_reader;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO agent_reader;

-- Tables created in the future are readable too
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO agent_reader;

-- Database-enforced safety defaults for this role
ALTER ROLE agent_reader SET default_transaction_read_only = on;
ALTER ROLE agent_reader SET statement_timeout = '5s';

-- Audit log: a separate schema the agent cannot see
CREATE SCHEMA ops;

CREATE TABLE ops.audit_log (
  id BIGSERIAL PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  tool TEXT NOT NULL,
  sql_text TEXT,
  status TEXT NOT NULL,
  error_message TEXT,
  row_count INT,
  duration_ms INT
);

-- Logger role: can only insert audit rows, nothing else
CREATE ROLE agent_logger WITH LOGIN PASSWORD 'CHANGE_ME';
GRANT CONNECT ON DATABASE neondb TO agent_logger;
GRANT USAGE ON SCHEMA ops TO agent_logger;
GRANT INSERT ON ops.audit_log TO agent_logger;
GRANT USAGE ON SEQUENCE ops.audit_log_id_seq TO agent_logger;