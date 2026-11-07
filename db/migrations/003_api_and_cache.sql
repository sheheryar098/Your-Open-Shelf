-- api-design: idempotency keys are matched against the request they were first used for.
ALTER TABLE exchanges ADD COLUMN request_fingerprint text;
UPDATE exchanges e SET request_fingerprint = 'legacy:' || e.id;
ALTER TABLE exchanges ALTER COLUMN request_fingerprint SET NOT NULL;

-- Cursor pagination for the catalog uses (published_at, id).
CREATE INDEX listings_browse ON listings (published_at DESC, id DESC) WHERE status IN ('active', 'reserved');

-- caching: cache-aside store for slow or rate-limited upstreams (e.g. ISBN metadata).
-- Keys are versioned ("isbn:v1:…"); every row has a TTL; misses are cached briefly (negative caching).
CREATE TABLE cache_entries (
  key         text PRIMARY KEY,
  value       jsonb,                -- NULL = cached "not found"
  expires_at  timestamptz NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX cache_entries_expiry ON cache_entries (expires_at);

CREATE TABLE cache_metrics (
  name    text PRIMARY KEY,
  hits    bigint NOT NULL DEFAULT 0,
  misses  bigint NOT NULL DEFAULT 0,
  errors  bigint NOT NULL DEFAULT 0
);
