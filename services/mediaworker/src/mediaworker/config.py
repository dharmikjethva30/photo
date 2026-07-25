"""Runtime configuration, read once at startup from the environment.

Deliberately the same env var names the Go API uses (see
services/api/internal/platform/config/config.go). Two names for one value is how
a worker ends up writing renditions into a bucket nobody reads.
"""

from __future__ import annotations

import os
import socket

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


def _default_worker_id() -> str:
    # Lands in media_jobs.locked_by, so it has to identify a *process*: two
    # workers on one host would otherwise be indistinguishable when a job is
    # stuck and someone is trying to work out which container to look at.
    return f"{socket.gethostname()}:{os.getpid()}"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        case_sensitive=False,
        # The env is shared with the Go service and the mobile tooling, so it
        # carries dozens of vars that are none of this worker's business.
        extra="ignore",
    )

    database_url: str
    log_level: str = "info"

    # The worker ONLY ever talks to the internal endpoint. ADR 0003's
    # two-endpoint split exists because SigV4 signs the Host header and a
    # presigned URL's host cannot be rewritten afterwards — but that is a
    # *presigning* problem, and this worker never presigns anything. It reads
    # originals and writes renditions server-side, so S3_ENDPOINT_PUBLIC is
    # deliberately not read here: having it available would only make it possible
    # to accidentally sign against an address this process cannot resolve.
    s3_endpoint_internal: str | None = None
    s3_use_path_style: bool = False

    aws_region: str = "us-east-1"
    aws_access_key_id: str | None = None
    aws_secret_access_key: str | None = None

    media_bucket: str
    # Not used until M4, but read here so a misconfigured deployment fails at
    # startup rather than on the first face job.
    facedata_bucket: str

    worker_id: str = Field(default_factory=_default_worker_id)

    # LISTEN wake-up timeout. Doubles as the shutdown latency ceiling for an idle
    # worker: SIGTERM arriving mid-wait is handled but the select() call still
    # runs out its remaining timeout before the loop notices.
    poll_timeout_seconds: float = 5.0

    # Retry backoff for a failed job: base * 2^(attempts-1), clamped. Ten seconds
    # is long enough that a flapping dependency is not hammered and short enough
    # that a transient S3 error does not leave a photo unviewable for minutes.
    backoff_base_seconds: float = 10.0
    backoff_max_seconds: float = 600.0

    # Decode cap for untrusted input. A 200-byte PNG can declare 60000x60000 and
    # Pillow will happily try to allocate it (a decompression bomb); this is the
    # ceiling in *pixels*, which is what actually bounds the allocation.
    # 80 MP is roughly 4x the largest phone sensor shipping today.
    max_image_pixels: int = 80_000_000

    # The video duration cap, in milliseconds. The API also enforces this at declare
    # time, but that value is CLIENT-DECLARED — the worker probes the real duration and
    # is the actual trust boundary. Same env var and default (60s) as the Go config's
    # MAX_VIDEO_DURATION_MS so the two cannot disagree.
    max_video_duration_ms: int = Field(default=60_000, alias="MAX_VIDEO_DURATION_MS")

    # ffmpeg/ffprobe binaries. On PATH by default; overridable for a container that
    # ships them elsewhere.
    ffprobe_path: str = "ffprobe"
    ffmpeg_path: str = "ffmpeg"


def load() -> Settings:
    return Settings()  # type: ignore[call-arg]  # values come from the environment
