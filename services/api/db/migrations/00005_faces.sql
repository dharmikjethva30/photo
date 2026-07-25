-- +goose Up
-- Face detection, matching, and tagging.
--
-- LEGAL NOTE, not a stylistic one: a 512-d ArcFace embedding is biometric data.
-- GDPR Art. 9 requires explicit, separately-obtained consent (a ToS checkbox is
-- not enough), and BIPA / CUBI / HB1493 add written consent, a published retention
-- schedule, and privately-enforceable statutory damages.
--
-- Consequences visible in this schema:
--   * face_consents gates all processing and records the exact copy version shown
--   * embeddings and crops are hard-deletable, not soft-deletable — a deleted_at
--     on biometric data does not satisfy a GDPR erasure request
--   * face_clusters are scoped to ONE album. A cross-album face graph would turn a
--     photo app into a biometric identification system and change our regulatory
--     posture entirely.

-- Versioned, timestamped consent. Without a row here, nothing may be embedded.
CREATE TABLE face_consents (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  -- The identifier of the exact explanatory copy the user was shown. Needed to
  -- demonstrate what was actually consented to.
  copy_version   text NOT NULL,
  granted_at     timestamptz NOT NULL DEFAULT now(),
  revoked_at     timestamptz,
  -- Evidence of the consent event.
  ip             inet,
  user_agent     text
);

CREATE INDEX face_consents_user_idx ON face_consents (user_id, granted_at DESC);

-- The reference photo a member provides so albums can find them.
--
-- Stored in the SEPARATE face-data bucket with its own KMS key and retention rule,
-- which is what makes "delete my face data" a provable prefix delete.
CREATE TABLE face_references (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  storage_key  text NOT NULL,
  embedding    vector(512),
  -- Which model produced this embedding. Without it, a model upgrade silently
  -- compares vectors from different spaces, which is not an error — just wrong.
  model_id     text NOT NULL,
  -- Detector confidence and quality signals, used to reject a poor reference at
  -- capture time rather than producing bad matches later.
  det_score    real,
  created_at   timestamptz NOT NULL DEFAULT now(),
  -- Present so a user can retire a reference while keeping the row for audit.
  -- The ERASURE path hard-deletes; this is for ordinary replacement.
  deleted_at   timestamptz
);

CREATE INDEX face_references_user_idx ON face_references (user_id) WHERE deleted_at IS NULL;

-- Unknown-person clusters, per album. Members can claim or label them.
CREATE TABLE face_clusters (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  album_id    uuid NOT NULL REFERENCES albums (id) ON DELETE CASCADE,
  -- Running mean of member embeddings, used to place new faces cheaply.
  centroid    vector(512),
  -- Set when someone claims the cluster ("that's me") or labels it.
  claimed_by_user_id uuid REFERENCES users (id) ON DELETE SET NULL,
  label       text,
  face_count  integer NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX face_clusters_album_idx ON face_clusters (album_id);

CREATE TRIGGER face_clusters_set_updated_at
BEFORE UPDATE ON face_clusters
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- One row per detected face in one photo.
CREATE TABLE faces (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  media_item_id uuid NOT NULL REFERENCES media_items (id) ON DELETE CASCADE,
  album_id      uuid NOT NULL REFERENCES albums (id) ON DELETE CASCADE,

  -- Bounding box in normalised 0..1 coordinates, so it survives resizing.
  bbox_x        real NOT NULL,
  bbox_y        real NOT NULL,
  bbox_w        real NOT NULL,
  bbox_h        real NOT NULL,

  embedding     vector(512),
  model_id      text NOT NULL,

  -- Quality signals. Low-quality detections are FILTERED rather than matched at a
  -- lower threshold: lowering the threshold degrades accuracy unevenly across
  -- demographics, which is an ethics problem, not just a tuning one.
  det_score     real,
  blur_score    real,
  yaw           real,
  pitch         real,

  cluster_id    uuid REFERENCES face_clusters (id) ON DELETE SET NULL,
  crop_key      text,
  created_at    timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT faces_bbox_normalised CHECK (
    bbox_x >= 0 AND bbox_y >= 0 AND bbox_w > 0 AND bbox_h > 0
    AND bbox_x + bbox_w <= 1.001 AND bbox_y + bbox_h <= 1.001
  )
);

CREATE INDEX faces_media_idx ON faces (media_item_id);
CREATE INDEX faces_album_idx ON faces (album_id);
CREATE INDEX faces_cluster_idx ON faces (cluster_id) WHERE cluster_id IS NOT NULL;

-- HNSW with cosine distance.
--
-- NOTE: this index is for CLUSTER MAINTENANCE, where the candidate set is
-- album-wide. It is deliberately NOT how member matching works: matching compares
-- against at most 30 member references for one album, which is an exact scan of a
-- tiny filtered set at 100% recall. The planner correctly ignores HNSW there.
--
-- Embeddings are L2-normalised on write, so cosine and inner product rank
-- identically; cosine is used because `1 - distance` maps directly onto published
-- similarity thresholds.
CREATE INDEX faces_embedding_hnsw ON faces USING hnsw (embedding vector_cosine_ops);
CREATE INDEX face_clusters_centroid_hnsw ON face_clusters USING hnsw (centroid vector_cosine_ops);

-- Who is in a photo, and how confident we are.
CREATE TABLE face_tags (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  media_item_id uuid NOT NULL REFERENCES media_items (id) ON DELETE CASCADE,
  album_id      uuid NOT NULL REFERENCES albums (id) ON DELETE CASCADE,
  face_id       uuid REFERENCES faces (id) ON DELETE CASCADE,
  user_id       uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,

  source        face_tag_source NOT NULL,
  status        face_tag_status NOT NULL DEFAULT 'suggested',
  similarity    real,

  decided_by    uuid REFERENCES users (id) ON DELETE SET NULL,
  decided_at    timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),

  -- One tag per (face, person). A photo may contain the same person only once.
  CONSTRAINT face_tags_face_user_uk UNIQUE (face_id, user_id)
);

CREATE INDEX face_tags_media_idx ON face_tags (media_item_id);
-- Drives "Is this you in 12 photos?" — a member's pending confirmations.
CREATE INDEX face_tags_pending_idx ON face_tags (user_id, album_id) WHERE status = 'suggested';

-- media_subjects: the ONLY table that grants visibility under face-privacy.
--
-- Written exclusively from CONFIRMED face_tags, by trigger. This is the mechanism
-- that makes an automatic-matching error unable to leak a photo — a suggestion
-- never reaches this table.
--
-- It is also a performance denormalisation: the visibility predicate needs a
-- single index probe per candidate row, not a two-table join.
CREATE TABLE media_subjects (
  media_item_id uuid NOT NULL REFERENCES media_items (id) ON DELETE CASCADE,
  user_id       uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  album_id      uuid NOT NULL REFERENCES albums (id) ON DELETE CASCADE,
  created_at    timestamptz NOT NULL DEFAULT now(),

  PRIMARY KEY (media_item_id, user_id)
);

-- Serves both directions: "is the viewer a subject of this photo" and
-- "every photo this person appears in" (the Just-me filter and bulk grants).
CREATE INDEX media_subjects_user_album_idx ON media_subjects (user_id, album_id);

-- +goose StatementBegin
-- Keep media_subjects in lockstep with confirmed tags.
--
-- A trigger rather than application code, so a backfill, an admin fix, or a future
-- service cannot bypass it and leave visibility inconsistent with tags.
CREATE FUNCTION sync_media_subject() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  tgt_media uuid;
  tgt_user  uuid;
BEGIN
  IF TG_OP <> 'DELETE' AND NEW.status = 'confirmed' THEN
    INSERT INTO media_subjects (media_item_id, user_id, album_id)
    VALUES (NEW.media_item_id, NEW.user_id, NEW.album_id)
    ON CONFLICT DO NOTHING;
    RETURN NEW;
  END IF;

  tgt_media := COALESCE(OLD.media_item_id, NEW.media_item_id);
  tgt_user  := COALESCE(OLD.user_id, NEW.user_id);

  -- Only withdraw subjecthood when NO confirmed tag for this person remains on
  -- this photo. A photo can contain two detections of the same person; rejecting
  -- one must not remove their access to the photo.
  IF NOT EXISTS (
    SELECT 1 FROM face_tags ft
     WHERE ft.media_item_id = tgt_media
       AND ft.user_id = tgt_user
       AND ft.status = 'confirmed'
  ) THEN
    DELETE FROM media_subjects
     WHERE media_item_id = tgt_media AND user_id = tgt_user;
  END IF;

  RETURN COALESCE(NEW, OLD);
END $$;
-- +goose StatementEnd

CREATE TRIGGER face_tags_sync_subjects
AFTER INSERT OR UPDATE OF status OR DELETE ON face_tags
FOR EACH ROW EXECUTE FUNCTION sync_media_subject();

-- +goose StatementBegin
-- detected_face_count follows faces.
CREATE FUNCTION sync_face_count() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target uuid;
BEGIN
  target := COALESCE(NEW.media_item_id, OLD.media_item_id);
  UPDATE media_items
     SET detected_face_count = (SELECT count(*) FROM faces f WHERE f.media_item_id = target)
   WHERE id = target;
  RETURN COALESCE(NEW, OLD);
END $$;
-- +goose StatementEnd

CREATE TRIGGER faces_sync_count
AFTER INSERT OR DELETE ON faces
FOR EACH ROW EXECUTE FUNCTION sync_face_count();

-- +goose StatementBegin
CREATE FUNCTION sync_cluster_face_count() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target uuid;
BEGIN
  target := COALESCE(NEW.cluster_id, OLD.cluster_id);
  IF target IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  UPDATE face_clusters
     SET face_count = (SELECT count(*) FROM faces f WHERE f.cluster_id = target)
   WHERE id = target;
  RETURN COALESCE(NEW, OLD);
END $$;
-- +goose StatementEnd

CREATE TRIGGER faces_sync_cluster_count
AFTER INSERT OR UPDATE OF cluster_id OR DELETE ON faces
FOR EACH ROW EXECUTE FUNCTION sync_cluster_face_count();

-- +goose Down
DROP TRIGGER IF EXISTS faces_sync_cluster_count ON faces;
DROP FUNCTION IF EXISTS sync_cluster_face_count();
DROP TRIGGER IF EXISTS faces_sync_count ON faces;
DROP FUNCTION IF EXISTS sync_face_count();
DROP TRIGGER IF EXISTS face_tags_sync_subjects ON face_tags;
DROP FUNCTION IF EXISTS sync_media_subject();
DROP TABLE IF EXISTS media_subjects;
DROP TABLE IF EXISTS face_tags;
DROP TABLE IF EXISTS faces;
DROP TRIGGER IF EXISTS face_clusters_set_updated_at ON face_clusters;
DROP TABLE IF EXISTS face_clusters;
DROP TABLE IF EXISTS face_references;
DROP TABLE IF EXISTS face_consents;
