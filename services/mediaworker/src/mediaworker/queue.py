"""The `media_jobs` claim loop.

`media_jobs` is the deliberate Go <-> Python contract (migration 00009). Go's own
background work uses river, but river's schema and encoding are Go-internal and
not a compatibility surface, so this table exists to be boring and hand-written on
both sides.

Concurrency model: one claim statement, `FOR UPDATE SKIP LOCKED`, no advisory
locks and no in-Python coordination. N workers can run against one database and
each row is handed to exactly one of them, because the lock is held by the same
statement that flips the row to 'running'. A claim that read first and updated
second would double-process under contention.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Any

import psycopg
from psycopg.rows import dict_row

log = logging.getLogger(__name__)

# The channel migration 00009's AFTER INSERT trigger notifies. The payload is the
# job kind; it is deliberately ignored (see wait()).
CHANNEL = "media_jobs"

# Claim exactly one job.
#
# The subselect is what makes this safe: SKIP LOCKED makes a concurrent worker
# step over an already-locked candidate instead of blocking on it, so throughput
# scales with worker count rather than serialising. ORDER BY matches
# media_jobs_claim_idx (kind, priority, run_after, id) so this is an index scan
# that stops at the first unlocked row, not a sort of the whole queue.
#
# attempts is incremented HERE, at claim time, not at failure time. A worker that
# is SIGKILLed mid-job never runs its failure path, and an attempt counter that
# only advanced on a clean failure would let a job that reliably crashes the
# process be retried forever.
_CLAIM = """
UPDATE media_jobs SET state='running', locked_by=%s, locked_at=now(), attempts=attempts+1
WHERE id = (SELECT id FROM media_jobs
             WHERE state='queued' AND kind = ANY(%s) AND run_after <= now()
             ORDER BY priority, run_after, id
             FOR UPDATE SKIP LOCKED LIMIT 1)
RETURNING *
"""

_FINISH_OK = """
UPDATE media_jobs
   SET state='done', finished_at=now()
 WHERE id = %s
"""

# One statement decides retry-vs-give-up so the decision cannot race with itself.
#
# `attempts` already includes this attempt (incremented at claim), so
# attempts >= max_attempts means this was the last one. last_error is kept on the
# 'done' path too (see _FINISH_OK): state is the authority on outcome, and the
# error from attempt 3 of 5 is the only record of why a photo was slow to appear.
_FINISH_ERR = """
UPDATE media_jobs
   SET state = CASE WHEN attempts >= max_attempts OR %(permanent)s
                    THEN 'failed'::job_state ELSE 'queued'::job_state END,
       last_error = %(err)s,
       run_after = now() + make_interval(secs => %(backoff)s),
       finished_at = CASE WHEN attempts >= max_attempts OR %(permanent)s
                         THEN now() ELSE NULL END,
       locked_by = NULL,
       locked_at = NULL
 WHERE id = %(id)s
RETURNING state, attempts, max_attempts
"""


class PermanentFailure(Exception):
    """A failure that retrying cannot fix — a missing original, or bytes Pillow
    cannot decode. Burning five attempts and 25 minutes of backoff on those only
    delays the point at which someone looks at the row."""


@dataclass(frozen=True)
class Job:
    id: int
    kind: str
    media_item_id: str
    album_id: str
    attempts: int
    max_attempts: int

    @classmethod
    def from_row(cls, row: dict[str, Any]) -> Job:
        return cls(
            id=row["id"],
            kind=row["kind"],
            media_item_id=str(row["media_item_id"]),
            album_id=str(row["album_id"]),
            attempts=row["attempts"],
            max_attempts=row["max_attempts"],
        )


class JobQueue:
    """Claim/complete over a single autocommit connection.

    Autocommit is required, not incidental: `LISTEN` only takes effect when the
    surrounding transaction commits, so a LISTEN issued inside an implicit
    transaction would silently never deliver. Handlers that need atomicity open an
    explicit `with conn.transaction()` block, which psycopg emits as a real
    BEGIN/COMMIT even in autocommit mode.

    One connection also means the claim and the handler's writes cannot deadlock
    against each other, and that a worker holds exactly one backend.
    """

    def __init__(
        self,
        conn: psycopg.Connection[Any],
        *,
        worker_id: str,
        kinds: list[str],
        backoff_base_seconds: float,
        backoff_max_seconds: float,
    ) -> None:
        self.conn = conn
        self.worker_id = worker_id
        self.kinds = kinds
        self._backoff_base = backoff_base_seconds
        self._backoff_max = backoff_max_seconds

    def listen(self) -> None:
        self.conn.execute(f"LISTEN {CHANNEL}")

    def claim(self) -> Job | None:
        with self.conn.cursor(row_factory=dict_row) as cur:
            cur.execute(_CLAIM, (self.worker_id, self.kinds))
            row = cur.fetchone()
        return Job.from_row(row) if row else None

    def finish_ok(self, job: Job) -> None:
        self.conn.execute(_FINISH_OK, (job.id,))

    def finish_err(self, job: Job, err: str, *, permanent: bool = False) -> str:
        """Record the failure and return the resulting job state."""
        params = {
            "id": job.id,
            # Postgres truncates nothing for us and a Pillow traceback can be long;
            # the first 2 KiB is the part anyone reads.
            "err": err[:2048],
            "backoff": self.backoff_seconds(job.attempts),
            "permanent": permanent,
        }
        with self.conn.cursor(row_factory=dict_row) as cur:
            cur.execute(_FINISH_ERR, params)
            row = cur.fetchone()
        return str(row["state"]) if row else "unknown"

    def backoff_seconds(self, attempts: int) -> float:
        """Exponential, clamped. Spreading retries matters more than the exact
        curve: the common failure is a dependency that is down for everyone, so
        every worker's retries must not land in the same instant."""
        delay = self._backoff_base * (2 ** max(attempts - 1, 0))
        return min(delay, self._backoff_max)

    def wait(self, timeout: float) -> bool:
        """Block until a job is announced or `timeout` elapses.

        The payload (the job kind) is deliberately not filtered on. A notification
        is only ever a hint to re-run the claim query, and the claim query is the
        authority on what this worker may take — filtering here would duplicate
        that decision in a second place, and would also miss the requeue-after-
        backoff case, which produces no notification at all. That is why the
        timeout exists: it is the floor on responsiveness, not a busy-poll.

        Returns True if something arrived, False on timeout.
        """
        for _ in self.conn.notifies(timeout=timeout, stop_after=1):
            return True
        return False
