"""Assert the worker's hand-written SQL matches the schema the Go side owns.

This is the cross-language guard ADR 0001 calls for. The API generates typed
queries with sqlc, so a column rename breaks its build immediately; the worker
writes SQL by hand, so the same rename would only fail at runtime, on one photo,
in a log nobody is reading.

Deliberately checks columns rather than parsing the SQL: the point is to fail when
the schema moves, and enumerating what we depend on is clearer than a parser.
"""

from __future__ import annotations

import os

import psycopg
import pytest

# Every column the worker reads or writes. Keep in step with queue.py / derive.py.
REQUIRED: dict[str, set[str]] = {
    "media_jobs": {
        "id",
        "kind",
        "media_item_id",
        "album_id",
        "state",
        "priority",
        "attempts",
        "max_attempts",
        "last_error",
        "run_after",
        "locked_by",
        "locked_at",
        "finished_at",
    },
    "media_items": {
        "id",
        "album_id",
        "kind",
        "state",
        "storage_key",
        "content_type",
        "byte_size",
        "width",
        "height",
        # Written by the video path with the PROBED duration (the API stored a
        # client-declared one at upload).
        "duration_ms",
        "capture_time",
        "capture_time_exif",
        "capture_time_source",
        "timezone_offset_min",
        # NOT written by this worker — asserted present because the visibility
        # predicate depends on it and the face handler (M4) will set it.
        "face_proc_state",
    },
    "media_renditions": {
        "media_item_id",
        "name",
        "storage_key",
        "content_type",
        "width",
        "height",
        "byte_size",
    },
    # Written by the video path (derive._handle_video).
    "video_metadata": {
        "media_item_id",
        "codec",
        "bitrate",
        "frame_rate",
        "rotation_deg",
        "has_audio",
    },
    # Written by the face lane (faces.handle_face / embed_pending_references).
    "faces": {
        "id",
        "media_item_id",
        "album_id",
        "bbox_x",
        "bbox_y",
        "bbox_w",
        "bbox_h",
        "embedding",
        "model_id",
        "det_score",
        "blur_score",
        "yaw",
        "pitch",
        "crop_key",
    },
    "face_tags": {
        "media_item_id",
        "album_id",
        "face_id",
        "user_id",
        "source",
        "status",
        "similarity",
    },
    "face_references": {
        "id",
        "user_id",
        "storage_key",
        "embedding",
        "model_id",
        "det_score",
        "deleted_at",
    },
}

# Enum labels the worker writes as literals.
REQUIRED_ENUM_LABELS: dict[str, set[str]] = {
    "media_state": {"pending", "uploaded", "ready", "failed"},
    "job_state": {"queued", "running", "done", "failed"},
    "processing_state": {"queued", "running", "done", "failed"},
    # The face lane writes these literals; a rename would fail one photo at runtime.
    "face_tag_source": {"auto_match"},
    "face_tag_status": {"suggested"},
}


@pytest.fixture(scope="module")
def conn() -> psycopg.Connection:
    url = os.environ.get("DATABASE_URL")
    if not url:
        pytest.skip("DATABASE_URL not set; run `task up:infra && task migrate` first")
    with psycopg.connect(url) as c:
        yield c


@pytest.mark.parametrize("table", sorted(REQUIRED))
def test_required_columns_exist(conn: psycopg.Connection, table: str) -> None:
    with conn.cursor() as cur:
        cur.execute(
            "SELECT column_name FROM information_schema.columns "
            "WHERE table_schema = 'public' AND table_name = %s",
            (table,),
        )
        actual = {r[0] for r in cur.fetchall()}

    assert actual, f"table {table} does not exist — have migrations been applied?"

    missing = REQUIRED[table] - actual
    assert not missing, (
        f"{table} is missing {sorted(missing)}. The API's schema changed and the "
        f"worker's hand-written SQL still references these columns."
    )


@pytest.mark.parametrize("enum_name", sorted(REQUIRED_ENUM_LABELS))
def test_required_enum_labels_exist(conn: psycopg.Connection, enum_name: str) -> None:
    with conn.cursor() as cur:
        cur.execute(
            "SELECT e.enumlabel FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid "
            "WHERE t.typname = %s",
            (enum_name,),
        )
        actual = {r[0] for r in cur.fetchall()}

    assert actual, f"enum {enum_name} does not exist"
    missing = REQUIRED_ENUM_LABELS[enum_name] - actual
    assert not missing, f"enum {enum_name} is missing labels {sorted(missing)}"


def test_face_proc_state_defaults_to_queued(conn: psycopg.Connection) -> None:
    """The thumbnail worker must never mark face processing done.

    Under face-privacy, detected_face_count = 0 AND face_proc_state = 'done' means
    "no people detected", which makes a photo visible to the entire album. The
    default must stay 'queued' so an unprocessed photo fails closed. See ADR 0005.
    """
    with conn.cursor() as cur:
        cur.execute(
            "SELECT column_default FROM information_schema.columns "
            "WHERE table_name = 'media_items' AND column_name = 'face_proc_state'"
        )
        row = cur.fetchone()

    assert row is not None, "media_items.face_proc_state is missing"
    assert "queued" in (row[0] or ""), (
        f"face_proc_state defaults to {row[0]!r}, not 'queued'. An unprocessed photo "
        f"would be treated as having no people in it and shown to the whole album."
    )
