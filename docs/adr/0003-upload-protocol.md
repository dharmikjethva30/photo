# ADR 0003 — Original-quality upload protocol

**Status:** accepted · **Date:** 2026-07-25

## Context

"Original quality, no compression, ever" is the product's headline differentiator
against WhatsApp. Concretely: 4 MB HEIC stills, and 60-second 4K videos at
200–400 MB, uploaded from phones on unreliable networks and from browsers via a
magic link, with background upload and retry as P0 requirements.

## Decision

### Three-call protocol, direct to S3

Bytes never pass through Go. A 400 MB clip streamed through an API pod is memory,
timeout and cost for no benefit, and byte-identical delivery is the requirement.

1. **Declare** — `POST /v1/albums/{id}/uploads` with
   `{client_media_id, content_type, byte_size, sha256, capture_time, timezone_offset_min, width, height, duration_ms?}`.
   Authorize, validate, insert `media_items(state='pending')` + `upload_sessions`,
   return an upload plan.
2. **Upload** — client PUTs directly to S3. `byte_size <= 16 MiB` gets a single
   presigned PUT; larger gets multipart with `8 MiB` parts, presigned in batches
   of ~20 rather than all at once (a 400 MB file is 50 URLs; presigning all of
   them at once is both a large response and a wider credential window).
3. **Complete** — `POST /v1/uploads/{id}/complete`, in one transaction:
   `CompleteMultipartUpload`, then `HeadObject` to verify, then flip state and
   enqueue the media job.

### `client_media_id` makes declare idempotent

A unique index on `(album_id, client_media_id)` means a client that retries after
a dropped response gets the *same* `media_item_id` and session back, not a
duplicate photo. This is the single most important detail for background retry
and for the flaky-web-uploader edge case, and it is cheap.

### `HeadObject` verification is the trust boundary

On complete, assert `ContentLength == declared byte_size` and that the checksum
matches. Without this, `byte_size` is a client-controlled number that feeds quota
accounting and storage cost. Clients also set `x-amz-checksum-sha256` on upload so
S3 rejects corrupted parts server-side rather than us discovering it at decode
time.

### Resume is first-class, not a retry loop

`GET /v1/uploads/{id}` calls `ListParts` and returns `{completed, missing}`; the
client re-uploads only gaps. A dropped connection costs one 8 MiB part, not the
file. This *is* the answer to the spec's "web uploader on poor connectivity" edge
case: the browser holds a `File`, slices it with `Blob.slice()`, and persists
progress in IndexedDB so a tab reload resumes.

### Part URLs are signed per-part WITH that part's SHA-256, so declare returns no URLs

This one is forced by S3, and it was discovered the hard way — the first
implementation worked perfectly against LocalStack and would have failed in
production.

The multipart upload is created with `ChecksumAlgorithm: SHA256`, so S3 requires an
`x-amz-checksum-sha256` header on **every** `UploadPart`. SigV4 rejects any `x-amz-*`
header that the signature did not cover: *"There were headers present in the request
which were not signed."* So the checksum cannot be added by the client to a URL that
was signed without it — the value has to be baked in at signing time. **LocalStack
accepts the unsigned header**, which makes this exactly the class of
works-locally/fails-in-production divergence this ADR exists to prevent.

Three consequences, all of which shape the client:

1. **`POST /v1/albums/{id}/uploads` (declare) returns no part URLs at all** — only
   `{mediaId, uploadId, partSize, partCount}`. It cannot sign anything, because the
   client has not read a byte yet.
2. **`POST /v1/uploads/{id}/parts`** carries `[{partNumber, sha256}]` and returns the
   signed URLs. POST rather than GET because it has a body. One code path serves the
   first batch, later batches, and re-signing after expiry, instead of three.
3. **The client hashes each part as it slices it.** An 8 MiB hash is instant; hashing
   400 MB up front before the first byte moves would stall the upload.

Rejected alternative: S3's `FULL_OBJECT` checksum type, where the whole-object hash is
supplied once at completion and parts need no headers. Not available — `FULL_OBJECT`
works only with the composable CRC algorithms, and SHA-256 cannot be composed from
part hashes. (`CreateMultipartUpload` rejects the combination outright.)

### `/complete` takes no body, because the part list comes from S3

`CompleteMultipartUpload` also requires each part's checksum, and S3 is the only
party that has them all — it computed them on arrival. So completion calls `ListParts`
and uses that, exactly as resume does.

The payoff is on the client: **it never has to persist ETags.** Across an app kill it
needs only `{mediaId, uploadId}`, which is one fewer thing to lose and one fewer way
to assemble a corrupt object. A client may still report what it thinks it uploaded, and
then it is checked against S3 — treated as a claim to verify, never as input.

Corollary, and a bug this caused: `/complete` must **not** branch on whether the client
sent parts. Mode is a server-side fact (`upload_sessions.s3_upload_id`). Branching on
the body meant a correct multipart client that sent no parts fell into the single-PUT
path and got "we could not find those bytes" — the object had never been assembled.

### The client callback is authoritative; S3 events are not

Three reasons:

1. **LocalStack.** Community-edition S3→SQS notification support is the flakiest
   surface in the emulator: `CompleteMultipartUpload` delivery is unreliable and
   notification config is lost on restart without Pro persistence. A design whose
   happy path only works in production is worse than one that works identically
   everywhere.
2. Only the client knows the *semantic* completion of a Live Photo — two S3
   objects, one logical item. An S3 event per object needs a correlation table
   anyway.
3. Someone has to call `CompleteMultipartUpload`. If the API is already making
   that call, it already knows.

The gap this leaves — client dies after the last part PUT but before `/complete`
— is closed by a **reconciler cron** every 5 minutes: for
`state='pending' AND created_at < now() - 30 min`, `HeadObject`/`ListParts`, then
either complete server-side or abort and mark `failed`. If S3 events are ever
added in production, they become a *second* trigger into the same idempotent
completion routine, never the only one.

### Two buckets, and the split is compliance not tidiness

`photu-media-{env}` for originals, renditions and exports;
`photu-facedata-{env}` for face reference images and crops.

Separate buckets give face data its own KMS key, its own retention rule, its own
access policy, and — the one that matters — a `delete my face data` that is a
**provable prefix delete** rather than a scavenger hunt across a shared bucket.
Under GDPR we will be asked to demonstrate erasure.

Keys are album-prefixed (`albums/{album_id}/orig/{media_id}.{ext}`) so "delete
album" is a single-prefix delete and lifecycle transitions after lock are
album-scoped. **The original filename never appears in a key** — user-controlled
bytes in object keys is a slow-motion encoding bug.

### Stable image URLs, not presigned URLs, in API responses

Presigned GET URLs rotate their query string on every request, and `expo-image`
caches by URL — so returning presigned URLs directly means **zero cache hits and
the whole grid re-downloading on every screen focus.**

The API returns stable URLs (`GET /v1/media/{id}/thumb`) that run the *same*
visibility predicate and then `302` to a short-lived presigned URL. This keeps
authorization on every image fetch, which matters enormously once face-privacy
lands (ADR 0005). Presigned GETs are bearer tokens once issued: 5–15 minute TTL,
never logged in full, never embedded in a push payload or an email.

### Two S3 endpoints, because SigV4 signs the Host header

This is the trap that costs a day if found late. A presigned URL's host **cannot**
be rewritten after signing, and a physical device cannot resolve `localhost` or
the compose service name `localstack`. So the API builds two S3 clients:

| Client | Endpoint | Used for |
|---|---|---|
| `internal` | `http://localstack:4566` | `HeadObject`, `CompleteMultipartUpload`, `Delete` |
| `presign` | `http://<LAN_IP>:4566` | **only** `NewPresignClient` |

`UsePathStyle: true` whenever the endpoint is overridden — virtual-host style
resolves `photu-media-dev.localstack:4566`, which neither container DNS nor iOS
will answer. The flag is coupled to the override, not hardcoded, because real AWS
wants virtual-host style.

Related traps in the same area: iOS ATS needs `NSAllowsLocalNetworking` for
`http://` presigned PUTs in debug builds; iOS 14+ prompts for Local Network
permission and the first upload can fail silently without it; keep part-URL
expiry at **1 hour**, because a 400 MB video on hotel wifi outlives a 15-minute
presign and it surfaces as a `403` on part 37, which reads like a code bug.

## Consequences

- The M1 skeleton ships **single presigned PUT only**, with the multipart
  threshold configured above the test assets. Multipart, resume and
  background-session handoff land in M2. The envelope shape does not change, so
  M2 is purely additive — and resumable multipart plus the first end-to-end slice
  is too much for one step.
- An `AbortIncompleteMultipartUpload: 7 days` lifecycle rule is set on both
  buckets from day one. The protocol is deliberately resumable, so abandoned
  uploads are *normal*, and their parts are billed until aborted.
- CORS on the media bucket must expose `ETag`, or the browser multipart uploader
  can start uploads and never finish them, silently. Asserted by
  `scripts/verify-infra.sh`.
- `scripts/smoke.sh` asserts the round-tripped original's sha256 matches the
  input byte-for-byte. That is the "no compression ever" regression gate.
