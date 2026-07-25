-- +goose Up
-- Identity: users, provider links, sessions, devices.
--
-- Auth is owned in Go (docs/adr/0004): Apple/Google ID tokens are verified against
-- their JWKS and exchanged for our own tokens. No third-party identity store.

CREATE TABLE users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  display_name  text NOT NULL,
  email         text,
  phone         text,
  avatar_key    text,

  -- Biometric consent is tracked in face_consents, not here. A boolean would
  -- lose the version of the copy shown and when it was accepted, both of which
  -- are needed to demonstrate valid GDPR Art. 9 consent.

  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  -- Soft delete first, so the account-deletion job can purge S3 objects and face
  -- data before the row disappears. Hard-deleting the row first would orphan
  -- exactly the data we are legally required to erase.
  deleted_at    timestamptz,

  CONSTRAINT users_display_name_not_blank CHECK (btrim(display_name) <> '')
);

-- Case-insensitive uniqueness, ignoring soft-deleted rows so an address can be
-- reused after deletion.
CREATE UNIQUE INDEX users_email_uk ON users (lower(email)) WHERE email IS NOT NULL AND deleted_at IS NULL;
CREATE UNIQUE INDEX users_phone_uk ON users (phone) WHERE phone IS NOT NULL AND deleted_at IS NULL;

-- One row per provider identity. A user may link Apple AND Google AND a phone
-- number, all resolving to the same account.
CREATE TABLE auth_identities (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  provider      auth_provider NOT NULL,
  -- The provider's stable subject claim (`sub`). For phone, the E.164 number.
  subject       text NOT NULL,
  email         text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_login_at timestamptz,

  -- The identity that proves who someone is; two accounts cannot share one.
  CONSTRAINT auth_identities_provider_subject_uk UNIQUE (provider, subject)
);

CREATE INDEX auth_identities_user_idx ON auth_identities (user_id);

-- Refresh tokens.
--
-- The token itself is NEVER stored: only sha256(token). A database leak therefore
-- yields no usable credential. Rotation is enforced by `replaced_by`: presenting
-- an already-rotated token means either a replay or a stolen token, and the
-- correct response is to revoke the whole family.
CREATE TABLE refresh_tokens (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  token_sha256 bytea NOT NULL,

  -- All tokens descended from one sign-in share a family id, so reuse detection
  -- can revoke the entire lineage in one statement.
  family_id    uuid NOT NULL,
  replaced_by  uuid REFERENCES refresh_tokens (id) ON DELETE SET NULL,

  issued_at    timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL,
  revoked_at   timestamptz,
  -- Recorded for the user-visible session list ("signed in on iPhone").
  user_agent   text,

  CONSTRAINT refresh_tokens_sha_uk UNIQUE (token_sha256)
);

CREATE INDEX refresh_tokens_user_idx ON refresh_tokens (user_id) WHERE revoked_at IS NULL;
CREATE INDEX refresh_tokens_family_idx ON refresh_tokens (family_id);

-- Phone OTP challenges. The code is hashed like a password: an attacker with read
-- access to this table must not be able to complete a sign-in.
CREATE TABLE phone_otp_challenges (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone       text NOT NULL,
  code_sha256 bytea NOT NULL,
  attempts    int NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL,
  consumed_at timestamptz
);

CREATE INDEX phone_otp_phone_idx ON phone_otp_challenges (phone, created_at DESC);

-- Push tokens, one row per install.
CREATE TABLE devices (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  push_token    text NOT NULL,
  platform      text NOT NULL,
  app_version   text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_seen_at  timestamptz NOT NULL DEFAULT now(),

  -- A push token identifies an install, and installs move between accounts (a
  -- shared device, or a reinstall after signing in as someone else). Unique on
  -- the token alone so re-registering reassigns it rather than duplicating.
  CONSTRAINT devices_push_token_uk UNIQUE (push_token)
);

CREATE INDEX devices_user_idx ON devices (user_id);

-- Notification preferences, one row per user. Defaults mirror the prototype's
-- Settings screen: everything on except "someone hid a photo of you".
CREATE TABLE notification_prefs (
  user_id            uuid PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  photos_added       boolean NOT NULL DEFAULT true,
  you_were_tagged    boolean NOT NULL DEFAULT true,
  window_closing     boolean NOT NULL DEFAULT true,
  photo_hidden       boolean NOT NULL DEFAULT false,
  album_invite       boolean NOT NULL DEFAULT true,
  album_locked       boolean NOT NULL DEFAULT true,
  updated_at         timestamptz NOT NULL DEFAULT now()
);

-- +goose StatementBegin
-- Shared updated_at trigger, used by several tables.
CREATE FUNCTION set_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $$;
-- +goose StatementEnd

CREATE TRIGGER users_set_updated_at
BEFORE UPDATE ON users
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- +goose Down
DROP TRIGGER IF EXISTS users_set_updated_at ON users;
DROP FUNCTION IF EXISTS set_updated_at();
DROP TABLE IF EXISTS notification_prefs;
DROP TABLE IF EXISTS devices;
DROP TABLE IF EXISTS phone_otp_challenges;
DROP TABLE IF EXISTS refresh_tokens;
DROP TABLE IF EXISTS auth_identities;
DROP TABLE IF EXISTS users;
