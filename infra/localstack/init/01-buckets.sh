#!/bin/sh
# Runs INSIDE the localstack container on every start, via the image's
# /etc/localstack/init/ready.d hook.
#
# This is why the host does not need the awslocal or localstack CLI: the image
# ships awslocal internally. Running on *every* start (not once) also means the
# buckets survive a container restart without LocalStack Pro's persistence.
set -eu

MEDIA_BUCKET="${MEDIA_BUCKET:-photu-media-dev}"
FACEDATA_BUCKET="${FACEDATA_BUCKET:-photu-facedata-dev}"

for b in "$MEDIA_BUCKET" "$FACEDATA_BUCKET"; do
  awslocal s3api create-bucket --bucket "$b" >/dev/null 2>&1 || true

  # Without this, every abandoned multipart upload keeps its parts — and the
  # upload protocol is deliberately resumable, so abandoned uploads are normal,
  # not exceptional. Mirrors the rule we set on the real buckets.
  awslocal s3api put-bucket-lifecycle-configuration --bucket "$b" \
    --lifecycle-configuration '{
      "Rules": [{
        "ID": "abort-incomplete-multipart",
        "Status": "Enabled",
        "Filter": {},
        "AbortIncompleteMultipartUpload": { "DaysAfterInitiation": 7 }
      }]
    }' >/dev/null 2>&1 || true
done

# CORS on the media bucket is REQUIRED for the magic-link web uploader, which
# PUTs parts directly to S3 from the browser.
#
# ExposeHeaders ETag is the subtle one: the browser must read each part's ETag to
# send back to POST /uploads/{id}/complete. Without the expose-header the value
# is present on the wire but invisible to JS, so multipart uploads can start and
# never finish — with no error anywhere. AllowedOrigins is "*" for local dev
# only; production pins it to the web origin.
awslocal s3api put-bucket-cors --bucket "$MEDIA_BUCKET" --cors-configuration '{
  "CORSRules": [{
    "AllowedOrigins": ["*"],
    "AllowedMethods": ["GET", "PUT", "POST", "HEAD"],
    "AllowedHeaders": ["*"],
    "ExposeHeaders": ["ETag", "x-amz-checksum-sha256"],
    "MaxAgeSeconds": 3000
  }]
}' >/dev/null 2>&1 || true

# The facedata bucket is never touched by a browser: face references are
# uploaded through the app and crops are written server-side. No CORS on
# purpose — it keeps the blast radius of a misconfiguration smaller.

echo "photu: buckets ready ($MEDIA_BUCKET, $FACEDATA_BUCKET)"
