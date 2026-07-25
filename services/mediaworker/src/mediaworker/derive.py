"""The `thumbnail` job: JPEG renditions plus EXIF capture time.

Renditions are not an optimisation. HEIC is the default iPhone format and nothing
on Android or in a browser can render it, so for a HEIC original the JPEG
rendition is the only way the photo can be displayed at all. "Download original"
hands over the untouched HEIC — which is why nothing in this module ever writes to
the original's key.
"""

from __future__ import annotations

import datetime as dt
import io
import logging
import tempfile
import warnings
from dataclasses import dataclass
from pathlib import Path
from typing import TYPE_CHECKING, Any

import pillow_heif
from PIL import Image, ImageCms, ImageOps, UnidentifiedImageError

from .queue import Job, PermanentFailure
from .store import ObjectNotFound, rendition_key

if TYPE_CHECKING:  # pragma: no cover - import cycle only matters to type checkers
    from .worker import Context

log = logging.getLogger(__name__)

# Registered once at import. Without this Pillow raises UnidentifiedImageError on
# every iPhone upload, which would look like corrupt bytes rather than a missing
# codec.
pillow_heif.register_heif_opener()

# Max edge in pixels, largest first. Each rendition is derived from the previous
# one rather than from the full-resolution decode: a second Lanczos pass over an
# already-downscaled image is visually indistinguishable and roughly free, while
# resampling 48 MP twice is not.
_RENDITIONS: tuple[tuple[str, int], ...] = (("preview_1024", 1024), ("thumb_256", 256))

# 82 is the knee of the quality/size curve for photographic content; above ~90 the
# file grows fast for differences nobody sees on a phone.
_JPEG_QUALITY = 82
_JPEG_CONTENT_TYPE = "image/jpeg"

# EXIF tag numbers, from the Exif sub-IFD (0x8769). Pillow's TAGS names are not
# stable enough to key on.
_IFD_EXIF = 0x8769
_TAG_DATETIME_ORIGINAL = 0x9003
_TAG_OFFSET_TIME_ORIGINAL = 0x9011


def configure_decoder(max_pixels: int) -> None:
    """Bound what an untrusted image is allowed to cost us.

    Two settings are needed, not one. MAX_IMAGE_PIXELS makes Pillow *warn* between
    the limit and 2x it, and only raise above 2x — so the limit alone lets a 2x
    decompression bomb through with a log line. Promoting the warning to an
    exception is what actually enforces the cap.
    """
    Image.MAX_IMAGE_PIXELS = max_pixels
    warnings.simplefilter("error", Image.DecompressionBombWarning)


# --- media_items lookup ----------------------------------------------------

_SELECT_ITEM = """
SELECT id, album_id, kind, state, storage_key, deleted_at
  FROM media_items
 WHERE id = %s
"""

_UPSERT_RENDITION = """
INSERT INTO media_renditions
       (media_item_id, name, storage_key, content_type, width, height, byte_size)
VALUES (%(media_item_id)s, %(name)s, %(storage_key)s, %(content_type)s,
        %(width)s, %(height)s, %(byte_size)s)
ON CONFLICT (media_item_id, name)
DO UPDATE SET storage_key = EXCLUDED.storage_key,
              content_type = EXCLUDED.content_type,
              width = EXCLUDED.width,
              height = EXCLUDED.height,
              byte_size = EXCLUDED.byte_size
"""

# Mirrors MarkMediaReady in services/api/db/queries/media.sql.
#
# CRITICAL — face_proc_state IS DELIBERATELY NOT SET HERE, and must not be.
#
# Under face-privacy (album_privacy_mode = 'face'), the visibility predicate in
# internal/adapter/postgres/visibility.go grants a photo to EVERY album member when
# `detected_face_count = 0 AND face_proc_state = 'done'` — that pair is how "no
# people are in this photo" is expressed. An unprocessed photo also has
# detected_face_count = 0, and this worker does not do face detection (that is M4).
# So setting face_proc_state = 'done' here would assert "no people detected" about
# every photo in the album, and make every photo in a face-privacy album visible to
# everyone. It stays 'queued' until the face worker exists. See docs/adr/0005.
#
# capture_time_exif uses COALESCE rather than assigning the parameter directly:
# a re-run for a photo whose EXIF failed to parse this time must not erase a time
# an earlier run did extract. (The Go MarkMediaReady assigns it unconditionally;
# that asymmetry is noted rather than copied.)
_MARK_READY = """
UPDATE media_items
   SET state = 'ready',
       width = %(width)s,
       height = %(height)s,
       capture_time_exif = COALESCE(%(capture_time_exif)s::timestamptz, capture_time_exif),
       capture_time = COALESCE(%(capture_time_exif)s::timestamptz, capture_time),
       capture_time_source = CASE
         WHEN %(capture_time_exif)s::timestamptz IS NOT NULL THEN 'exif'
         ELSE capture_time_source
       END,
       timezone_offset_min = COALESCE(%(timezone_offset_min)s::integer, timezone_offset_min)
 WHERE id = %(id)s
"""


@dataclass(frozen=True)
class Rendition:
    name: str
    key: str
    width: int
    height: int
    byte_size: int


@dataclass(frozen=True)
class ImageFacts:
    """What the pixels and their metadata say, after orientation is applied."""

    width: int
    height: int
    capture_time: dt.datetime | None
    timezone_offset_min: int | None


def handle_thumbnail(ctx: Context, job: Job) -> None:
    from psycopg.rows import dict_row

    with ctx.conn.cursor(row_factory=dict_row) as cur:
        cur.execute(_SELECT_ITEM, (job.media_item_id,))
        item = cur.fetchone()

    if item is None or item["deleted_at"] is not None:
        # The row went away between enqueue and claim (album deleted, or the
        # uploader removed the photo). Nothing to derive, and failing the job would
        # just retry against a row that will never come back.
        log.info("media item gone; nothing to derive", extra={"job_id": job.id})
        return

    if item["kind"] == "video":
        _handle_video(ctx, job, item)
        return

    album_id = str(item["album_id"])
    storage_key = item["storage_key"]

    # One temp dir per job, removed even on failure: the original plus two
    # renditions can be 150 MB, and a worker that leaks that per failed job fills
    # its disk in an afternoon.
    with tempfile.TemporaryDirectory(prefix="mediaworker-") as tmp:
        tmpdir = Path(tmp)
        original = tmpdir / "original"

        try:
            ctx.store.download(ctx.settings.media_bucket, storage_key, original)
        except ObjectNotFound as exc:
            raise PermanentFailure(f"original missing: {storage_key}") from exc

        facts, renditions = _render(original, tmpdir, album_id=album_id, media_id=job.media_item_id)

        for rend in renditions:
            ctx.store.upload(
                ctx.settings.media_bucket,
                rend.key,
                tmpdir / f"{rend.name}.jpg",
                _JPEG_CONTENT_TYPE,
            )

    # S3 first, then the database, and both rendition rows plus the state flip in
    # ONE transaction. A media_renditions row pointing at an object that does not
    # exist is a broken image for every viewer; an uploaded object with no row is
    # only garbage, which the lifecycle rule reaps. And a half-written pair —
    # thumb_256 committed, preview_1024 not — would make the API's rendition lookup
    # fail for the lightbox while the grid worked.
    with ctx.conn.transaction(), ctx.conn.cursor() as cur:
        for rend in renditions:
            cur.execute(
                _UPSERT_RENDITION,
                {
                    "media_item_id": job.media_item_id,
                    "name": rend.name,
                    "storage_key": rend.key,
                    "content_type": _JPEG_CONTENT_TYPE,
                    "width": rend.width,
                    "height": rend.height,
                    "byte_size": rend.byte_size,
                },
            )
        cur.execute(
            _MARK_READY,
            {
                "id": job.media_item_id,
                "width": facts.width,
                "height": facts.height,
                "capture_time_exif": facts.capture_time,
                "timezone_offset_min": facts.timezone_offset_min,
            },
        )

    log.info(
        "renditions written",
        extra={
            "job_id": job.id,
            "media_item_id": job.media_item_id,
            "width": facts.width,
            "height": facts.height,
            "capture_time_exif": facts.capture_time,
            "renditions": [r.name for r in renditions],
        },
    )


# --- video -----------------------------------------------------------------

# Video renditions all come from ONE poster frame — no transcode (docs/adr and the
# unit-economics risk: transcoding 4K HEVC is the most expensive thing we could add and
# violates "no compression ever"). thumb_256 feeds the grid exactly like a photo;
# `poster` is the still the player shows before playback and the frame M4 will run face
# detection on. Ordered largest-first, because _render derives each from the previous.
_VIDEO_RENDITIONS: tuple[tuple[str, int], ...] = (("poster", 1024), ("thumb_256", 256))

_UPSERT_VIDEO_METADATA = """
INSERT INTO video_metadata
       (media_item_id, codec, bitrate, frame_rate, rotation_deg, has_audio)
VALUES (%(media_item_id)s, %(codec)s, %(bitrate)s, %(frame_rate)s,
        %(rotation_deg)s, %(has_audio)s)
ON CONFLICT (media_item_id)
DO UPDATE SET codec = EXCLUDED.codec,
              bitrate = EXCLUDED.bitrate,
              frame_rate = EXCLUDED.frame_rate,
              rotation_deg = EXCLUDED.rotation_deg,
              has_audio = EXCLUDED.has_audio
"""

# Like _MARK_READY but also writes the PROBED duration. The API stored a
# client-declared duration_ms at upload; this replaces it with the real one, because
# the client's number is a hint and the probe is the truth.
_MARK_VIDEO_READY = """
UPDATE media_items
   SET state = 'ready',
       width = %(width)s,
       height = %(height)s,
       duration_ms = %(duration_ms)s
 WHERE id = %(id)s
"""


def _handle_video(ctx: Context, job: Job, item: Any) -> None:
    """Probe a video, extract a poster frame, and derive renditions from it.

    Nothing here re-encodes the video; the original is streamed for playback. The
    poster frame is the only pixels produced, and the thumbnails are made from it so a
    video sits in the feed grid identically to a photo.
    """
    from . import video

    album_id = str(item["album_id"])
    storage_key = item["storage_key"]

    with tempfile.TemporaryDirectory(prefix="mediaworker-vid-") as tmp:
        tmpdir = Path(tmp)
        original = tmpdir / "original"
        try:
            ctx.store.download(ctx.settings.media_bucket, storage_key, original)
        except ObjectNotFound as exc:
            raise PermanentFailure(f"original missing: {storage_key}") from exc

        facts = video.probe(ctx.settings.ffprobe_path, original)

        # The worker is the real cap: the API's check was against a client-declared
        # number. A clip over the limit is rejected rather than published.
        if facts.duration_ms > ctx.settings.max_video_duration_ms:
            raise PermanentFailure(
                f"video is {facts.duration_ms}ms, over the "
                f"{ctx.settings.max_video_duration_ms}ms cap"
            )

        poster = tmpdir / "poster-frame.jpg"
        video.extract_poster(
            ctx.settings.ffmpeg_path,
            original,
            poster,
            video.poster_timestamp(facts.duration_ms),
        )

        # Reuse the photo pipeline on the poster frame: sRGB conversion, alpha
        # flattening, metadata strip, the lot. The poster JPEG has no EXIF, so
        # capture_time comes back empty — the client hint already ordered the item.
        img_facts, renditions = _render(
            poster,
            tmpdir,
            album_id=album_id,
            media_id=job.media_item_id,
            specs=_VIDEO_RENDITIONS,
        )

        for rend in renditions:
            ctx.store.upload(
                ctx.settings.media_bucket,
                rend.key,
                tmpdir / f"{rend.name}.jpg",
                _JPEG_CONTENT_TYPE,
            )

    # One transaction: rendition rows, the video_metadata row, and the state flip. Same
    # reasoning as the photo path — a half-written set is a broken video for viewers.
    with ctx.conn.transaction(), ctx.conn.cursor() as cur:
        for rend in renditions:
            cur.execute(
                _UPSERT_RENDITION,
                {
                    "media_item_id": job.media_item_id,
                    "name": rend.name,
                    "storage_key": rend.key,
                    "content_type": _JPEG_CONTENT_TYPE,
                    "width": rend.width,
                    "height": rend.height,
                    "byte_size": rend.byte_size,
                },
            )
        cur.execute(
            _UPSERT_VIDEO_METADATA,
            {
                "media_item_id": job.media_item_id,
                "codec": facts.codec,
                "bitrate": facts.bitrate,
                "frame_rate": facts.frame_rate,
                "rotation_deg": facts.rotation_deg,
                "has_audio": facts.has_audio,
            },
        )
        cur.execute(
            _MARK_VIDEO_READY,
            {
                "id": job.media_item_id,
                # Displayed dimensions of the poster. For a rotated video the poster
                # frame is already upright (ffmpeg autorotates), so these match how the
                # video plays — which is what the grid needs to reserve the cell.
                "width": img_facts.width,
                "height": img_facts.height,
                "duration_ms": facts.duration_ms,
            },
        )

    log.info(
        "video processed",
        extra={
            "job_id": job.id,
            "media_item_id": job.media_item_id,
            "duration_ms": facts.duration_ms,
            "codec": facts.codec,
            "rotation_deg": facts.rotation_deg,
            "renditions": [r.name for r in renditions],
        },
    )


# --- decoding and resizing -------------------------------------------------


def _render(
    original: Path,
    outdir: Path,
    *,
    album_id: str,
    media_id: str,
    specs: tuple[tuple[str, int], ...] = _RENDITIONS,
) -> tuple[ImageFacts, list[Rendition]]:
    try:
        with Image.open(original) as src:
            exif = src.getexif()
            icc = src.info.get("icc_profile")

            # Orientation is BAKED IN here rather than passed through. An EXIF
            # Orientation tag on a stripped-metadata rendition would be lost, and
            # a rendition that relies on a tag it no longer carries displays
            # sideways in exactly the places renditions exist to serve.
            img = ImageOps.exif_transpose(src) or src
            img = _flatten_alpha(img)
            img = _to_srgb(img, icc)

            # Post-transpose dimensions, deliberately: these describe the image as
            # displayed, and they are what the client uses to reserve the grid cell
            # before the bytes arrive. Pre-transpose values would swap width and
            # height on every portrait phone photo and make the feed jump.
            facts = ImageFacts(
                width=img.width,
                height=img.height,
                **_capture_time(exif),
            )

            renditions: list[Rendition] = []
            work = img
            for name, edge in specs:
                # thumbnail() mutates in place and never upscales, so a 180px
                # original yields a 180px "thumb_256". Both rows still exist,
                # which is what the API's lookup requires.
                work = work.copy()
                work.thumbnail((edge, edge), Image.Resampling.LANCZOS)
                dest = outdir / f"{name}.jpg"
                _write_jpeg(work, dest)
                renditions.append(
                    Rendition(
                        name=name,
                        key=rendition_key(album_id, media_id, name),
                        width=work.width,
                        height=work.height,
                        byte_size=dest.stat().st_size,
                    )
                )
    except (
        UnidentifiedImageError,
        # Both, not one: Pillow raises the Error above 2x MAX_IMAGE_PIXELS and
        # the Warning (promoted to an exception by configure_decoder) between 1x
        # and 2x.
        Image.DecompressionBombError,
        Image.DecompressionBombWarning,
    ) as exc:
        # Not retryable: the bytes will not decode differently in ten minutes.
        raise PermanentFailure(f"undecodable image: {exc}") from exc
    except OSError as exc:
        # Pillow raises plain OSError for a truncated file, which is also what a
        # local disk error looks like. Treated as permanent because the byte range
        # was already checksum-verified by the API at upload time, so truncation
        # here means the stored object itself is bad.
        raise PermanentFailure(f"unreadable image: {exc}") from exc

    return facts, renditions


def _flatten_alpha(img: Image.Image) -> Image.Image:
    """Composite transparency onto white before JPEG encoding.

    JPEG has no alpha channel, and a bare convert("RGB") composites onto black —
    which turns a transparent-background PNG screenshot into a black rectangle.
    """
    if img.mode == "P" and "transparency" in img.info:
        img = img.convert("RGBA")
    if img.mode in ("RGBA", "LA"):
        flat = Image.new("RGB", img.size, (255, 255, 255))
        flat.paste(img, mask=img.getchannel("A"))
        return flat
    return img


def _to_srgb(img: Image.Image, icc: bytes | None) -> Image.Image:
    """Convert into sRGB, honouring the source ICC profile when there is one.

    iPhones shoot Display P3. Dropping that profile without converting does not
    just lose colour management, it actively wrong-renders: saturated reds and
    greens come out visibly duller because the same numbers mean a smaller gamut
    in sRGB. Renditions carry no profile afterwards, since untagged is defined to
    mean sRGB everywhere it matters and 3 KB of profile on a 12 KB thumbnail is
    not worth it.
    """
    if not icc:
        return img.convert("RGB")
    try:
        src_profile = ImageCms.getOpenProfile(io.BytesIO(icc))
        converted = ImageCms.profileToProfile(
            img, src_profile, ImageCms.createProfile("sRGB"), outputMode="RGB"
        )
    except (ImageCms.PyCMSError, OSError, ValueError) as exc:
        # A malformed profile must not cost us the rendition; a slightly-off colour
        # is a far better outcome than an unviewable photo.
        log.warning("icc conversion failed; falling back to raw RGB", exc_info=exc)
        return img.convert("RGB")
    return converted if converted is not None else img.convert("RGB")


def _write_jpeg(img: Image.Image, dest: Path) -> None:
    """Encode with ALL metadata stripped.

    frombytes() rather than save()ing `img` directly, and this is the load-bearing
    line for privacy: Pillow's JPEG writer pulls `exif`, `xmp`, `icc_profile`,
    `comment` and `photoshop` out of Image.info, and resizing an image carries
    Image.info along. So a plain save() of a resized phone photo would copy the GPS
    IFD — the precise location of someone's home — straight into a rendition that
    the whole album can fetch. A frombytes() image has no info dict at all, which
    makes the strip a property of the object rather than a list of keys someone has
    to remember to extend when Pillow learns a new marker.
    """
    bare = Image.frombytes(img.mode, img.size, img.tobytes())
    bare.save(dest, "JPEG", quality=_JPEG_QUALITY, optimize=True, progressive=True)


# --- EXIF ------------------------------------------------------------------


def _capture_time(exif: Image.Exif) -> dict[str, Any]:
    """Extract DateTimeOriginal / OffsetTimeOriginal.

    GPS (IFD 0x8825) is never read and never returned. media_items.exif is left
    NULL for the same reason: silently retaining where a photo was taken in a
    shared album is a privacy incident waiting to happen, and the schema comment
    says location must be an explicit product decision, not a side effect of
    having parsed the file.
    """
    empty: dict[str, Any] = {"capture_time": None, "timezone_offset_min": None}
    if not exif:
        return empty

    try:
        ifd = exif.get_ifd(_IFD_EXIF)
    except (OSError, ValueError, SyntaxError) as exc:
        log.warning("exif sub-ifd unreadable", exc_info=exc)
        return empty

    raw = ifd.get(_TAG_DATETIME_ORIGINAL)
    if not isinstance(raw, str):
        # Screenshots, forwarded images and anything re-encoded by a chat app
        # legitimately have no DateTimeOriginal. The client hint already ordered
        # the item; this is a fallback, not an error.
        return empty

    try:
        naive = dt.datetime.strptime(raw.strip(), "%Y:%m:%d %H:%M:%S")
    except ValueError:
        # All-zero dates ("0000:00:00 00:00:00") are common from cheap cameras.
        log.info("unparseable DateTimeOriginal", extra={"exif_datetime": raw})
        return empty

    offset_min = _offset_minutes(ifd.get(_TAG_OFFSET_TIME_ORIGINAL))
    if offset_min is None:
        # EXIF ≤ 2.31 has no offset tag, so wall-clock time is all there is. Stored
        # as if UTC: the instant is then wrong by the camera's true offset, but the
        # ORDER of one camera's photos — which is all media_feed_idx uses — is
        # exact, and a client rendering in UTC shows the original wall time. The
        # alternative, guessing an offset from the uploader's current timezone,
        # reorders a trip album against itself.
        return {
            "capture_time": naive.replace(tzinfo=dt.UTC),
            "timezone_offset_min": None,
        }

    tz = dt.timezone(dt.timedelta(minutes=offset_min))
    return {
        "capture_time": naive.replace(tzinfo=tz),
        "timezone_offset_min": offset_min,
    }


def _offset_minutes(raw: object) -> int | None:
    """Parse an EXIF OffsetTimeOriginal of the form "+05:30" / "-08:00"."""
    if not isinstance(raw, str):
        return None
    text = raw.strip()
    if len(text) != 6 or text[0] not in "+-" or text[3] != ":":
        return None
    try:
        hours, minutes = int(text[1:3]), int(text[4:6])
    except ValueError:
        return None
    if hours > 23 or minutes > 59:
        return None
    total = hours * 60 + minutes
    return -total if text[0] == "-" else total
