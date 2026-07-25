# ADR 0005 — Face privacy is enforced in SQL, evaluated per request

**Status:** accepted · **Date:** 2026-07-25

## Context

Face-privacy is the feature the product's entire trust promise rests on. In
`face` mode a viewer may see only: photos they appear in, photos with no people
detected, and photos a subject explicitly shared with them. Plus: hidden photos
are hidden for everyone (absolute subject veto), and in `private` mode the
creator approves each photo first.

Get this wrong in the leaking direction and the product is over.

## Decision

### One SQL predicate, shared by every read path

The visibility rule lives in exactly one place —
`internal/adapter/postgres/visibility.go` — and is used by the feed, the
single-item endpoint, **and the image redirect handler**.

A hand-written "simpler" check on the detail endpoint is precisely how the two
paths diverge, and how a photo becomes fetchable-by-id while invisible in the
feed. The filter variants ("Just me", group-by-uploader, group-by-scene) compose
onto the same base predicate rather than forking it.

A pure-Go mirror (`internal/domain/access.VisibilityPolicy`) exists for unit
testing and is pinned to the SQL by a **conformance test**: 2 albums × 3 privacy
modes × {uploader, subject, non-subject, grantee-single, grantee-bulk,
member-without-face-reference, guest, owner} × {hidden, pending-approval,
still-processing}, asserted against both implementations with identical results.
That test is load-bearing; deliberately break a branch and confirm it fails.

### Visibility derives only from *confirmed* tags

`media_subjects` is the only table that grants visibility, and only
`face_tags.status = 'confirmed'` writes into it. Automatic matching produces
`'suggested'` tags, never confirmed ones.

This asymmetry is the most important property in the design: **a face-matching
error can never leak a photo.** The worst case is a wrong suggestion that someone
declines. It also turns the pgvector recall question from a privacy problem into a
UX problem — and the accepted UX cost is that face-privacy albums start nearly
empty for each viewer until tags are confirmed. The fix for that is a first-run
"confirm your photos" sheet, **not** a lower matching threshold.

### Fail closed

An unprocessed photo has `detected_face_count = 0`, which would otherwise read as
"no people detected — show everyone". So the zero-people branch also requires
`face_proc_state = 'done'`, and `'failed'` fails closed too. Until processing
completes, a photo is visible to its uploader only.

### Evaluate per request. No materialized ACL table.

At the product's actual scale — 600 items, 30 members, ~1,500 faces per album —
this is an index range scan on `(album_id, capture_time, id)` with a few index
probes per candidate row: sub-5 ms warm. Critically the cost is proportional to
rows *returned*, not album size, because `ORDER BY` matches the index and Postgres
stops early.

A materialized `photo_visibility(media_id, user_id)` table was rejected for two
reasons:

1. **It is a write amplifier that cannot actually cover the hard case.** One
   upload writes 30 rows. One tag confirmation rewrites rows. And a *bulk* grant
   ("show them all photos of me") cannot be materialized at all without a trigger
   on `media_subjects` reaching back into `media_access_grants` — a five-table
   trigger graph to accelerate a query that already runs in 5 ms.
2. **It changes the failure mode from slow to wrong.** A stale per-request query
   returns a fresh answer late. A stale materialized ACL shows a face-privacy
   photo to someone who must not see it. For a biometric-privacy feature, prefer
   the failure mode that is merely slow.

What *is* denormalized is small, single-row, single-writer, and maintained by
**triggers** rather than application code, so backfills and admin fixes cannot
skip it:

| Column/table | Derived from |
|---|---|
| `media_subjects` | confirmed `face_tags` |
| `media_items.detected_face_count` | `faces` |
| `media_items.is_hidden` | `EXISTS(active media_hides)` |

That last one answers the spec's "photo with multiple people where one hides
themselves" edge case completely: hiding is an `EXISTS`, not a vote. One subject's
veto removes the photo for the other subjects, for the photographer's feed, and
for the owner. Only `uploader_user_id` retains a private copy.

A nightly job re-derives all three for a sampled 1% of albums and alerts on
mismatch — cheap, and it catches a bad migration before a user does.

### When to revisit

Past ~20k items per album, or p99 feed latency over 50 ms. The upgrade path is
*not* an ACL table: it is a per-viewer cached page of ids keyed by
`(album_id, viewer_id, album_visibility_generation)`, where that generation is one
integer on `albums` bumped by any upload, tag, grant or hide. One integer gets
cache invalidation right; a trigger graph does not.

## Consequences

- Every image fetch costs an authorization check, which is why the API returns
  stable `/media/{id}/thumb` URLs that redirect rather than raw presigned URLs
  (ADR 0003).
- The full visibility predicate is wired in M1 **even though the skeleton album is
  `open` mode**. Retrofitting an ACL into two endpoints later is how they diverge.
- Face embeddings are biometric data under GDPR Art. 9 and BIPA. Consequences that
  belong to this decision: gate all face processing behind versioned, timestamped
  consent; keep face data in its own bucket with its own key; make
  `DELETE /v1/me/face-data` a **hard** delete of references, embeddings, tags,
  crops and centroids (a `deleted_at` on biometric data does not satisfy erasure);
  ship that deletion path in the same milestone as collection, not later; and keep
  `face_clusters` scoped to a single album, because a cross-album face graph turns
  a photo app into a biometric identification system and changes the regulatory
  posture entirely.
- Matching thresholds live in config, never in code. Published ArcFace numbers do
  not transfer across checkpoints, image quality, or demographics, and error rates
  are known to be uneven across skin tone, age and gender. Filter low-quality
  detections (`det_score`, blur, extreme yaw) rather than lowering the threshold,
  and store `model_id` on every embedding so a model upgrade is a re-embed
  migration rather than silent garbage comparisons.
