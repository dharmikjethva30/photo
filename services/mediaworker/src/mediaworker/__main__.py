"""CLI entrypoint: `python -m mediaworker --kinds=thumbnail`."""

from __future__ import annotations

import argparse
import logging
import signal
import sys
from types import FrameType

from . import __version__, config, logs
from .worker import Worker, resolve_kinds

log = logging.getLogger(__name__)


def _parse_args(argv: list[str] | None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        prog="mediaworker",
        description="Photu media worker: derives renditions and EXIF from uploads.",
    )
    parser.add_argument(
        "--kinds",
        default="thumbnail",
        help=(
            "Comma-separated media_jobs.kind values to consume (default: thumbnail). "
            "Kinds this build cannot run are dropped with a warning and left queued."
        ),
    )
    parser.add_argument("--version", action="version", version=__version__)
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = _parse_args(argv)

    requested = [k.strip() for k in args.kinds.split(",") if k.strip()]
    if not requested:
        print("--kinds must name at least one job kind", file=sys.stderr)
        return 2

    try:
        settings = config.load()
    except Exception as exc:  # noqa: BLE001 - startup, before logging is configured
        # Printed rather than logged: a missing DATABASE_URL means the JSON handler
        # is not up yet, and a bare traceback for a config typo is user-hostile.
        print(f"configuration error: {exc}", file=sys.stderr)
        return 2

    logs.configure(settings.log_level)

    kinds = resolve_kinds(requested)
    if not kinds:
        # Exit non-zero: a supervisor asked for work this binary cannot do, and
        # idling forever would look healthy while the queue grew.
        log.error("no requested job kind is implemented", extra={"requested_kinds": requested})
        return 2

    worker = Worker(settings, kinds)

    def _shutdown(signum: int, _frame: FrameType | None) -> None:
        # Only sets a flag. The loop finishes the in-flight job and exits, so
        # shutdown latency is one job for a busy worker and at most
        # poll_timeout_seconds for an idle one.
        log.info("shutdown signal received", extra={"signal": signal.Signals(signum).name})
        worker.stop()

    # SIGTERM is what a container runtime sends; SIGINT is Ctrl-C in development.
    # Both must be graceful, because a killed worker leaves its job 'running' until
    # the reaper notices and the photo shows as processing for that whole window.
    signal.signal(signal.SIGTERM, _shutdown)
    signal.signal(signal.SIGINT, _shutdown)

    return worker.run()


if __name__ == "__main__":
    raise SystemExit(main())
