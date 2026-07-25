-- +goose Up
-- Notifications, trust & safety, and the cross-language job queue.

CREATE TABLE notifications (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  kind          notification_kind NOT NULL,

  album_id      uuid REFERENCES albums (id) ON DELETE CASCADE,
  media_item_id uuid REFERENCES media_items (id) ON DELETE CASCADE,
  -- The person who caused it, for "Maya tagged you".
  actor_user_id uuid REFERENCES users (id) ON DELETE SET NULL,

  -- Rendered copy is stored rather than templated at read time, so that editing a
  -- template later does not silently rewrite history in someone's inbox.
  title         text NOT NULL,
  body          text NOT NULL,

  read_at       timestamptz,
  -- Distinct from read_at: push delivery can fail while the in-app row exists.
  pushed_at     timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- The activity inbox, newest first, with the unread count.
CREATE INDEX notifications_user_idx ON notifications (user_id, created_at DESC);
CREATE INDEX notifications_unread_idx ON notifications (user_id) WHERE read_at IS NULL;

-- Minimal trust & safety, which the spec calls for even at MVP.
CREATE TABLE reports (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  subject       report_subject NOT NULL,

  media_item_id uuid REFERENCES media_items (id) ON DELETE CASCADE,
  reported_user_id uuid REFERENCES users (id) ON DELETE CASCADE,
  album_id      uuid REFERENCES albums (id) ON DELETE CASCADE,

  reason        text NOT NULL,
  detail        text,

  resolved_at   timestamptz,
  resolution    text,
  created_at    timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT reports_subject_shape CHECK (
    (subject = 'media' AND media_item_id IS NOT NULL)
    OR (subject = 'user' AND reported_user_id IS NOT NULL)
    OR (subject = 'album' AND album_id IS NOT NULL)
  )
);

CREATE INDEX reports_open_idx ON reports (created_at) WHERE resolved_at IS NULL;

-- The cross-language job queue.
--
-- Go-side jobs use river (Postgres-backed, transactional enqueue via InsertTx).
-- But river's schema and encoding are Go-internal and NOT a compatibility surface,
-- so the Python media worker cannot consume it.
--
-- This table is therefore the deliberate contract between Go and Python: plain,
-- boring, and documented. Keep it dumb. Go enqueues in the SAME transaction as the
-- media state change, so a job can neither be lost nor double-fire.
CREATE TABLE media_jobs (
  id            bigserial PRIMARY KEY,
  -- 'thumbnail' (renditions + EXIF) or 'face' (detect + embed). Separate kinds so
  -- the fast thumbnail queue is never blocked behind a slow ArcFace inference.
  kind          text NOT NULL,
  media_item_id uuid NOT NULL REFERENCES media_items (id) ON DELETE CASCADE,
  album_id      uuid NOT NULL REFERENCES albums (id) ON DELETE CASCADE,

  state         job_state NOT NULL DEFAULT 'queued',
  priority      smallint NOT NULL DEFAULT 5,

  attempts      smallint NOT NULL DEFAULT 0,
  max_attempts  smallint NOT NULL DEFAULT 5,
  last_error    text,

  run_after     timestamptz NOT NULL DEFAULT now(),
  locked_by     text,
  locked_at     timestamptz,

  created_at    timestamptz NOT NULL DEFAULT now(),
  finished_at   timestamptz,

  CONSTRAINT media_jobs_kind_known CHECK (kind IN ('thumbnail', 'face'))
);

-- Idempotent enqueue: the same outstanding job cannot be queued twice, so a
-- retried /complete call is harmless.
CREATE UNIQUE INDEX media_jobs_media_kind_uk
  ON media_jobs (media_item_id, kind)
  WHERE state IN ('queued', 'running');

-- The claim query's access path: FOR UPDATE SKIP LOCKED over ready work.
CREATE INDEX media_jobs_claim_idx
  ON media_jobs (kind, priority, run_after, id)
  WHERE state = 'queued';

-- Drives the reaper that resets jobs whose worker died mid-flight.
CREATE INDEX media_jobs_stale_idx ON media_jobs (locked_at) WHERE state = 'running';

-- +goose StatementBegin
-- Wake idle workers immediately instead of waiting out their poll interval.
-- Workers LISTEN on the channel with a short timeout, so throughput is
-- notification-driven under load and polling-driven when idle.
CREATE FUNCTION notify_media_job() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_notify('media_jobs', NEW.kind);
  RETURN NEW;
END $$;
-- +goose StatementEnd

CREATE TRIGGER media_jobs_notify
AFTER INSERT ON media_jobs
FOR EACH ROW EXECUTE FUNCTION notify_media_job();

-- +goose Down
DROP TRIGGER IF EXISTS media_jobs_notify ON media_jobs;
DROP FUNCTION IF EXISTS notify_media_job();
DROP TABLE IF EXISTS media_jobs;
DROP TABLE IF EXISTS reports;
DROP TABLE IF EXISTS notifications;
