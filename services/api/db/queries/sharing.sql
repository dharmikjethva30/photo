-- Subject veto (hide-me) and allowlist grants (M5).

-- name: IsMediaSubject :one
-- The authorization gate for both veto and sharing: only a person confirmed to be IN
-- a photo may hide it or share it. media_subjects is trigger-written from CONFIRMED
-- face_tags, so this is exactly "has the caller confirmed they appear here".
SELECT EXISTS (
  SELECT 1 FROM media_subjects
   WHERE media_item_id = $1 AND user_id = $2
) AS is_subject;

-- name: HideMedia :one
-- Absolute subject veto. ON CONFLICT re-activates a previously undone hide rather than
-- erroring, so hide→unhide→hide is idempotent. The sync_media_hidden trigger flips
-- media_items.is_hidden, which removes the photo for everyone (owner and photographer
-- included) except the uploader's private copy.
INSERT INTO media_hides (media_item_id, album_id, user_id)
VALUES ($1, $2, $3)
ON CONFLICT (media_item_id, user_id) DO UPDATE
   SET undone_at = NULL
RETURNING id;

-- name: UnhideMedia :one
-- The subject undoes their OWN veto. Scoped to (media, user) so nobody can lift
-- someone else's hide. Returns nothing if there was no active hide.
UPDATE media_hides
   SET undone_at = now()
 WHERE media_item_id = $1 AND user_id = $2 AND undone_at IS NULL
RETURNING id;

-- name: ListMyHiddenMedia :many
-- The "photos I've hidden" list, so the subject can review and undo their own vetoes.
SELECT media_item_id
  FROM media_hides
 WHERE user_id = $1 AND album_id = $2 AND undone_at IS NULL
 ORDER BY created_at DESC;

-- name: CreateSingleGrant :one
-- "Show this one photo of me to <member>." Only meaningful when the grantor is a
-- subject of the photo (checked in the service). ON CONFLICT re-activates a revoked
-- grant, matching the partial unique index.
INSERT INTO media_access_grants
  (scope, grantor_user_id, grantee_user_id, media_item_id, album_id)
VALUES ('single_media', $1, $2, $3, $4)
ON CONFLICT (grantor_user_id, grantee_user_id, media_item_id)
  WHERE scope = 'single_media' AND revoked_at IS NULL
  DO UPDATE SET revoked_at = NULL
RETURNING id;

-- name: CreateBulkGrant :one
-- "Show <member> every photo of me in this album, including future uploads." The
-- forward-looking scope is why visibility can't be materialised (ADR 0005).
INSERT INTO media_access_grants
  (scope, grantor_user_id, grantee_user_id, album_id)
VALUES ('all_media_of_grantor', $1, $2, $3)
ON CONFLICT (grantor_user_id, grantee_user_id, album_id)
  WHERE scope = 'all_media_of_grantor' AND revoked_at IS NULL
  DO UPDATE SET revoked_at = NULL
RETURNING id;

-- name: RevokeGrant :one
-- Revoke a grant the caller ISSUED (grantor = caller), by id. Scoped to grantor so
-- nobody can revoke a grant they didn't make.
UPDATE media_access_grants
   SET revoked_at = now()
 WHERE id = $1 AND grantor_user_id = $2 AND revoked_at IS NULL
RETURNING id;

-- name: ListMyGrants :many
-- The grants the caller has issued in an album, so they can review/revoke them.
SELECT id, scope, grantee_user_id, media_item_id, created_at
  FROM media_access_grants
 WHERE grantor_user_id = $1 AND album_id = $2 AND revoked_at IS NULL
 ORDER BY created_at DESC;
