-- name: GetUserByID :one
SELECT * FROM users WHERE id = $1 AND deleted_at IS NULL;

-- name: GetUserByProviderIdentity :one
-- The sign-in lookup: resolve a provider's subject claim to our user.
SELECT u.*
  FROM users u
  JOIN auth_identities ai ON ai.user_id = u.id
 WHERE ai.provider = $1
   AND ai.subject = $2
   AND u.deleted_at IS NULL;

-- name: CreateUser :one
INSERT INTO users (display_name, email, phone)
VALUES ($1, $2, $3)
RETURNING *;

-- name: UpdateUserProfile :one
UPDATE users
   SET display_name = COALESCE(sqlc.narg('display_name'), display_name),
       avatar_key   = COALESCE(sqlc.narg('avatar_key'), avatar_key)
 WHERE id = sqlc.arg('id') AND deleted_at IS NULL
RETURNING *;

-- name: UpsertAuthIdentity :one
-- Idempotent on (provider, subject) so repeated sign-ins just refresh
-- last_login_at rather than failing on the unique constraint.
INSERT INTO auth_identities (user_id, provider, subject, email, last_login_at)
VALUES ($1, $2, $3, $4, now())
ON CONFLICT (provider, subject)
DO UPDATE SET last_login_at = now(),
              email = COALESCE(EXCLUDED.email, auth_identities.email)
RETURNING *;

-- name: EnsureNotificationPrefs :exec
INSERT INTO notification_prefs (user_id) VALUES ($1)
ON CONFLICT (user_id) DO NOTHING;

-- name: CountFreeSlotsUsed :one
SELECT count(*) FROM album_entitlements
 WHERE user_id = $1 AND source = 'free_slot';

-- name: CreateRefreshToken :one
INSERT INTO refresh_tokens (user_id, token_sha256, family_id, expires_at, user_agent)
VALUES ($1, $2, $3, $4, $5)
RETURNING *;

-- name: GetRefreshTokenByHash :one
SELECT * FROM refresh_tokens WHERE token_sha256 = $1;

-- name: RotateRefreshToken :exec
-- Marks the presented token as replaced. Reuse detection reads `replaced_by`:
-- a token that already has one is being replayed.
UPDATE refresh_tokens
   SET replaced_by = sqlc.arg('replaced_by')
 WHERE id = sqlc.arg('id');

-- name: RevokeRefreshTokenFamily :exec
-- The response to a replayed token: revoke every descendant of that sign-in, not
-- just the one presented.
UPDATE refresh_tokens
   SET revoked_at = now()
 WHERE family_id = $1 AND revoked_at IS NULL;
