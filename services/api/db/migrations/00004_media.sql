-- +goose Up
-- Media items, their renditions, and upload sessions.

CREATE TABLE media_items (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  album_id         uuid NOT NULL REFERENCES albums (id) ON DELETE CASCADE,
  -- RESTRICT, not CASCADE: deleting a user must not silently delete photos other
  -- members are relying on. Account deletion reassigns or explicitly removes.
  uploader_user_id uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,

  kind             media_kind NOT NULL,
  state            media_state NOT NULL DEFAULT 'pending',
  approval_state   media_approval_state NOT NULL DEFAULT 'not_required',

  -- Client-supplied idempotency key. This is what makes "declare an upload" safe
  -- to retry: a client that retries after a dropped response gets the same
  -- media_item back rather than creating a duplicate photo. Essential for
  -- background upload and the flaky web uploader.
  client_media_id  text NOT NULL,

  storage_key      text NOT NULL,
  content_type     text NOT NULL,
  byte_size        bigint NOT NULL,
  -- Base64 sha256, as S3 reports it. Verified against the object on completion:
  -- this is the trust boundary, and also the "no compression, ever" guarantee.
  sha256_b64       text,
  original_filename text,

  width            integer,
  height           integer,
  duration_ms      integer,

  -- Capture time is resolved from three sources, in priority order, and which one
  -- won is recorded. The client hint orders the feed correctly the instant an item
  -- is ready; EXIF corrects it afterwards. Screenshots and forwarded images
  -- legitimately have no EXIF, so that is a fallback, not an error.
  capture_time         timestamptz NOT NULL,
  capture_time_exif    timestamptz,
  capture_time_client  timestamptz,
  capture_time_source  text NOT NULL DEFAULT 'client',
  -- A feed ordered "chronologically" across members in different timezones needs
  -- the original UTC offset, not just an instant.
  timezone_offset_min  integer,

  -- GPS is deliberately NOT stored by default. Silently retaining the precise
  -- location of someone's home in a shared album is a privacy incident waiting to
  -- happen; if location is ever surfaced it must be an explicit product decision.
  exif             jsonb,

  -- Denormalised, maintained by trigger.
  --
  -- detected_face_count = 0 means "no people detected" and grants visibility to
  -- everyone under face-privacy — so it MUST be read together with
  -- face_proc_state = 'done'. An unprocessed photo also has 0 faces, and treating
  -- it as public would leak it. See the visibility predicate.
  detected_face_count integer NOT NULL DEFAULT 0,
  face_proc_state  processing_state NOT NULL DEFAULT 'queued',
  face_model_id    text,

  -- Subject veto. Any active hide sets this; it is an EXISTS, not a vote.
  is_hidden        boolean NOT NULL DEFAULT false,
  hidden_at        timestamptz,

  -- Phase 2 scene grouping; the column exists now so the feed's group-by does not
  -- need a migration later.
  scene_label      text,

  -- iOS Live Photos are a still plus a paired .mov. Phase 1 ships still-only, but
  -- the grouping key exists so the pair can be reunited without a backfill.
  live_photo_group_id uuid,

  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  uploaded_at      timestamptz,
  deleted_at       timestamptz,

  CONSTRAINT media_byte_size_positive CHECK (byte_size > 0),
  CONSTRAINT media_video_has_duration CHECK (kind <> 'video' OR duration_ms IS NOT NULL),
  CONSTRAINT media_capture_source_known CHECK (capture_time_source IN ('exif', 'client', 'upload'))
);

-- Idempotent declare, per uploader. Scoped to the uploader as well as the album so
-- two members cannot collide on a coincidentally equal local id.
CREATE UNIQUE INDEX media_client_id_uk
  ON media_items (album_id, uploader_user_id, client_media_id);

-- THE feed index. Matches the visibility query's ORDER BY exactly so Postgres can
-- walk it and stop at LIMIT, making cost proportional to rows RETURNED rather
-- than to album size.
CREATE INDEX media_feed_idx
  ON media_items (album_id, capture_time, id)
  WHERE state = 'ready' AND deleted_at IS NULL AND is_hidden = false;

-- Group-by-uploader and group-by-scene feed variants.
CREATE INDEX media_uploader_idx ON media_items (album_id, uploader_user_id, capture_time)
  WHERE state = 'ready' AND deleted_at IS NULL;
CREATE INDEX media_scene_idx ON media_items (album_id, scene_label, capture_time)
  WHERE state = 'ready' AND deleted_at IS NULL AND scene_label IS NOT NULL;

-- Drives the reconciler that completes or abandons uploads whose client died
-- between the last part PUT and /complete.
CREATE INDEX media_pending_idx ON media_items (created_at) WHERE state = 'pending';

-- The creator-review queue for `private` albums.
CREATE INDEX media_approval_idx ON media_items (album_id) WHERE approval_state = 'pending';

CREATE TRIGGER media_items_set_updated_at
BEFORE UPDATE ON media_items
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Now that media_items exists, close the album cover reference.
-- SET NULL rather than CASCADE: deleting the cover photo must not delete the album.
ALTER TABLE albums
  ADD CONSTRAINT albums_cover_media_fk
  FOREIGN KEY (cover_media_id) REFERENCES media_items (id) ON DELETE SET NULL;

-- Derived images. Originals are never modified; every viewing path uses these.
--
-- This is not merely an optimisation: nothing on Android or in a browser renders
-- HEIC, so a JPEG rendition is the only way a HEIC original can be displayed at
-- all. "Download original" hands over the untouched HEIC.
CREATE TABLE media_renditions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  media_item_id uuid NOT NULL REFERENCES media_items (id) ON DELETE CASCADE,
  -- 'thumb_256' | 'preview_1024' | 'poster' (video first frame)
  name          text NOT NULL,
  storage_key   text NOT NULL,
  content_type  text NOT NULL DEFAULT 'image/jpeg',
  width         integer NOT NULL,
  height        integer NOT NULL,
  byte_size     bigint NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT media_renditions_uk UNIQUE (media_item_id, name)
);

CREATE TABLE video_metadata (
  media_item_id uuid PRIMARY KEY REFERENCES media_items (id) ON DELETE CASCADE,
  codec         text,
  bitrate       bigint,
  frame_rate    numeric(6, 3),
  -- Rotation is metadata, not baked pixels; ignoring it plays videos sideways.
  rotation_deg  integer NOT NULL DEFAULT 0,
  has_audio     boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- One row per upload attempt, holding the S3 multipart state needed to resume.
CREATE TABLE upload_sessions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  media_item_id uuid NOT NULL REFERENCES media_items (id) ON DELETE CASCADE,
  -- NULL for a single presigned PUT; set for multipart.
  s3_upload_id  text,
  part_size     bigint,
  created_at    timestamptz NOT NULL DEFAULT now(),
  completed_at  timestamptz,
  aborted_at    timestamptz,

  CONSTRAINT upload_sessions_media_uk UNIQUE (media_item_id)
);

-- +goose StatementBegin
-- media_count follows visible, non-deleted media.
CREATE FUNCTION sync_album_media_count() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target uuid;
BEGIN
  target := COALESCE(NEW.album_id, OLD.album_id);
  UPDATE albums
     SET media_count = (
           SELECT count(*) FROM media_items m
            WHERE m.album_id = target
              AND m.state = 'ready'
              AND m.deleted_at IS NULL
              AND m.is_hidden = false)
   WHERE id = target;
  RETURN COALESCE(NEW, OLD);
END $$;
-- +goose StatementEnd

CREATE TRIGGER media_items_sync_album_count
AFTER INSERT OR UPDATE OF state, deleted_at, is_hidden OR DELETE ON media_items
FOR EACH ROW EXECUTE FUNCTION sync_album_media_count();

-- +goose Down
DROP TRIGGER IF EXISTS media_items_sync_album_count ON media_items;
DROP FUNCTION IF EXISTS sync_album_media_count();
DROP TABLE IF EXISTS upload_sessions;
DROP TABLE IF EXISTS video_metadata;
DROP TABLE IF EXISTS media_renditions;
ALTER TABLE albums DROP CONSTRAINT IF EXISTS albums_cover_media_fk;
DROP TRIGGER IF EXISTS media_items_set_updated_at ON media_items;
DROP TABLE IF EXISTS media_items;
