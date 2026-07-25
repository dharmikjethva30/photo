"""Structured logging, matched to the Go service's zerolog output.

One JSON object per line with the same `level`/`time`/`message` keys zerolog
emits, so both services can be read by one log pipeline without a second parser.
"""

from __future__ import annotations

import datetime as dt
import json
import logging
import sys
from typing import Any

# Attributes LogRecord always carries. Anything outside this set was passed by a
# call site via `extra=` and is therefore a field we want in the JSON.
# `vars()` returns a dict, and dict | set is a TypeError — take the KEYS before
# unioning. Getting this wrong crashes at import time, before any logging happens.
_RESERVED = frozenset(
    set(vars(logging.LogRecord("", 0, "", 0, "", None, None))) | {"message", "asctime", "taskName"}
)


class JSONFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        payload: dict[str, Any] = {
            "level": record.levelname.lower(),
            "time": dt.datetime.fromtimestamp(record.created, dt.UTC).isoformat(),
            "logger": record.name,
            "message": record.getMessage(),
        }
        for key, value in record.__dict__.items():
            if key not in _RESERVED:
                payload[key] = value
        if record.exc_info:
            # The formatted traceback, not just the message: a decode failure on
            # one photo out of 600 is only debuggable from the stack.
            payload["error"] = self.formatException(record.exc_info)
        return json.dumps(payload, default=str)


def configure(level: str) -> None:
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(JSONFormatter())

    root = logging.getLogger()
    root.handlers = [handler]
    root.setLevel(getattr(logging, level.upper(), logging.INFO))

    # botocore logs every request at DEBUG including signed URLs and headers. A
    # presigned URL is a bearer token; keep it out of the log even in debug runs.
    for noisy in ("botocore", "boto3", "urllib3", "s3transfer"):
        logging.getLogger(noisy).setLevel(logging.WARNING)
