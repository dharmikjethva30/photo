-- Invite queries.
--
-- An invite CODE is a public, shareable identifier with no authority of its own:
-- holding it lets you *view* the invite and, once signed in, join. It never grants
-- access by itself (docs/adr/0004's principle that authority comes from a session,
-- not from a URL). So the code is stored in clear and looked up directly.

-- name: CreateInvite :one
INSERT INTO invites (album_id, created_by, code, channel, max_uses, expires_at)
VALUES ($1, $2, $3, $4, $5, $6)
RETURNING *;

-- name: GetInviteByCode :one
-- The row plus the album title and cover, which the join/landing screen shows before
-- the user commits. Only non-deleted albums: an invite to a deleted album is dead.
SELECT i.*, a.title AS album_title, a.privacy_mode AS album_privacy_mode,
       a.state AS album_state, a.cover_media_id AS album_cover_media_id,
       a.owner_user_id AS album_owner_user_id
  FROM invites i
  JOIN albums a ON a.id = i.album_id AND a.deleted_at IS NULL
 WHERE i.code = $1;

-- name: ListAlbumInvites :many
SELECT * FROM invites
 WHERE album_id = $1 AND revoked_at IS NULL
 ORDER BY created_at DESC;

-- name: RevokeInvite :one
-- Idempotent and ownership-scoped in one statement: the album_id predicate means a
-- caller can only revoke an invite belonging to an album they passed authorization
-- for, and re-revoking is a no-op that still returns the row.
UPDATE invites
   SET revoked_at = COALESCE(revoked_at, now())
 WHERE id = $1 AND album_id = $2
RETURNING *;

-- name: ConsumeInvite :one
-- Atomically records one use, but ONLY while the invite is still valid. The WHERE
-- clause is the enforcement: not revoked, not expired, and under max_uses if one is
-- set. A concurrent burst of accepts cannot exceed max_uses because each UPDATE
-- re-checks use_count against the row it locks. Returns no row when the invite is
-- spent or dead, which the caller maps to a 409/410.
UPDATE invites
   SET use_count = use_count + 1
 WHERE id = $1
   AND revoked_at IS NULL
   AND (expires_at IS NULL OR expires_at > now())
   AND (max_uses IS NULL OR use_count < max_uses)
RETURNING *;
