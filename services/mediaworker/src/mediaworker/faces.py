"""The `face` job: detect faces in a photo, embed them, and suggest who they are.

This is the engine behind face-privacy. For each album photo it:

  1. detects faces (SCRFD) and computes a 512-d ArcFace embedding per face,
  2. writes a `faces` row + uploads a crop to the facedata bucket,
  3. matches each face against the album MEMBERS' reference selfies and writes a
     SUGGESTED tag for a confident match,
  4. marks the photo's face_proc_state = 'done'.

Two invariants carry the product's trust promise (docs/adr/0005):

  - Auto-matching only ever SUGGESTS. media_subjects — the table that actually grants
    visibility — is written by a DB trigger from CONFIRMED tags only. So a matcher
    error can never leak a photo; the worst case is a suggestion someone declines.
  - detected_face_count is maintained by trigger from the faces rows, and
    face_proc_state flips to 'done' ONLY here. Until then the visibility predicate
    treats the photo as uploader-only (fail-closed), because "0 faces, not processed"
    must not read as "0 people, safe to show everyone".

Reference selfies are embedded lazily (embed_pending_references): the model is already
loaded, so a sweep each poll cycle embeds any reference whose embedding is still NULL,
which is what lets a member be matched and lets onboarding show the selfie as "ready".
"""

from __future__ import annotations

import logging
import tempfile
from pathlib import Path
from typing import TYPE_CHECKING, Any

import numpy as np

from .queue import Job, PermanentFailure
from .store import ObjectNotFound, face_crop_key

if TYPE_CHECKING:  # pragma: no cover
    from .worker import Context

log = logging.getLogger(__name__)

# The model is heavy (~300 MB, seconds to load) so it is initialised ONCE per process
# and reused across jobs. Lazy so a worker started with --kinds=thumbnail never pays
# for it.
_engine: Any = None


def _get_engine(ctx: Context) -> Any:
    global _engine
    if _engine is None:
        # Imported lazily: onnxruntime + insightface are only a dependency of the face
        # lane, and importing them costs real time and memory.
        from insightface.app import FaceAnalysis

        app = FaceAnalysis(
            name=ctx.settings.face_model_pack,
            providers=["CPUExecutionProvider"],
            allowed_modules=["detection", "recognition"],
        )
        # ctx_id=-1 selects CPU. det_size trades small-face recall for speed.
        size = ctx.settings.face_det_size
        app.prepare(ctx_id=-1, det_size=(size, size))
        _engine = app
        log.info("face model loaded", extra={"model": ctx.settings.face_model_id})
    return _engine


# --- SQL (hand-written, like derive.py) ------------------------------------

_SELECT_ITEM = """
SELECT id, album_id, kind, state, storage_key, deleted_at
  FROM media_items WHERE id = %s
"""

_INSERT_FACE = """
INSERT INTO faces
  (id, media_item_id, album_id, bbox_x, bbox_y, bbox_w, bbox_h,
   embedding, model_id, det_score, blur_score, yaw, pitch, crop_key)
VALUES
  (%(id)s, %(media_item_id)s, %(album_id)s, %(bx)s, %(by)s, %(bw)s, %(bh)s,
   %(embedding)s, %(model_id)s, %(det_score)s, %(blur)s, %(yaw)s, %(pitch)s, %(crop_key)s)
"""

# Suggested only, and idempotent on (face_id, user_id) so a re-run of the job does not
# duplicate or "un-decide" a tag a human already confirmed/rejected.
_INSERT_SUGGESTED_TAG = """
INSERT INTO face_tags
  (media_item_id, album_id, face_id, user_id, source, status, similarity)
VALUES
  (%(media_item_id)s, %(album_id)s, %(face_id)s, %(user_id)s,
   'auto_match', 'suggested', %(similarity)s)
ON CONFLICT (face_id, user_id) DO NOTHING
"""

_MARK_FACE_DONE = "UPDATE media_items SET face_proc_state = 'done' WHERE id = %s"

# Album members who have a usable reference embedding. The candidate set for matching a
# photo's faces is just this album's members — an exact scan at 100% recall over <=30
# vectors, microseconds, so the HNSW index is deliberately not used here.
_ALBUM_MEMBER_REFERENCES = """
SELECT r.user_id, r.embedding
  FROM face_references r
  JOIN album_members m ON m.user_id = r.user_id AND m.album_id = %(album_id)s AND m.state = 'active'
 WHERE r.deleted_at IS NULL AND r.embedding IS NOT NULL AND r.model_id = %(model_id)s
"""

_PENDING_REFERENCES = """
SELECT id, user_id, storage_key FROM face_references
 WHERE embedding IS NULL AND deleted_at IS NULL
 ORDER BY created_at
 LIMIT %s
"""

_SET_REFERENCE_EMBEDDING = """
UPDATE face_references
   SET embedding = %(embedding)s, det_score = %(det_score)s, model_id = %(model_id)s
 WHERE id = %(id)s AND embedding IS NULL
"""

_MARK_REFERENCE_FAILED = "UPDATE face_references SET det_score = -1 WHERE id = %s"


# --- the face job ----------------------------------------------------------


def handle_face(ctx: Context, job: Job) -> None:
    import cv2
    from psycopg.rows import dict_row

    with ctx.conn.cursor(row_factory=dict_row) as cur:
        cur.execute(_SELECT_ITEM, (job.media_item_id,))
        item = cur.fetchone()

    if item is None or item["deleted_at"] is not None:
        log.info("media gone; skipping face job", extra={"job_id": job.id})
        return
    if item["kind"] == "video":
        # Detection runs on the poster frame, which the thumbnail lane produced. For now
        # videos are marked processed with no faces rather than blocking the queue;
        # poster-frame detection is a follow-up. Marking done keeps fail-closed
        # behaviour correct (0 faces + done = only-zero-people rule, and a video with
        # people simply won't surface to them until that follow-up).
        with ctx.conn.cursor() as cur:
            cur.execute(_MARK_FACE_DONE, (job.media_item_id,))
        return

    album_id = str(item["album_id"])
    storage_key = item["storage_key"]

    with tempfile.TemporaryDirectory(prefix="mediaworker-face-") as tmp:
        original = Path(tmp) / "original"
        try:
            ctx.store.download(ctx.settings.media_bucket, storage_key, original)
        except ObjectNotFound as exc:
            raise PermanentFailure(f"original missing: {storage_key}") from exc

        img = cv2.imread(str(original))
        if img is None:
            # HEIC etc. that cv2 cannot read: fall back to Pillow -> RGB -> BGR.
            img = _read_with_pillow(original)
        if img is None:
            raise PermanentFailure("could not decode image for face detection")

        engine = _get_engine(ctx)
        detections = engine.get(img)

        # Members to match against (embedding their references first if needed).
        members = _load_member_references(ctx, album_id)

        h, w = img.shape[:2]
        crops: list[tuple[str, bytes]] = []
        rows: list[dict[str, Any]] = []
        tags: list[dict[str, Any]] = []

        for det in detections:
            if float(det.det_score) < ctx.settings.face_min_det_score:
                continue  # low-quality: drop rather than match at a lower bar
            import uuid as _uuid

            face_id = str(_uuid.uuid4())
            bx, by, bw, bh = _normalised_bbox(det.bbox, w, h)
            emb = _normed(det)
            crop_key = face_crop_key(album_id, face_id)
            crops.append((crop_key, _encode_crop(cv2, img, det.bbox)))
            yaw, pitch = _pose(det)
            rows.append(
                {
                    "id": face_id,
                    "media_item_id": job.media_item_id,
                    "album_id": album_id,
                    "bx": bx, "by": by, "bw": bw, "bh": bh,
                    "embedding": emb,
                    "model_id": ctx.settings.face_model_id,
                    "det_score": float(det.det_score),
                    "blur": None,
                    "yaw": yaw, "pitch": pitch,
                    "crop_key": crop_key,
                }
            )
            match = _best_match(emb, members, ctx.settings.face_match_threshold)
            if match is not None:
                user_id, sim = match
                tags.append(
                    {
                        "media_item_id": job.media_item_id,
                        "album_id": album_id,
                        "face_id": face_id,
                        "user_id": user_id,
                        "similarity": sim,
                    }
                )

        # Upload crops to the facedata bucket before the DB rows reference them.
        for key, jpg in crops:
            _upload_bytes(ctx, ctx.settings.facedata_bucket, key, jpg)

        # One transaction: faces + suggested tags + the state flip. A half-written set
        # would leave detected_face_count (trigger-maintained) disagreeing with the rows
        # and could mis-key the fail-closed visibility branch.
        with ctx.conn.transaction(), ctx.conn.cursor() as cur:
            for row in rows:
                cur.execute(_INSERT_FACE, row)
            for tag in tags:
                cur.execute(_INSERT_SUGGESTED_TAG, tag)
            cur.execute(_MARK_FACE_DONE, (job.media_item_id,))

    log.info(
        "faces processed",
        extra={
            "job_id": job.id,
            "media_item_id": job.media_item_id,
            "faces": len(rows),
            "suggested_tags": len(tags),
            "members_considered": len(members),
        },
    )


# --- reference embedding sweep ---------------------------------------------


def embed_pending_references(ctx: Context, limit: int = 20) -> int:
    """Embed reference selfies whose embedding is still NULL. Returns how many.

    Run each poll cycle by the face lane. Cheap when there is nothing to do (one
    indexed query returning no rows), and it is what makes a just-uploaded selfie
    become matchable — and show as "ready" in onboarding — without waiting for a photo
    upload to force it.
    """
    import cv2
    from psycopg.rows import dict_row

    with ctx.conn.cursor(row_factory=dict_row) as cur:
        cur.execute(_PENDING_REFERENCES, (limit,))
        pending = cur.fetchall()
    if not pending:
        return 0

    engine = _get_engine(ctx)
    done = 0
    for ref in pending:
        try:
            with tempfile.TemporaryDirectory(prefix="mediaworker-ref-") as tmp:
                path = Path(tmp) / "selfie"
                try:
                    ctx.store.download(ctx.settings.facedata_bucket, ref["storage_key"], path)
                except ObjectNotFound:
                    _fail_reference(ctx, ref["id"])
                    continue
                img = cv2.imread(str(path)) if path.exists() else None
                if img is None:
                    img = _read_with_pillow(path)
                faces = engine.get(img) if img is not None else []
        except Exception as exc:  # noqa: BLE001 — one bad selfie must not stop the sweep
            log.warning(
                "reference embed failed",
                extra={"reference_id": str(ref["id"]), "err": str(exc)},
            )
            _fail_reference(ctx, ref["id"])
            continue

        if not faces:
            # No usable face in the selfie. Mark it failed (det_score=-1) so the sweep
            # does not keep retrying it forever; the client can prompt for a better one.
            _fail_reference(ctx, ref["id"])
            continue

        best = max(faces, key=lambda f: float(f.det_score))
        with ctx.conn.cursor() as cur:
            cur.execute(
                _SET_REFERENCE_EMBEDDING,
                {
                    "id": ref["id"],
                    "embedding": _normed(best),
                    "det_score": float(best.det_score),
                    "model_id": ctx.settings.face_model_id,
                },
            )
        done += 1

    if done:
        log.info("embedded reference selfies", extra={"count": done})
    return done


def _load_member_references(ctx: Context, album_id: str) -> list[tuple[str, np.ndarray]]:
    # Make sure any pending references are embedded first, so a member who just
    # onboarded is matchable in this very photo.
    embed_pending_references(ctx)
    from psycopg.rows import dict_row

    with ctx.conn.cursor(row_factory=dict_row) as cur:
        cur.execute(
            _ALBUM_MEMBER_REFERENCES,
            {"album_id": album_id, "model_id": ctx.settings.face_model_id},
        )
        rows = cur.fetchall()
    out: list[tuple[str, np.ndarray]] = []
    for r in rows:
        out.append((str(r["user_id"]), _as_numpy(r["embedding"])))
    return out


def _as_numpy(v: Any) -> np.ndarray:
    """Normalise a pgvector value to a float32 ndarray.

    pgvector's psycopg loader returns a pgvector.Vector; other setups may hand back a
    list or an ndarray. to_numpy() covers the Vector case; np.asarray the rest.
    """
    if hasattr(v, "to_numpy"):
        v = v.to_numpy()
    return np.asarray(v, dtype=np.float32)


def _fail_reference(ctx: Context, reference_id: Any) -> None:
    with ctx.conn.cursor() as cur:
        cur.execute(_MARK_REFERENCE_FAILED, (reference_id,))


# --- small helpers ---------------------------------------------------------


def _normed(det: Any) -> np.ndarray:
    """L2-normalised 512-d embedding as float32, for cosine via a dot product."""
    emb = getattr(det, "normed_embedding", None)
    if emb is None:
        emb = det.embedding / (np.linalg.norm(det.embedding) + 1e-10)
    return np.asarray(emb, dtype=np.float32)


def _best_match(
    emb: np.ndarray, members: list[tuple[str, np.ndarray]], threshold: float
) -> tuple[str, float] | None:
    best_user, best_sim = None, -1.0
    for user_id, ref in members:
        sim = float(emb @ ref)  # both L2-normalised, so this is cosine similarity
        if sim > best_sim:
            best_user, best_sim = user_id, sim
    if best_user is not None and best_sim >= threshold:
        return best_user, best_sim
    return None


def _normalised_bbox(bbox: Any, w: int, h: int) -> tuple[float, float, float, float]:
    x1, y1, x2, y2 = (float(v) for v in bbox)
    # Clamp into frame and normalise to 0..1 so the box survives the client resizing
    # the image. The schema CHECK enforces this range.
    x1 = max(0.0, min(x1, w))
    y1 = max(0.0, min(y1, h))
    x2 = max(0.0, min(x2, w))
    y2 = max(0.0, min(y2, h))
    return x1 / w, y1 / h, max((x2 - x1) / w, 1e-4), max((y2 - y1) / h, 1e-4)


def _pose(det: Any) -> tuple[float | None, float | None]:
    pose = getattr(det, "pose", None)
    if pose is None or len(pose) < 2:
        return None, None
    # InsightFace pose is [pitch, yaw, roll].
    return float(pose[1]), float(pose[0])


def _encode_crop(cv2: Any, img: Any, bbox: Any) -> bytes:
    x1, y1, x2, y2 = (int(v) for v in bbox)
    h, w = img.shape[:2]
    # A little padding so the crop is a recognisable face thumbnail, clamped to frame.
    pad_x, pad_y = int((x2 - x1) * 0.2), int((y2 - y1) * 0.2)
    x1, y1 = max(0, x1 - pad_x), max(0, y1 - pad_y)
    x2, y2 = min(w, x2 + pad_x), min(h, y2 + pad_y)
    crop = img[y1:y2, x1:x2]
    ok, buf = cv2.imencode(".jpg", crop, [cv2.IMWRITE_JPEG_QUALITY, 82])
    return buf.tobytes() if ok else b""


def _upload_bytes(ctx: Context, bucket: str, key: str, data: bytes) -> None:
    if not data:
        return
    with tempfile.NamedTemporaryFile(suffix=".jpg") as tf:
        tf.write(data)
        tf.flush()
        ctx.store.upload(bucket, key, Path(tf.name), "image/jpeg")


def _read_with_pillow(path: Path) -> Any:
    """Decode via Pillow (HEIC etc.) and return a BGR ndarray cv2/InsightFace expects."""
    try:
        import pillow_heif
        from PIL import Image

        pillow_heif.register_heif_opener()
        with Image.open(path) as im:
            rgb = np.asarray(im.convert("RGB"))
        return rgb[:, :, ::-1].copy()  # RGB -> BGR
    except Exception:  # noqa: BLE001
        return None
