"""S3 access for originals and derived renditions.

Only the INTERNAL endpoint is ever used here. ADR 0003's two-endpoint split exists
because SigV4 signs the Host header and a presigned URL's host cannot be rewritten
afterwards — but that is a *presigning* problem. This worker reads originals and
writes renditions server-side and never presigns, so there is deliberately no
public-endpoint client in this module (see the comment in config.Settings).
"""

from __future__ import annotations

import logging
from pathlib import Path

import boto3
from botocore.config import Config
from botocore.exceptions import ClientError

from .config import Settings

log = logging.getLogger(__name__)


class ObjectNotFound(Exception):
    """The key is absent. Distinct from a transport error, because retrying a
    missing original is pointless: the job is only enqueued after the API has
    already HeadObject-verified the bytes, so absent means deleted."""


class ObjectStore:
    def __init__(self, settings: Settings) -> None:
        self.media_bucket = settings.media_bucket

        cfg: dict[str, object] = {
            "region_name": settings.aws_region,
            # `standard` rather than boto3's default `legacy` mode: legacy does not
            # retry throttling responses, and a burst of 600 uploads finishing at
            # once is exactly when S3 throttles.
            "retries": {"max_attempts": 5, "mode": "standard"},
        }
        if settings.s3_use_path_style:
            # Mandatory against a custom endpoint. Virtual-host addressing would
            # resolve `photu-media-dev.localhost:4566`, which no resolver answers,
            # and the failure surfaces as a DNS error rather than as a config bug.
            cfg["s3"] = {"addressing_style": "path"}

        self._client = boto3.client(
            "s3",
            endpoint_url=settings.s3_endpoint_internal,
            aws_access_key_id=settings.aws_access_key_id,
            aws_secret_access_key=settings.aws_secret_access_key,
            config=Config(**cfg),  # type: ignore[arg-type]
        )

    def download(self, bucket: str, key: str, dest: Path) -> None:
        """Stream an object to `dest`.

        download_fileobj, not get_object().read(): originals are up to 100 MiB and
        a worker that buffers whole photos in memory falls over on the first album
        that finishes uploading in parallel.
        """
        try:
            with dest.open("wb") as fh:
                self._client.download_fileobj(bucket, key, fh)
        except ClientError as exc:
            code = exc.response.get("Error", {}).get("Code", "")
            # LocalStack and some S3-compatible stores answer with a bare 404
            # instead of a typed NoSuchKey, so check both.
            status = exc.response.get("ResponseMetadata", {}).get("HTTPStatusCode")
            if code in ("404", "NoSuchKey", "NotFound") or status == 404:
                raise ObjectNotFound(f"{bucket}/{key}") from exc
            raise

    def upload(self, bucket: str, key: str, src: Path, content_type: str) -> None:
        self._client.upload_file(str(src), bucket, key, ExtraArgs={"ContentType": content_type})

    def head(self, bucket: str, key: str) -> dict[str, object]:
        try:
            return self._client.head_object(Bucket=bucket, Key=key)
        except ClientError as exc:
            status = exc.response.get("ResponseMetadata", {}).get("HTTPStatusCode")
            if status == 404:
                raise ObjectNotFound(f"{bucket}/{key}") from exc
            raise


def rendition_key(album_id: str, media_id: str, name: str) -> str:
    """Mirror of s3store.RenditionKey in the Go API.

    Album-first prefixes make "delete album" a single-prefix delete. The two
    implementations MUST agree: the API builds this key to serve
    /media/{id}/thumb, so a divergence is a 404 on every image, and the schema
    conformance test cannot catch it because both sides are just strings.
    """
    return f"albums/{album_id}/rend/{media_id}/{name}.jpg"


def face_crop_key(album_id: str, face_id: str) -> str:
    """Mirror of s3store.FaceCropKey in the Go API.

    Face crops live in the FACEDATA bucket (own KMS key, own retention), album-scoped
    and keyed by face id so "delete album" and face-data erasure are both prefix deletes.
    """
    return f"albums/{album_id}/crops/{face_id}.jpg"
