-- +goose Up
-- Enums first, so every later migration can reference them.
--
-- Postgres enums rather than CHECK constraints or lookup tables: these domains
-- are small, closed, and changing one is a deliberate product decision that
-- should require a migration. sqlc also generates real Go types from them, which
-- makes an invalid state unrepresentable rather than a runtime string comparison.

-- Album lifecycle. The spec defines exactly three states.
--   active   — uploads open
--   locked   — read-only after the window closes; the "keepsake" state
--   archived — still readable, surfaced in the user's library
CREATE TYPE album_state AS ENUM ('active', 'locked', 'archived');

-- Privacy mode, per spec 5.2.
--   open    — all members see everything; face detection still runs to power "Just me"
--   face    — each viewer sees only photos they appear in, photos with no people,
--             and photos a subject explicitly shared with them
--   private — the creator approves each photo before the group sees it
CREATE TYPE album_privacy_mode AS ENUM ('open', 'face', 'private');

-- Occasion templates drive the default upload-window length.
CREATE TYPE album_template AS ENUM ('trip', 'wedding', 'dinner', 'birthday', 'family', 'other');

CREATE TYPE album_member_role AS ENUM ('owner', 'member');

-- A removed member's row is kept rather than deleted: their uploads stay (a
-- shared album is a joint artifact) and their subject-veto and sharing decisions
-- must remain honoured, which requires knowing who they were.
CREATE TYPE album_member_state AS ENUM ('active', 'left', 'removed');

CREATE TYPE media_kind AS ENUM ('photo', 'video');

-- Upload lifecycle.
--   pending  — declared, bytes not yet verified
--   uploaded — bytes verified against the declared size and checksum
--   ready    — renditions generated and face processing finished
--   failed   — abandoned or unprocessable
-- Only `ready` media is ever visible to anyone but its uploader.
CREATE TYPE media_state AS ENUM ('pending', 'uploaded', 'ready', 'failed');

-- Creator review, for `private` albums. `not_required` is explicit rather than
-- NULL so the visibility predicate never has to reason about three-valued logic.
CREATE TYPE media_approval_state AS ENUM ('not_required', 'pending', 'approved', 'rejected');

-- Face/derivative processing, tracked separately from media_state because it can
-- fail independently of the upload succeeding.
CREATE TYPE processing_state AS ENUM ('queued', 'running', 'done', 'failed');

-- How a face came to be associated with a person.
--   auto_match     — vector similarity above the match threshold
--   self_claimed   — "that's me" on an unknown cluster
--   member_assigned — someone corrected the tag to a specific member
CREATE TYPE face_tag_source AS ENUM ('auto_match', 'self_claimed', 'member_assigned');

-- CRITICAL: only 'confirmed' grants visibility.
--
-- Automatic matching produces 'suggested' and NEVER 'confirmed'. This asymmetry
-- is what makes a face-matching error unable to leak a photo: the worst case is a
-- wrong suggestion someone declines. See docs/adr/0005.
CREATE TYPE face_tag_status AS ENUM ('suggested', 'confirmed', 'rejected');

-- Allowlist scope, per spec: "per-photo or bulk".
--   single_media        — this one photo
--   all_media_of_grantor — every photo the grantor appears in, including future ones
CREATE TYPE access_grant_scope AS ENUM ('single_media', 'all_media_of_grantor');

CREATE TYPE auth_provider AS ENUM ('apple', 'google', 'phone');

CREATE TYPE invite_channel AS ENUM ('link', 'qr', 'contact', 'share_sheet', 'sms');

-- 'magic_upload' is a scoped, single-purpose grant for the web uploader — it is
-- not a login and must not be treated as one.
CREATE TYPE grant_kind AS ENUM ('browse', 'magic_upload');

CREATE TYPE purchase_platform AS ENUM ('apple', 'google');

-- 'pending' covers Apple's Ask-to-Buy / deferred purchases, which must be shown
-- as awaiting approval rather than as a generic failure.
CREATE TYPE purchase_state AS ENUM ('pending', 'verified', 'failed', 'refunded');

-- An entitlement is either one of the three lifetime free slots or a purchase.
CREATE TYPE entitlement_source AS ENUM ('free_slot', 'purchase');

-- The six notification types the spec enumerates.
CREATE TYPE notification_kind AS ENUM (
  'album_invite',
  'photos_added',
  'you_were_tagged',
  'photo_hidden',
  'window_closing',
  'album_locked'
);

CREATE TYPE report_subject AS ENUM ('media', 'user', 'album');

CREATE TYPE job_state AS ENUM ('queued', 'running', 'done', 'failed');

-- +goose Down
DROP TYPE IF EXISTS job_state;
DROP TYPE IF EXISTS report_subject;
DROP TYPE IF EXISTS notification_kind;
DROP TYPE IF EXISTS entitlement_source;
DROP TYPE IF EXISTS purchase_state;
DROP TYPE IF EXISTS purchase_platform;
DROP TYPE IF EXISTS grant_kind;
DROP TYPE IF EXISTS invite_channel;
DROP TYPE IF EXISTS auth_provider;
DROP TYPE IF EXISTS access_grant_scope;
DROP TYPE IF EXISTS face_tag_status;
DROP TYPE IF EXISTS face_tag_source;
DROP TYPE IF EXISTS processing_state;
DROP TYPE IF EXISTS media_approval_state;
DROP TYPE IF EXISTS media_state;
DROP TYPE IF EXISTS media_kind;
DROP TYPE IF EXISTS album_member_state;
DROP TYPE IF EXISTS album_member_role;
DROP TYPE IF EXISTS album_template;
DROP TYPE IF EXISTS album_privacy_mode;
DROP TYPE IF EXISTS album_state;
