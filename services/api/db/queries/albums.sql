-- name: ClaimFreeAlbumSlot :one
-- Claims the user's next lifetime free slot.
--
-- Concurrency is handled by the DATABASE, not by this query being careful: two
-- simultaneous requests both compute the same next slot number, and the unique
-- index album_entitlements_free_slot_uk makes exactly one of them win. The loser
-- gets a unique-violation, which the service maps to "retry or pay".
--
-- The CHECK constraint (free_slot BETWEEN 1 AND 3) caps it, so a retry after
-- three slots are gone fails rather than silently issuing a fourth.
INSERT INTO album_entitlements (user_id, source, free_slot)
SELECT $1, 'free_slot', COALESCE(max(free_slot), 0) + 1
  FROM album_entitlements
 WHERE user_id = $1 AND source = 'free_slot'
RETURNING *;

-- name: ClaimPurchasedEntitlement :one
INSERT INTO album_entitlements (user_id, source, purchase_id)
VALUES ($1, 'purchase', $2)
RETURNING *;

-- name: GetUnconsumedEntitlement :one
-- An entitlement not yet spent on an album. `albums.entitlement_id` is UNIQUE, so
-- "unconsumed" is simply "no album references it".
SELECT e.*
  FROM album_entitlements e
  LEFT JOIN albums a ON a.entitlement_id = e.id
 WHERE e.user_id = $1 AND a.id IS NULL
 ORDER BY e.created_at
 LIMIT 1;

-- name: CreateAlbum :one
INSERT INTO albums (
  owner_user_id, title, template, privacy_mode,
  window_starts_at, window_ends_at, entitlement_id
) VALUES ($1, $2, $3, $4, now(), $5, $6)
RETURNING *;

-- name: GetAlbum :one
SELECT * FROM albums WHERE id = $1 AND deleted_at IS NULL;

-- name: ListAlbumsForUser :many
-- The library screen. Ordered newest-active-first, which is how the design shows
-- it: live albums on top, keepsakes below.
SELECT a.*
  FROM albums a
  JOIN album_members m ON m.album_id = a.id
 WHERE m.user_id = $1
   AND m.state = 'active'
   AND a.deleted_at IS NULL
 ORDER BY (a.state = 'active') DESC, a.window_ends_at DESC
 LIMIT $2;

-- name: AddAlbumMember :one
INSERT INTO album_members (album_id, user_id, role)
VALUES ($1, $2, $3)
ON CONFLICT (album_id, user_id)
DO UPDATE SET state = 'active', left_at = NULL, removed_by = NULL
RETURNING *;

-- name: GetAlbumMember :one
SELECT * FROM album_members
 WHERE album_id = $1 AND user_id = $2 AND state = 'active';

-- name: ListAlbumMembers :many
SELECT m.*, u.display_name, u.avatar_key
  FROM album_members m
  JOIN users u ON u.id = m.user_id
 WHERE m.album_id = $1 AND m.state = 'active'
 ORDER BY (m.role = 'owner') DESC, m.joined_at;

-- name: CountAlbumMembers :one
SELECT count(*) FROM album_members
 WHERE album_id = $1 AND state = 'active';

-- name: SetAlbumCover :exec
UPDATE albums SET cover_media_id = $2 WHERE id = $1;

-- name: BumpAlbumVisibilityGeneration :exec
-- Called on any change to who can see what. Unused today; it is the cache key for
-- the scaling path in docs/adr/0005, and bumping it from the start means the
-- counter is already correct if that path is ever taken.
UPDATE albums SET visibility_generation = visibility_generation + 1 WHERE id = $1;
