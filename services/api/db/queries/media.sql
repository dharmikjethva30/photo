-- Media queries.
--
-- NOTE: the feed and single-item reads are NOT here. They share one visibility
-- predicate, and sqlc has no way to express a shared SQL fragment — so they are
-- hand-written in internal/adapter/postgres/visibility.go, built from a single
-- const. Two sqlc queries that duplicated the predicate is exactly the divergence
-- docs/adr/0005 warns about.

-- name: DeclareMediaUpload :one
-- Idempotent on (album_id, uploader_user_id, client_media_id) via
-- media_client_id_uk: a client retrying after a dropped response gets the SAME row
-- back rather than creating a duplicate photo.
INSERT INTO media_items (
  album_id, uploader_user_id, kind, client_media_id,
  storage_key, content_type, byte_size, sha256_b64, original_filename,
  width, height, duration_ms,
  capture_time, capture_time_client, capture_time_source, timezone_offset_min,
  approval_state
) VALUES (
  $1, $2, $3, $4,
  $5, $6, $7, $8, $9,
  $10, $11, $12,
  -- Ordered by the client's hint immediately so the feed is correct the moment the
  -- item is ready; EXIF overwrites this when the worker parses it.
  COALESCE(sqlc.narg('capture_time_client')::timestamptz, now()),
  sqlc.narg('capture_time_client'),
  CASE WHEN sqlc.narg('capture_time_client') IS NULL THEN 'upload' ELSE 'client' END,
  sqlc.narg('timezone_offset_min'),
  $13
)
ON CONFLICT (album_id, uploader_user_id, client_media_id)
DO UPDATE SET updated_at = now()
RETURNING *;

-- name: GetMediaItem :one
SELECT * FROM media_items WHERE id = $1 AND deleted_at IS NULL;

-- name: CreateUploadSession :one
-- A re-declare (same client_media_id after a dropped response) starts a NEW S3
-- multipart upload, so s3_upload_id and part_size must move together. Updating only
-- s3_upload_id leaves part_size stale or NULL, and Resume then computes the wrong
-- part count — an upload that can never be resumed. Reset the abort/complete stamps
-- too: this is a fresh attempt, not the old one.
INSERT INTO upload_sessions (media_item_id, s3_upload_id, part_size)
VALUES ($1, $2, $3)
ON CONFLICT (media_item_id) DO UPDATE
   SET s3_upload_id = EXCLUDED.s3_upload_id,
       part_size    = EXCLUDED.part_size,
       completed_at = NULL,
       aborted_at   = NULL
RETURNING *;

-- name: MarkMediaUploaded :one
-- Called only after HeadObject has verified the bytes against the declared size
-- and checksum. That verification is the trust boundary of the whole protocol.
UPDATE media_items
   SET state = 'uploaded',
       uploaded_at = now(),
       byte_size = sqlc.arg('byte_size'),
       sha256_b64 = COALESCE(sqlc.narg('sha256_b64'), sha256_b64)
 WHERE id = sqlc.arg('id')
RETURNING *;

-- name: MarkMediaReady :exec
-- Set by the worker once renditions exist. Until then the item is uploader-only,
-- because detected_face_count = 0 on an unprocessed photo would otherwise read as
-- "no people detected" and grant visibility to everyone.
UPDATE media_items
   SET state = 'ready',
       width = COALESCE(sqlc.narg('width'), width),
       height = COALESCE(sqlc.narg('height'), height),
       capture_time_exif = sqlc.narg('capture_time_exif'),
       capture_time = COALESCE(sqlc.narg('capture_time_exif')::timestamptz, capture_time),
       capture_time_source = CASE
         WHEN sqlc.narg('capture_time_exif') IS NOT NULL THEN 'exif'
         ELSE capture_time_source
       END
 WHERE id = sqlc.arg('id');

-- name: MarkMediaFailed :exec
UPDATE media_items SET state = 'failed' WHERE id = $1;

-- name: CompleteUploadSession :exec
UPDATE upload_sessions SET completed_at = now() WHERE media_item_id = $1;

-- name: UpsertRendition :one
INSERT INTO media_renditions (media_item_id, name, storage_key, content_type, width, height, byte_size)
VALUES ($1, $2, $3, $4, $5, $6, $7)
ON CONFLICT (media_item_id, name)
DO UPDATE SET storage_key = EXCLUDED.storage_key,
              width = EXCLUDED.width,
              height = EXCLUDED.height,
              byte_size = EXCLUDED.byte_size
RETURNING *;

-- name: GetRendition :one
SELECT * FROM media_renditions WHERE media_item_id = $1 AND name = $2;

-- name: ListStalePendingUploads :many
-- The reconciler's input: uploads whose client died between the last PUT and the
-- /complete call. See docs/adr/0003.
SELECT * FROM media_items
 WHERE state = 'pending' AND created_at < $1
 ORDER BY created_at
 LIMIT $2;

-- name: EnqueueMediaJob :one
-- Inserted in the SAME transaction as the media state change, so a job can neither
-- be lost nor double-fire. media_jobs_media_kind_uk makes a retried /complete
-- harmless.
INSERT INTO media_jobs (kind, media_item_id, album_id)
VALUES ($1, $2, $3)
ON CONFLICT (media_item_id, kind) WHERE state IN ('queued', 'running')
DO UPDATE SET run_after = now()
RETURNING *;

-- name: GetUploadSession :one
SELECT * FROM upload_sessions WHERE media_item_id = $1;

-- name: AbortUploadSession :exec
UPDATE upload_sessions SET aborted_at = now() WHERE media_item_id = $1;
