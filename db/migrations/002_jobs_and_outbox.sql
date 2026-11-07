-- Job run records, a dead-letter table for poison items, and an email outbox with
-- priority lanes, exponential backoff and a terminal "dead" state.

DROP TABLE job_runs;
CREATE TABLE job_runs (
  name                  text PRIMARY KEY,
  last_started_at       timestamptz,
  last_finished_at      timestamptz,
  last_success_at       timestamptz,
  last_status           text CHECK (last_status IN ('ok', 'partial', 'failed', 'skipped')),
  last_duration_ms      int,
  last_result           jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_error            text,
  consecutive_failures  int NOT NULL DEFAULT 0
);

-- Items a job could not process. After max attempts an item is parked here (dead letter)
-- and skipped until staff retry or resolve it.
CREATE TABLE job_failures (
  id               bigserial PRIMARY KEY,
  job              text NOT NULL,
  entity_id        text NOT NULL,
  error            text NOT NULL,
  attempts         int NOT NULL DEFAULT 1,
  first_failed_at  timestamptz NOT NULL DEFAULT now(),
  last_failed_at   timestamptz NOT NULL DEFAULT now(),
  resolved_at      timestamptz,
  resolution       text
);
CREATE UNIQUE INDEX job_failures_open ON job_failures (job, entity_id) WHERE resolved_at IS NULL;

ALTER TABLE email_outbox DROP CONSTRAINT email_outbox_status_check;
UPDATE email_outbox SET status = 'dead' WHERE status = 'failed';
ALTER TABLE email_outbox
  ADD CONSTRAINT email_outbox_status_check CHECK (status IN ('queued', 'sent', 'dead')),
  ADD COLUMN priority smallint NOT NULL DEFAULT 1 CHECK (priority BETWEEN 0 AND 2),  -- 0 security, 1 transactional, 2 optional
  ADD COLUMN next_attempt_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN last_error text,
  ADD COLUMN provider_message_id text;
DROP INDEX email_outbox_status;
CREATE INDEX email_outbox_due ON email_outbox (priority, next_attempt_at) WHERE status = 'queued';
