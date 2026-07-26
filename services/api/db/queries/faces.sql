-- Face queries: consent, reference selfies, and GDPR erasure.
--
-- Face data is GDPR Art. 9 / BIPA biometric data. Two rules shape everything here:
--   1. Nothing is collected without an ACTIVE consent row (checked before any write).
--   2. Erasure is a HARD delete — a deleted_at on biometric data does not satisfy a
--      right-to-erasure request, so the erasure queries below DELETE, they do not
--      soft-flag. (Ordinary reference replacement uses the soft delete; erasure does
--      not.)

-- name: CreateFaceConsent :one
-- Records a consent event with the exact copy version shown and evidence of it, so we
-- can demonstrate WHAT was consented to, not just that a box was ticked.
INSERT INTO face_consents (user_id, copy_version, ip, user_agent)
VALUES ($1, $2, $3, $4)
RETURNING *;

-- name: GetActiveFaceConsent :one
-- The most recent un-revoked consent, or no row. This is the gate every face write
-- checks; a NULL result must fail closed (refuse the write).
SELECT * FROM face_consents
 WHERE user_id = $1 AND revoked_at IS NULL
 ORDER BY granted_at DESC
 LIMIT 1;

-- name: RevokeFaceConsent :exec
-- Withdraw consent. Revoking does not itself erase data (that is DELETE /me/face-data);
-- it stops future processing. Idempotent.
UPDATE face_consents
   SET revoked_at = now()
 WHERE user_id = $1 AND revoked_at IS NULL;

-- name: CreateFaceReference :one
-- Inserted at COMPLETE, after HeadObject has confirmed the selfie is in the facedata
-- bucket. embedding is NULL until the face worker computes it (that is a later job);
-- model_id is stamped now so a model upgrade is a re-embed migration, not silent
-- cross-space comparison.
--
-- The embedding column is NEVER selected back into the API: it is nullable, and the
-- API only needs to know processed-or-not, so `(embedding IS NOT NULL)` gives that as
-- a bool without decoding a (possibly NULL) vector.
INSERT INTO face_references (id, user_id, storage_key, model_id)
VALUES ($1, $2, $3, $4)
RETURNING id, user_id, storage_key, model_id, det_score, created_at, deleted_at,
          (embedding IS NOT NULL)::boolean AS processed;

-- name: ListFaceReferences :many
SELECT id, user_id, storage_key, model_id, det_score, created_at, deleted_at,
       (embedding IS NOT NULL)::boolean AS processed
  FROM face_references
 WHERE user_id = $1 AND deleted_at IS NULL
 ORDER BY created_at DESC;

-- name: SoftDeleteFaceReference :one
-- Ordinary retire-a-reference (the user replaced their selfie). Ownership-scoped, and
-- returns the storage_key so the caller can delete the S3 object too. NOT erasure.
UPDATE face_references
   SET deleted_at = now()
 WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL
RETURNING id, storage_key;

-- --- ERASURE (hard delete) -------------------------------------------------
-- Each returns what it removed so the erasure endpoint can report a provable count.

-- name: EraseUserFaceReferences :many
DELETE FROM face_references WHERE user_id = $1 RETURNING storage_key;

-- name: EraseUserFaceTags :exec
DELETE FROM face_tags WHERE user_id = $1;

-- name: EraseUserMediaSubjects :exec
-- Removing the user's subject rows also revokes the visibility their presence granted
-- (the sync trigger keeps media_items in step). Correct: erased face data must stop
-- being the basis for who-sees-what.
DELETE FROM media_subjects WHERE user_id = $1;

-- name: EraseUserFaceConsents :exec
DELETE FROM face_consents WHERE user_id = $1;

-- --- tag confirmation (M4.4) -----------------------------------------------

-- name: ListMySuggestedTags :many
-- Photos in an album where the caller is SUGGESTED but has not decided yet — the
-- input to the "confirm you're in these" sheet. Returns the tag, the photo, and the
-- face crop so the UI can show exactly which face it means. Only ready photos.
SELECT ft.id AS tag_id, ft.media_item_id, ft.similarity,
       f.crop_key, f.bbox_x, f.bbox_y, f.bbox_w, f.bbox_h
  FROM face_tags ft
  JOIN faces f ON f.id = ft.face_id
  JOIN media_items mi ON mi.id = ft.media_item_id AND mi.deleted_at IS NULL AND mi.state = 'ready'
 WHERE ft.album_id = $1 AND ft.user_id = $2 AND ft.status = 'suggested'
 ORDER BY ft.similarity DESC NULLS LAST;

-- name: GetFaceTagForDecision :one
-- Loads a tag for confirm/reject, so the service can check the caller owns it (only
-- the tagged person decides their own tag).
SELECT id, media_item_id, album_id, user_id, status FROM face_tags WHERE id = $1;

-- name: DecideFaceTag :one
-- Confirm or reject. decided_by/at record who acted. The media_subjects trigger fires
-- on the status change: 'confirmed' grants visibility, 'rejected' withdraws it (unless
-- another confirmed tag for the same person remains on the photo).
UPDATE face_tags
   SET status = $2, decided_by = $3, decided_at = now()
 WHERE id = $1
RETURNING id, media_item_id, album_id, user_id, status;

-- name: SelfClaimFace :one
-- The caller asserts an untagged face is them (source self_claimed, immediately
-- confirmed — you are trusted to identify yourself). Idempotent on (face_id, user_id).
INSERT INTO face_tags (media_item_id, album_id, face_id, user_id, source, status, decided_by, decided_at)
SELECT f.media_item_id, f.album_id, f.id, $2, 'self_claimed', 'confirmed', $2, now()
  FROM faces f WHERE f.id = $1
ON CONFLICT (face_id, user_id)
DO UPDATE SET status = 'confirmed', source = 'self_claimed', decided_by = $2, decided_at = now()
RETURNING id, media_item_id, album_id, user_id, status;
