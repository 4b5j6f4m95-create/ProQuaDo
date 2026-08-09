-- Shared rate-limit counters (docs/05 "Rate Limits & Größenlimits").
--
-- Until Phase 7 the limits were counted in process memory. On one instance
-- that is a real limit; behind N replicas it permits N× the configured rate,
-- which the notes called out as a genuine weakening rather than a rounding
-- error. This table is the shared store that removes it — Postgres rather
-- than Redis because ADR-007 keeps Redis out of the MVP and the database is
-- already here, already highly available, and already the thing an outage
-- would take down anyway.
--
-- No organization_id and no RLS, on purpose:
--
--   * A rate limit is a property of a caller, not of a tenant's data.
--   * It is consulted inside requireAuthContext — the function that
--     establishes the organization context. Requiring that context to read it
--     would be circular.
--   * `key` is a SHA-256 of "<category>:<subject id>", so the table is not a
--     cross-tenant list of who is currently active. The application only ever
--     looks up keys it computed itself, so hashing costs nothing.
CREATE TABLE rate_limit_windows (
  key       TEXT PRIMARY KEY,
  count     INTEGER     NOT NULL,
  reset_at  TIMESTAMPTZ NOT NULL
);

-- Supports the opportunistic sweep of expired windows.
CREATE INDEX rate_limit_windows_reset_at_idx ON rate_limit_windows (reset_at);

-- A counter that can go backwards is not a counter.
ALTER TABLE rate_limit_windows
  ADD CONSTRAINT rate_limit_windows_count_positive CHECK (count >= 1);

GRANT SELECT, INSERT, UPDATE, DELETE ON rate_limit_windows TO proquado_app;
