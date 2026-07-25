-- +goose Up
-- Invites and magic-link grants.
--
-- Two distinct concepts, deliberately separate tables:
--   invites — "join this album as a member". Requires sign-in to accept.
--   grants  — a scoped capability for someone with NO account: browse read-only,
--             or upload via a magic link. NOT a login (docs/adr/0004).

CREATE TABLE invites (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  album_id      uuid NOT NULL REFERENCES albums (id) ON DELETE CASCADE,
  created_by    uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,

  -- The short code that appears in photu.app/a/<code>. Stored in clear because it
  -- is a public, shareable identifier with no authority of its own — accepting an
  -- invite still requires signing in.
  code          text NOT NULL,
  channel       invite_channel NOT NULL DEFAULT 'link',

  -- NULL means unlimited within the album's member cap.
  max_uses      integer,
  use_count     integer NOT NULL DEFAULT 0,

  expires_at    timestamptz,
  revoked_at    timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT invites_code_uk UNIQUE (code),
  CONSTRAINT invites_max_uses_positive CHECK (max_uses IS NULL OR max_uses > 0)
);

CREATE INDEX invites_album_idx ON invites (album_id) WHERE revoked_at IS NULL;

CREATE TABLE invite_redemptions (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invite_id  uuid NOT NULL REFERENCES invites (id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),

  -- Re-tapping a link must not increment use_count again.
  CONSTRAINT invite_redemptions_uk UNIQUE (invite_id, user_id)
);

-- Capability grants for people without an account.
--
-- The token IS the credential here, so unlike an invite code it is stored hashed.
CREATE TABLE magic_link_grants (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  album_id      uuid NOT NULL REFERENCES albums (id) ON DELETE CASCADE,
  created_by    uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  kind          grant_kind NOT NULL,

  token_sha256  bytea NOT NULL,

  -- A guest sets a display name so their uploads are attributable in the feed.
  guest_label   text,
  -- Uploads land against a placeholder user so media_items.uploader_user_id stays
  -- NOT NULL and the feed can show an uploader without special-casing guests.
  guest_user_id uuid REFERENCES users (id) ON DELETE SET NULL,

  -- Quotas, so a leaked link cannot be used to fill the album (or our S3 bill).
  max_items     integer,
  max_bytes     bigint,
  used_items    integer NOT NULL DEFAULT 0,
  used_bytes    bigint NOT NULL DEFAULT 0,

  expires_at    timestamptz NOT NULL,
  revoked_at    timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_used_at  timestamptz,

  CONSTRAINT magic_link_grants_token_uk UNIQUE (token_sha256)
);

CREATE INDEX magic_link_grants_album_idx ON magic_link_grants (album_id) WHERE revoked_at IS NULL;

-- +goose Down
DROP TABLE IF EXISTS magic_link_grants;
DROP TABLE IF EXISTS invite_redemptions;
DROP TABLE IF EXISTS invites;
