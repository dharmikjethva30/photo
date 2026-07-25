-- Schema invariant checks.
--
-- These assert that the BUSINESS RULES are enforced by the database, not by
-- application code. Each block deliberately attempts an illegal write and expects
-- it to fail. Run with:  task db:invariants
--
-- Kept as SQL rather than Go because the subject under test is the schema itself:
-- a Go test could pass while the constraint was actually being enforced by Go.
\set ON_ERROR_STOP on
BEGIN;

-- Fixtures -----------------------------------------------------------------
INSERT INTO users (id, display_name) VALUES
  ('11111111-1111-1111-1111-111111111111', 'Dev'),
  ('22222222-2222-2222-2222-222222222222', 'Maya'),
  ('33333333-3333-3333-3333-333333333333', 'Sam');

-- 1. Free albums are capped at three, by index -----------------------------
INSERT INTO album_entitlements (user_id, source, free_slot) VALUES
  ('11111111-1111-1111-1111-111111111111', 'free_slot', 1),
  ('11111111-1111-1111-1111-111111111111', 'free_slot', 2),
  ('11111111-1111-1111-1111-111111111111', 'free_slot', 3);

DO $$
BEGIN
  -- Reusing a slot must collide. This is what makes two concurrent "create my
  -- 3rd album" requests resolve to exactly one winner.
  BEGIN
    INSERT INTO album_entitlements (user_id, source, free_slot)
    VALUES ('11111111-1111-1111-1111-111111111111', 'free_slot', 3);
    RAISE EXCEPTION 'FAIL: duplicate free_slot was accepted';
  EXCEPTION WHEN unique_violation THEN
    RAISE NOTICE 'ok  duplicate free_slot rejected';
  END;

  -- A fourth slot must be impossible even with a fresh number.
  BEGIN
    INSERT INTO album_entitlements (user_id, source, free_slot)
    VALUES ('11111111-1111-1111-1111-111111111111', 'free_slot', 4);
    RAISE EXCEPTION 'FAIL: free_slot 4 was accepted — the cap is not enforced';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'ok  free_slot 4 rejected by range check';
  END;

  -- A free-slot entitlement must not also reference a purchase.
  BEGIN
    INSERT INTO album_entitlements (user_id, source, free_slot, purchase_id)
    VALUES ('22222222-2222-2222-2222-222222222222', 'free_slot', 1,
            '44444444-4444-4444-4444-444444444444');
    RAISE EXCEPTION 'FAIL: mixed-source entitlement accepted';
  EXCEPTION WHEN check_violation OR foreign_key_violation THEN
    RAISE NOTICE 'ok  mixed-source entitlement rejected';
  END;
END $$;

-- 2. An album cannot exist without consuming an entitlement ----------------
DO $$
BEGIN
  BEGIN
    INSERT INTO albums (owner_user_id, title, window_ends_at)
    VALUES ('11111111-1111-1111-1111-111111111111', 'No entitlement', now() + interval '30 days');
    RAISE EXCEPTION 'FAIL: album created without an entitlement';
  EXCEPTION WHEN not_null_violation THEN
    RAISE NOTICE 'ok  album without entitlement rejected';
  END;
END $$;

-- Create a real album on slot 1.
INSERT INTO albums (id, owner_user_id, title, window_ends_at, privacy_mode, entitlement_id)
SELECT '55555555-5555-5555-5555-555555555555',
       '11111111-1111-1111-1111-111111111111',
       'Lisbon, March',
       now() + interval '30 days',
       'face',
       id
  FROM album_entitlements
 WHERE user_id = '11111111-1111-1111-1111-111111111111' AND free_slot = 1;

DO $$
BEGIN
  -- One entitlement buys exactly one album.
  BEGIN
    INSERT INTO albums (owner_user_id, title, window_ends_at, entitlement_id)
    SELECT '11111111-1111-1111-1111-111111111111', 'Second album, same slot',
           now() + interval '30 days', id
      FROM album_entitlements
     WHERE user_id = '11111111-1111-1111-1111-111111111111' AND free_slot = 1;
    RAISE EXCEPTION 'FAIL: one entitlement produced two albums';
  EXCEPTION WHEN unique_violation THEN
    RAISE NOTICE 'ok  entitlement cannot be spent twice';
  END;

  -- Deleting an album must never return the entitlement to the pool. Albums are
  -- soft-deleted, and RESTRICT blocks removing a referenced entitlement outright.
  BEGIN
    DELETE FROM album_entitlements
     WHERE user_id = '11111111-1111-1111-1111-111111111111' AND free_slot = 1;
    RAISE EXCEPTION 'FAIL: a consumed entitlement was deleted (free albums would be refundable)';
  EXCEPTION WHEN foreign_key_violation THEN
    RAISE NOTICE 'ok  consumed entitlement cannot be deleted';
  END;
END $$;

-- 3. Membership: one owner, no duplicates ----------------------------------
INSERT INTO album_members (album_id, user_id, role) VALUES
  ('55555555-5555-5555-5555-555555555555', '11111111-1111-1111-1111-111111111111', 'owner'),
  ('55555555-5555-5555-5555-555555555555', '22222222-2222-2222-2222-222222222222', 'member'),
  ('55555555-5555-5555-5555-555555555555', '33333333-3333-3333-3333-333333333333', 'member');

DO $$
DECLARE n integer;
BEGIN
  BEGIN
    INSERT INTO album_members (album_id, user_id, role)
    VALUES ('55555555-5555-5555-5555-555555555555',
            '22222222-2222-2222-2222-222222222222', 'owner');
    RAISE EXCEPTION 'FAIL: duplicate membership accepted';
  EXCEPTION WHEN unique_violation THEN
    RAISE NOTICE 'ok  duplicate membership rejected';
  END;

  -- member_count is maintained by trigger.
  SELECT member_count INTO n FROM albums WHERE id = '55555555-5555-5555-5555-555555555555';
  IF n <> 3 THEN
    RAISE EXCEPTION 'FAIL: member_count is %, expected 3', n;
  END IF;
  RAISE NOTICE 'ok  member_count trigger = 3';
END $$;

-- 4. The window may be extended exactly once ------------------------------
INSERT INTO album_window_extensions (album_id, extended_by, previous_ends_at, new_ends_at)
VALUES ('55555555-5555-5555-5555-555555555555', '11111111-1111-1111-1111-111111111111',
        now() + interval '30 days', now() + interval '44 days');

DO $$
BEGIN
  BEGIN
    INSERT INTO album_window_extensions (album_id, extended_by, previous_ends_at, new_ends_at)
    VALUES ('55555555-5555-5555-5555-555555555555', '11111111-1111-1111-1111-111111111111',
            now() + interval '44 days', now() + interval '58 days');
    RAISE EXCEPTION 'FAIL: a second window extension was accepted';
  EXCEPTION WHEN unique_violation THEN
    RAISE NOTICE 'ok  second window extension rejected';
  END;
END $$;

-- 5. Uploads are idempotent per client_media_id ---------------------------
INSERT INTO media_items (
  id, album_id, uploader_user_id, kind, state, client_media_id,
  storage_key, content_type, byte_size, capture_time
) VALUES (
  '66666666-6666-6666-6666-666666666666',
  '55555555-5555-5555-5555-555555555555',
  '22222222-2222-2222-2222-222222222222',
  'photo', 'ready', 'local-asset-001',
  'albums/5555/orig/6666.heic', 'image/heic', 4194304, now()
);

DO $$
BEGIN
  BEGIN
    INSERT INTO media_items (
      album_id, uploader_user_id, kind, client_media_id,
      storage_key, content_type, byte_size, capture_time
    ) VALUES (
      '55555555-5555-5555-5555-555555555555',
      '22222222-2222-2222-2222-222222222222',
      'photo', 'local-asset-001',
      'albums/5555/orig/dup.heic', 'image/heic', 4194304, now()
    );
    RAISE EXCEPTION 'FAIL: duplicate client_media_id created a second photo';
  EXCEPTION WHEN unique_violation THEN
    RAISE NOTICE 'ok  duplicate client_media_id rejected (declare is idempotent)';
  END;
END $$;

-- 6. Visibility derives ONLY from confirmed tags --------------------------
INSERT INTO faces (id, media_item_id, album_id, bbox_x, bbox_y, bbox_w, bbox_h, model_id)
VALUES ('77777777-7777-7777-7777-777777777777',
        '66666666-6666-6666-6666-666666666666',
        '55555555-5555-5555-5555-555555555555',
        0.3, 0.4, 0.2, 0.2, 'insightface:buffalo_l:1');

-- A merely SUGGESTED tag must not grant visibility.
INSERT INTO face_tags (media_item_id, album_id, face_id, user_id, source, status, similarity)
VALUES ('66666666-6666-6666-6666-666666666666',
        '55555555-5555-5555-5555-555555555555',
        '77777777-7777-7777-7777-777777777777',
        '11111111-1111-1111-1111-111111111111',
        'auto_match', 'suggested', 0.71);

DO $$
DECLARE n integer;
BEGIN
  SELECT count(*) INTO n FROM media_subjects
   WHERE media_item_id = '66666666-6666-6666-6666-666666666666';
  IF n <> 0 THEN
    RAISE EXCEPTION 'FAIL: a suggested tag granted visibility — an auto-match error could leak a photo';
  END IF;
  RAISE NOTICE 'ok  suggested tag grants no visibility';

  -- detected_face_count is maintained by trigger.
  SELECT detected_face_count INTO n FROM media_items
   WHERE id = '66666666-6666-6666-6666-666666666666';
  IF n <> 1 THEN
    RAISE EXCEPTION 'FAIL: detected_face_count is %, expected 1', n;
  END IF;
  RAISE NOTICE 'ok  detected_face_count trigger = 1';
END $$;

-- Confirming it DOES grant visibility.
UPDATE face_tags SET status = 'confirmed', decided_at = now()
 WHERE media_item_id = '66666666-6666-6666-6666-666666666666';

DO $$
DECLARE n integer;
BEGIN
  SELECT count(*) INTO n FROM media_subjects
   WHERE media_item_id = '66666666-6666-6666-6666-666666666666'
     AND user_id = '11111111-1111-1111-1111-111111111111';
  IF n <> 1 THEN
    RAISE EXCEPTION 'FAIL: confirming a tag did not create a subject row';
  END IF;
  RAISE NOTICE 'ok  confirmed tag grants visibility';
END $$;

-- Rejecting it withdraws visibility again.
UPDATE face_tags SET status = 'rejected' WHERE media_item_id = '66666666-6666-6666-6666-666666666666';

DO $$
DECLARE n integer;
BEGIN
  SELECT count(*) INTO n FROM media_subjects
   WHERE media_item_id = '66666666-6666-6666-6666-666666666666';
  IF n <> 0 THEN
    RAISE EXCEPTION 'FAIL: rejecting a tag left the subject row behind';
  END IF;
  RAISE NOTICE 'ok  rejected tag withdraws visibility';
END $$;

-- 7. The subject veto is absolute, and an EXISTS rather than a vote -------
INSERT INTO media_hides (media_item_id, album_id, user_id)
VALUES ('66666666-6666-6666-6666-666666666666',
        '55555555-5555-5555-5555-555555555555',
        '11111111-1111-1111-1111-111111111111');

DO $$
DECLARE hidden boolean;
BEGIN
  SELECT is_hidden INTO hidden FROM media_items WHERE id = '66666666-6666-6666-6666-666666666666';
  IF NOT hidden THEN
    RAISE EXCEPTION 'FAIL: one subject veto did not hide the photo';
  END IF;
  RAISE NOTICE 'ok  one veto hides the photo for everyone';

  -- A second subject also hiding it changes nothing; a veto is not a tally.
  INSERT INTO media_hides (media_item_id, album_id, user_id)
  VALUES ('66666666-6666-6666-6666-666666666666',
          '55555555-5555-5555-5555-555555555555',
          '33333333-3333-3333-3333-333333333333');
  SELECT is_hidden INTO hidden FROM media_items WHERE id = '66666666-6666-6666-6666-666666666666';
  IF NOT hidden THEN
    RAISE EXCEPTION 'FAIL: photo unhidden by a second veto';
  END IF;

  -- One subject undoing their own veto must NOT unhide it while another stands.
  UPDATE media_hides SET undone_at = now()
   WHERE media_item_id = '66666666-6666-6666-6666-666666666666'
     AND user_id = '11111111-1111-1111-1111-111111111111';
  SELECT is_hidden INTO hidden FROM media_items WHERE id = '66666666-6666-6666-6666-666666666666';
  IF NOT hidden THEN
    RAISE EXCEPTION 'FAIL: photo became visible while another subject''s veto was still active';
  END IF;
  RAISE NOTICE 'ok  remaining veto keeps the photo hidden';

  -- Only when every veto is withdrawn does it return.
  UPDATE media_hides SET undone_at = now()
   WHERE media_item_id = '66666666-6666-6666-6666-666666666666';
  SELECT is_hidden INTO hidden FROM media_items WHERE id = '66666666-6666-6666-6666-666666666666';
  IF hidden THEN
    RAISE EXCEPTION 'FAIL: photo stayed hidden after all vetoes were withdrawn';
  END IF;
  RAISE NOTICE 'ok  photo returns once all vetoes are withdrawn';
END $$;

-- 8. Allowlist grant shapes ----------------------------------------------
DO $$
BEGIN
  BEGIN
    INSERT INTO media_access_grants (scope, grantor_user_id, grantee_user_id, album_id)
    VALUES ('single_media', '11111111-1111-1111-1111-111111111111',
            '22222222-2222-2222-2222-222222222222',
            '55555555-5555-5555-5555-555555555555');
    RAISE EXCEPTION 'FAIL: single_media grant accepted without a media_item_id';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'ok  single_media grant requires a photo';
  END;

  BEGIN
    INSERT INTO media_access_grants (scope, grantor_user_id, grantee_user_id, album_id)
    VALUES ('all_media_of_grantor', '11111111-1111-1111-1111-111111111111',
            '11111111-1111-1111-1111-111111111111',
            '55555555-5555-5555-5555-555555555555');
    RAISE EXCEPTION 'FAIL: self-grant accepted';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'ok  self-grant rejected';
  END;
END $$;

-- 9. Job enqueue is idempotent -------------------------------------------
INSERT INTO media_jobs (kind, media_item_id, album_id)
VALUES ('thumbnail', '66666666-6666-6666-6666-666666666666',
        '55555555-5555-5555-5555-555555555555');

DO $$
BEGIN
  BEGIN
    INSERT INTO media_jobs (kind, media_item_id, album_id)
    VALUES ('thumbnail', '66666666-6666-6666-6666-666666666666',
            '55555555-5555-5555-5555-555555555555');
    RAISE EXCEPTION 'FAIL: duplicate outstanding job accepted';
  EXCEPTION WHEN unique_violation THEN
    RAISE NOTICE 'ok  duplicate job enqueue rejected';
  END;

  -- A different kind for the same media is legitimate.
  INSERT INTO media_jobs (kind, media_item_id, album_id)
  VALUES ('face', '66666666-6666-6666-6666-666666666666',
          '55555555-5555-5555-5555-555555555555');
  RAISE NOTICE 'ok  a different job kind is allowed';
END $$;

-- 10. pgvector actually works --------------------------------------------
DO $$
DECLARE sim double precision;
BEGIN
  UPDATE faces SET embedding = (SELECT array_agg(0.1::real)::vector FROM generate_series(1, 512))
   WHERE id = '77777777-7777-7777-7777-777777777777';

  SELECT 1 - (embedding <=> embedding) INTO sim FROM faces
   WHERE id = '77777777-7777-7777-7777-777777777777';
  IF sim IS NULL OR abs(sim - 1.0) > 1e-6 THEN
    RAISE EXCEPTION 'FAIL: cosine self-similarity was %, expected 1.0', sim;
  END IF;
  RAISE NOTICE 'ok  vector(512) stored and cosine distance works';

  BEGIN
    UPDATE faces SET embedding = '[1,2,3]'::vector
     WHERE id = '77777777-7777-7777-7777-777777777777';
    RAISE EXCEPTION 'FAIL: a 3-dimensional vector was accepted in a vector(512) column';
  EXCEPTION WHEN data_exception OR check_violation OR internal_error THEN
    RAISE NOTICE 'ok  wrong-dimension embedding rejected';
  END;
END $$;

-- Nothing is kept: this is an assertion suite, not a seed.
ROLLBACK;
