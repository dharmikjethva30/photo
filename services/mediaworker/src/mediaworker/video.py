"""Video probing and poster-frame extraction, via ffprobe/ffmpeg.

The product does NOT transcode (docs/adr, and the unit-economics risk in the plan):
transcoding 4K HEVC is the single most expensive thing the pipeline could do, and it
would violate "no compression ever". So a video's only derivatives are a poster frame
and the thumbnails made from it — everything a feed and a viewer need to show the video
without re-encoding a byte of it. Playback streams the original.

Face detection, when it lands (M4), runs on the poster frame only. Per-frame video face
detection is a scope trap; "you appear in this video" is poster-frame-accurate, and the
product should say so.
"""

from __future__ import annotations

import json
import logging
import subprocess
from dataclasses import dataclass
from pathlib import Path

from .queue import PermanentFailure

log = logging.getLogger(__name__)

# ffprobe/ffmpeg are given a hard wall-clock budget. A crafted file can make a decoder
# spin; the API already caps declared duration at 60s, so a probe or a single-frame
# extract that takes longer than this is pathological, not slow.
_PROBE_TIMEOUT_S = 30
_POSTER_TIMEOUT_S = 60


@dataclass(frozen=True)
class VideoFacts:
    duration_ms: int
    codec: str | None
    bitrate: int | None
    frame_rate: float | None
    rotation_deg: int
    has_audio: bool
    width: int | None
    height: int | None


def probe(ffprobe_path: str, path: Path) -> VideoFacts:
    """Read container/stream facts with ffprobe.

    Everything is best-effort EXCEPT duration: a video with no readable duration cannot
    be size/cap-checked and is rejected, because the alternative is trusting the
    client's declared number, which is the thing this probe exists to verify.
    """
    out = _run(
        [
            ffprobe_path,
            "-v",
            "error",
            "-print_format",
            "json",
            "-show_format",
            "-show_streams",
            str(path),
        ],
        timeout=_PROBE_TIMEOUT_S,
        what="ffprobe",
    )
    try:
        data = json.loads(out)
    except json.JSONDecodeError as exc:
        raise PermanentFailure(f"ffprobe returned non-JSON: {exc}") from exc

    streams = data.get("streams", [])
    video = next((s for s in streams if s.get("codec_type") == "video"), None)
    if video is None:
        raise PermanentFailure("no video stream in file")
    has_audio = any(s.get("codec_type") == "audio" for s in streams)

    duration_ms = _duration_ms(data.get("format", {}), video)
    if duration_ms is None:
        raise PermanentFailure("could not determine video duration")

    return VideoFacts(
        duration_ms=duration_ms,
        codec=video.get("codec_name"),
        bitrate=_int_or_none(data.get("format", {}).get("bit_rate")),
        frame_rate=_frame_rate(video.get("avg_frame_rate") or video.get("r_frame_rate")),
        rotation_deg=_rotation(video),
        has_audio=has_audio,
        width=_int_or_none(video.get("width")),
        height=_int_or_none(video.get("height")),
    )


def extract_poster(ffmpeg_path: str, src: Path, dest: Path, at_seconds: float) -> None:
    """Write one JPEG frame at `at_seconds` to `dest`.

    ffmpeg auto-applies the display matrix while decoding, so the frame is already
    upright — the rotation ffprobe reports is for metadata (video_metadata.rotation_deg)
    and for the player, not something to re-apply to this still.

    -ss BEFORE -i seeks by keyframe, which is fast and fine for a poster: a poster does
    not need to be the mathematically exact frame, just a representative one.
    """
    _run(
        [
            ffmpeg_path,
            "-nostdin",
            "-y",
            "-ss",
            f"{max(at_seconds, 0):.3f}",
            "-i",
            str(src),
            "-frames:v",
            "1",
            "-q:v",
            "2",
            str(dest),
        ],
        timeout=_POSTER_TIMEOUT_S,
        what="ffmpeg",
    )
    if not dest.exists() or dest.stat().st_size == 0:
        # ffmpeg can exit 0 having produced nothing if the seek lands past the last
        # frame. Retry once at the very start, which always has a frame.
        _run(
            [
                ffmpeg_path,
                "-nostdin",
                "-y",
                "-i",
                str(src),
                "-frames:v",
                "1",
                "-q:v",
                "2",
                str(dest),
            ],
            timeout=_POSTER_TIMEOUT_S,
            what="ffmpeg",
        )
    if not dest.exists() or dest.stat().st_size == 0:
        raise PermanentFailure("ffmpeg produced no poster frame")


def poster_timestamp(duration_ms: int) -> float:
    """Where to grab the poster: min(0.5s, halfway).

    Half a second in avoids the black/blurry opening frame most clips start with, but a
    sub-second clip has no half-second, so fall back to the midpoint.
    """
    half = duration_ms / 2000.0
    return min(0.5, half)


# --- helpers ---------------------------------------------------------------


def _run(cmd: list[str], *, timeout: int, what: str) -> str:
    try:
        proc = subprocess.run(
            cmd,
            capture_output=True,
            timeout=timeout,
            check=False,
        )
    except FileNotFoundError as exc:
        # A deployment problem, not a bad file: the binary is missing. Not a
        # PermanentFailure — a fixed deployment should let the job succeed on retry.
        raise RuntimeError(f"{what} not found on PATH ({cmd[0]})") from exc
    except subprocess.TimeoutExpired as exc:
        raise PermanentFailure(f"{what} timed out after {timeout}s") from exc

    if proc.returncode != 0:
        stderr = proc.stderr.decode("utf-8", "replace")[-500:]
        raise PermanentFailure(f"{what} failed (exit {proc.returncode}): {stderr}")
    return proc.stdout.decode("utf-8", "replace")


def _duration_ms(fmt: dict, video: dict) -> int | None:
    # Prefer the container duration; fall back to the stream's. Cheap phone clips
    # occasionally carry one but not the other.
    for source in (fmt.get("duration"), video.get("duration")):
        secs = _float_or_none(source)
        if secs is not None and secs > 0:
            return round(secs * 1000)
    return None


def _rotation(video: dict) -> int:
    # Two places rotation can live, depending on ffmpeg version: a Display Matrix side
    # data entry (newer) or a tags.rotate string (older). Normalise to [0, 360).
    for side in video.get("side_data_list", []) or []:
        if "rotation" in side:
            return round(float(side["rotation"])) % 360
    tag = video.get("tags", {}).get("rotate")
    val = _int_or_none(tag)
    return val % 360 if val is not None else 0


def _frame_rate(raw: str | None) -> float | None:
    # ffprobe reports frame rate as a rational string like "30000/1001".
    if not raw or "/" not in raw:
        return _float_or_none(raw)
    num, den = raw.split("/", 1)
    n, d = _float_or_none(num), _float_or_none(den)
    if n is None or not d:
        return None
    return round(n / d, 3)


def _int_or_none(v: object) -> int | None:
    try:
        return int(v)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return None


def _float_or_none(v: object) -> float | None:
    try:
        return float(v)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return None
