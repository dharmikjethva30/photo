"""The run loop and the kind -> handler table.

HANDLERS is the extension point. Adding the M4 `face` kind is one entry plus one
module; nothing in this file needs to know what a handler does, and in particular
the claim query already filters on the kinds this process registered, so a worker
fleet can be split into a fast thumbnail lane and a slow inference lane purely by
what each process is launched with.
"""

from __future__ import annotations

import logging
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

import psycopg

from .config import Settings
from .derive import configure_decoder, handle_thumbnail
from .faces import embed_pending_references, handle_face
from .queue import Job, JobQueue, PermanentFailure
from .store import ObjectStore

log = logging.getLogger(__name__)


@dataclass(frozen=True)
class Context:
    """What every handler is given. Passed explicitly rather than reached for via
    module globals, so a test can drive a handler against its own connection."""

    settings: Settings
    conn: psycopg.Connection[Any]
    store: ObjectStore


Handler = Callable[[Context, Job], None]

# The face lane (M4) needs a ~300 MB ONNX model, so it is a SEPARATE deployment
# (--kinds=face) from the fast thumbnail lane — 2 s inference must never block the
# grid. Auto-matching only ever suggests; media_subjects is trigger-written from
# CONFIRMED tags, so a matcher error cannot leak a photo (docs/adr/0005).
HANDLERS: dict[str, Handler] = {
    "thumbnail": handle_thumbnail,
    "face": handle_face,
}


def resolve_kinds(requested: list[str]) -> list[str]:
    """Keep only kinds this build can actually run.

    Dropping an unimplemented kind, rather than refusing to start or claiming its
    jobs, is what lets one launch command (`--kinds=thumbnail,face`) work across
    milestones. Claiming a `face` job with no handler would move it to 'running'
    and then fail it five times; leaving it queued means the M4 worker picks up
    the backlog when it ships.
    """
    kept, dropped = [], []
    for kind in requested:
        (kept if kind in HANDLERS else dropped).append(kind)
    if dropped:
        log.warning(
            "job kinds not implemented in this build; leaving them queued",
            extra={"dropped_kinds": dropped},
        )
    return kept


class Worker:
    def __init__(self, settings: Settings, kinds: list[str]) -> None:
        self.settings = settings
        self.kinds = kinds
        self._stopping = False

    def stop(self) -> None:
        """Signal-handler safe: sets a flag and returns.

        The in-flight job is deliberately allowed to finish. Aborting mid-way would
        leave the row 'running' until the stale-job reaper resets it, which is a
        minute of a photo showing as still-processing for a shutdown that could
        have been clean in two seconds.
        """
        self._stopping = True

    def run(self) -> int:
        configure_decoder(self.settings.max_image_pixels)

        # autocommit: LISTEN only takes effect when its transaction commits, so
        # inside an implicit transaction it would register and then never deliver.
        with psycopg.connect(self.settings.database_url, autocommit=True) as conn:
            # Register pgvector so face embeddings round-trip as numpy arrays: written
            # from a np.ndarray param and read back as one for cosine matching. Only the
            # face lane touches vectors, so a failure to register (older setups) is a
            # warning, not fatal, for a thumbnail-only worker.
            if "face" in self.kinds:
                try:
                    from pgvector.psycopg import register_vector

                    register_vector(conn)
                except Exception as exc:  # noqa: BLE001
                    log.warning("could not register pgvector types", extra={"err": str(exc)})

            store = ObjectStore(self.settings)
            ctx = Context(settings=self.settings, conn=conn, store=store)
            queue = JobQueue(
                conn,
                worker_id=self.settings.worker_id,
                kinds=self.kinds,
                backoff_base_seconds=self.settings.backoff_base_seconds,
                backoff_max_seconds=self.settings.backoff_max_seconds,
            )
            # LISTEN before the first claim, not after: a job inserted between the
            # two would otherwise be missed by the notification and wait out a full
            # poll timeout.
            queue.listen()

            log.info(
                "media worker started",
                extra={"worker_id": self.settings.worker_id, "kinds": self.kinds},
            )

            faces_enabled = "face" in self.kinds
            while not self._stopping:
                job = queue.claim()
                if job is None:
                    # Idle: embed any just-uploaded reference selfies so a member becomes
                    # matchable and onboarding can show the selfie as ready, without
                    # waiting for a photo upload to force it. Cheap when nothing pends.
                    if faces_enabled:
                        try:
                            embed_pending_references(ctx)
                        except Exception as exc:  # noqa: BLE001
                            log.warning("reference sweep failed", extra={"err": str(exc)})
                    queue.wait(self.settings.poll_timeout_seconds)
                    continue
                run_job(ctx, queue, job)

            log.info("media worker stopped", extra={"worker_id": self.settings.worker_id})
        return 0


def run_job(ctx: Context, queue: JobQueue, job: Job) -> None:
    """Execute one claimed job and record its outcome.

    Separate from the loop so the end-to-end test can drive exactly one cycle.
    """
    handler = HANDLERS[job.kind]
    try:
        handler(ctx, job)
    except PermanentFailure as exc:
        log.error(
            "job failed permanently",
            exc_info=exc,
            extra={"job_id": job.id, "media_item_id": job.media_item_id},
        )
        _record_failure(ctx, queue, job, exc, permanent=True)
    except Exception as exc:
        # Deliberately broad, and the only broad catch in the worker. One
        # undecodable photo, one S3 timeout, one unexpected Pillow edge case must
        # not take down a process that has 600 other photos to derive; the job's
        # own retry/backoff state is the correct place for the failure to live.
        # BaseException (KeyboardInterrupt, SystemExit) is NOT caught, so SIGINT
        # still stops the worker.
        log.error(
            "job failed; will retry",
            exc_info=exc,
            extra={"job_id": job.id, "media_item_id": job.media_item_id},
        )
        _record_failure(ctx, queue, job, exc, permanent=False)
    else:
        queue.finish_ok(job)


def _record_failure(
    ctx: Context, queue: JobQueue, job: Job, exc: BaseException, *, permanent: bool
) -> None:
    # A handler that failed part-way may have left its transaction aborted, in
    # which case every subsequent statement on the connection errors with
    # "current transaction is aborted". conn.transaction() unwinds itself on
    # exception, but a raw failed statement outside one does not.
    if ctx.conn.info.transaction_status == psycopg.pq.TransactionStatus.INERROR:
        ctx.conn.rollback()

    detail = f"{type(exc).__name__}: {exc}"
    state = queue.finish_err(job, detail, permanent=permanent)
    log.info(
        "job outcome recorded",
        extra={"job_id": job.id, "job_state": state, "attempts": job.attempts},
    )
