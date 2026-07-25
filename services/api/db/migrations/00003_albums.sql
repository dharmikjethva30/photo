-- +goose Up
-- Albums, membership, the window extension, and entitlements.
--
-- The monetisation rules are enforced by INDEXES here, not by Go. A client-side
-- or application-only check on "3 free albums" is a one-line bypass, and two
-- concurrent create requests would both pass an application count.

-- Entitlements ledger. An album cannot exist without consuming exactly one.
CREATE TABLE album_entitlements (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  source     entitlement_source NOT NULL,

  -- Which of the lifetime free slots this is (1..3). NULL for purchases.
  free_slot  smallint,
  -- Set for purchases; the FK is added in the billing migration to avoid a
  -- circular dependency between migrations.
  purchase_id uuid,

  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT album_entitlements_source_shape CHECK (
    (source = 'free_slot' AND free_slot IS NOT NULL AND purchase_id IS NULL)
    OR
    (source = 'purchase' AND free_slot IS NULL AND purchase_id IS NOT NULL)
  ),
  -- The hard ceiling on free albums lives in the schema, deliberately. Config may
  -- lower it for an experiment but can never raise it without a migration, which
  -- forces the decision to be explicit. config.validate() asserts it agrees.
  CONSTRAINT album_entitlements_free_slot_range CHECK (free_slot IS NULL OR free_slot BETWEEN 1 AND 3)
);

-- THE rule: a user cannot hold the same free slot twice. Combined with the range
-- CHECK above this caps free albums at three per account, and makes two
-- concurrent "create my 3rd album" requests collide so exactly one wins.
CREATE UNIQUE INDEX album_entitlements_free_slot_uk
  ON album_entitlements (user_id, free_slot)
  WHERE source = 'free_slot';

CREATE INDEX album_entitlements_user_idx ON album_entitlements (user_id);

CREATE TABLE albums (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id   uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  title           text NOT NULL,
  template        album_template NOT NULL DEFAULT 'other',
  state           album_state NOT NULL DEFAULT 'active',
  privacy_mode    album_privacy_mode NOT NULL DEFAULT 'face',

  cover_media_id  uuid, -- FK added in the media migration (albums precede media)

  -- The upload window. `window_ends_at` is the authority; `state` is derived from
  -- it by a scheduled job, and stored so that a read never depends on clock skew.
  window_starts_at timestamptz NOT NULL DEFAULT now(),
  window_ends_at   timestamptz NOT NULL,
  locked_at        timestamptz,
  archived_at      timestamptz,

  -- Consuming an entitlement is the only way to create an album. NOT NULL and
  -- UNIQUE together mean one entitlement buys exactly one album, and RESTRICT
  -- means the entitlement cannot be deleted while the album references it.
  --
  -- Albums are SOFT-deleted (deleted_at), so deleting an album can never return
  -- the entitlement to the pool — otherwise create-delete-create is free forever.
  entitlement_id  uuid NOT NULL UNIQUE REFERENCES album_entitlements (id) ON DELETE RESTRICT,

  -- Denormalised counters, maintained by trigger. Read on every library row.
  media_count     integer NOT NULL DEFAULT 0,
  member_count    integer NOT NULL DEFAULT 1,

  -- Bumped by any change affecting who can see what (upload, tag, grant, hide).
  -- Unused today; it is the cache key for the documented scaling path in ADR 0005,
  -- and adding the column later would mean a backfill across every album.
  visibility_generation bigint NOT NULL DEFAULT 1,

  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  deleted_at      timestamptz,

  CONSTRAINT albums_title_not_blank CHECK (btrim(title) <> ''),
  CONSTRAINT albums_window_ordered CHECK (window_ends_at > window_starts_at)
);

CREATE INDEX albums_owner_idx ON albums (owner_user_id) WHERE deleted_at IS NULL;
-- Drives the scheduled active -> locked transition and the 48h/12h reminders.
CREATE INDEX albums_window_idx ON albums (window_ends_at) WHERE state = 'active' AND deleted_at IS NULL;

CREATE TRIGGER albums_set_updated_at
BEFORE UPDATE ON albums
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE album_members (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  album_id      uuid NOT NULL REFERENCES albums (id) ON DELETE CASCADE,
  user_id       uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  role          album_member_role NOT NULL DEFAULT 'member',
  state         album_member_state NOT NULL DEFAULT 'active',

  joined_at     timestamptz NOT NULL DEFAULT now(),
  left_at       timestamptz,
  -- Who removed them, for the audit trail behind "owner removes a member".
  removed_by    uuid REFERENCES users (id) ON DELETE SET NULL,

  CONSTRAINT album_members_uk UNIQUE (album_id, user_id)
);

CREATE INDEX album_members_album_idx ON album_members (album_id) WHERE state = 'active';
CREATE INDEX album_members_user_idx ON album_members (user_id) WHERE state = 'active';

-- Exactly one owner per album.
CREATE UNIQUE INDEX album_members_single_owner_uk
  ON album_members (album_id)
  WHERE role = 'owner' AND state = 'active';

-- Window extensions. The spec allows the owner to extend EXACTLY ONCE before
-- lock, so the constraint is a unique index on album_id rather than a boolean
-- flag on albums — a flag can be reset by a bug, a missing row cannot be forged.
CREATE TABLE album_window_extensions (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  album_id       uuid NOT NULL REFERENCES albums (id) ON DELETE CASCADE,
  extended_by    uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  previous_ends_at timestamptz NOT NULL,
  new_ends_at    timestamptz NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT album_window_extensions_forward CHECK (new_ends_at > previous_ends_at)
);

-- One extension per album, enforced by the database.
CREATE UNIQUE INDEX album_window_extensions_once_uk ON album_window_extensions (album_id);

-- +goose StatementBegin
-- member_count follows active membership.
CREATE FUNCTION sync_album_member_count() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target uuid;
BEGIN
  target := COALESCE(NEW.album_id, OLD.album_id);
  UPDATE albums
     SET member_count = (
           SELECT count(*) FROM album_members m
            WHERE m.album_id = target AND m.state = 'active')
   WHERE id = target;
  RETURN COALESCE(NEW, OLD);
END $$;
-- +goose StatementEnd

CREATE TRIGGER album_members_sync_count
AFTER INSERT OR UPDATE OF state OR DELETE ON album_members
FOR EACH ROW EXECUTE FUNCTION sync_album_member_count();

-- +goose Down
DROP TRIGGER IF EXISTS album_members_sync_count ON album_members;
DROP FUNCTION IF EXISTS sync_album_member_count();
DROP TABLE IF EXISTS album_window_extensions;
DROP TABLE IF EXISTS album_members;
DROP TRIGGER IF EXISTS albums_set_updated_at ON albums;
DROP TABLE IF EXISTS albums;
DROP TABLE IF EXISTS album_entitlements;
