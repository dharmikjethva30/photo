-- +goose Up
-- Allowlist grants and the subject veto.

-- "Show photos of me to…" — the allowlist that overrides face-privacy.
--
-- Two scopes, matching the spec's "per-photo or bulk":
--   single_media         — this one photo
--   all_media_of_grantor — every photo the grantor appears in, INCLUDING future
--                          ones. That forward-looking property is why visibility
--                          cannot be materialised (ADR 0005): a bulk grant would
--                          have to be re-expanded on every subsequent upload.
CREATE TABLE media_access_grants (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope            access_grant_scope NOT NULL,

  -- The subject doing the sharing. Only a person IN a photo may share it.
  grantor_user_id  uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  grantee_user_id  uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,

  -- Set for single_media; NULL for a bulk grant.
  media_item_id    uuid REFERENCES media_items (id) ON DELETE CASCADE,
  -- Always set: a grant is scoped to one album, never global.
  album_id         uuid NOT NULL REFERENCES albums (id) ON DELETE CASCADE,

  created_at       timestamptz NOT NULL DEFAULT now(),
  revoked_at       timestamptz,

  CONSTRAINT media_access_grants_scope_shape CHECK (
    (scope = 'single_media' AND media_item_id IS NOT NULL)
    OR
    (scope = 'all_media_of_grantor' AND media_item_id IS NULL)
  ),
  -- Granting access to yourself is meaningless and would mask bugs.
  CONSTRAINT media_access_grants_not_self CHECK (grantor_user_id <> grantee_user_id)
);

-- One live grant per (scope, grantor, grantee, media). Partial on revoked_at so a
-- grant can be revoked and later re-issued.
CREATE UNIQUE INDEX media_access_grants_single_uk
  ON media_access_grants (grantor_user_id, grantee_user_id, media_item_id)
  WHERE scope = 'single_media' AND revoked_at IS NULL;

CREATE UNIQUE INDEX media_access_grants_bulk_uk
  ON media_access_grants (grantor_user_id, grantee_user_id, album_id)
  WHERE scope = 'all_media_of_grantor' AND revoked_at IS NULL;

-- The lookup shape used by the visibility predicate: "what has been granted TO
-- this viewer in this album".
CREATE INDEX media_access_grants_grantee_idx
  ON media_access_grants (grantee_user_id, album_id)
  WHERE revoked_at IS NULL;

CREATE INDEX media_access_grants_media_idx
  ON media_access_grants (media_item_id)
  WHERE revoked_at IS NULL AND media_item_id IS NOT NULL;

-- Subject veto: "hide me from this photo".
--
-- ABSOLUTE, and not a vote. Per the spec, if two members disagree the person in
-- the photo wins. One active hide removes the photo for every other subject, for
-- the photographer's feed, and for the owner — only the uploader retains a private
-- copy. media_items.is_hidden is maintained as EXISTS(active hide), by trigger.
--
-- This also answers the spec's "photo with multiple people where one hides
-- themselves" edge case: the photo is hidden entirely, not blurred or cropped.
CREATE TABLE media_hides (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  media_item_id uuid NOT NULL REFERENCES media_items (id) ON DELETE CASCADE,
  album_id      uuid NOT NULL REFERENCES albums (id) ON DELETE CASCADE,
  -- The subject exercising the veto.
  user_id       uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at    timestamptz NOT NULL DEFAULT now(),
  -- The subject may undo their OWN veto. Nobody else can, including the owner —
  -- and notably a veto survives that member being removed from the album.
  undone_at     timestamptz,

  CONSTRAINT media_hides_uk UNIQUE (media_item_id, user_id)
);

CREATE INDEX media_hides_media_idx ON media_hides (media_item_id) WHERE undone_at IS NULL;

-- +goose StatementBegin
CREATE FUNCTION sync_media_hidden() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  target     uuid;
  any_active boolean;
BEGIN
  target := COALESCE(NEW.media_item_id, OLD.media_item_id);

  SELECT EXISTS (
    SELECT 1 FROM media_hides h
     WHERE h.media_item_id = target AND h.undone_at IS NULL
  ) INTO any_active;

  UPDATE media_items
     SET is_hidden = any_active,
         hidden_at = CASE WHEN any_active THEN COALESCE(hidden_at, now()) ELSE NULL END
   WHERE id = target;

  RETURN COALESCE(NEW, OLD);
END $$;
-- +goose StatementEnd

CREATE TRIGGER media_hides_sync
AFTER INSERT OR UPDATE OF undone_at OR DELETE ON media_hides
FOR EACH ROW EXECUTE FUNCTION sync_media_hidden();

-- +goose Down
DROP TRIGGER IF EXISTS media_hides_sync ON media_hides;
DROP FUNCTION IF EXISTS sync_media_hidden();
DROP TABLE IF EXISTS media_hides;
DROP TABLE IF EXISTS media_access_grants;
