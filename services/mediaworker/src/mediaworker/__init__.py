"""Photu media worker.

Consumes `media_jobs` — the deliberately boring Go <-> Python contract table from
migration 00009 — and derives everything that has to happen to a photo after its
bytes land in S3.

M1 implements the `thumbnail` kind only: JPEG renditions plus EXIF capture time.
The `face` kind is M4 and is deliberately absent; see `worker.HANDLERS` for why a
worker asked to run it drops the kind instead of failing the jobs.
"""

__all__ = ["__version__"]

__version__ = "0.1.0"
