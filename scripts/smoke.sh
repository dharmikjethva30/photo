#!/usr/bin/env bash
# End-to-end gate for the walking skeleton.
#
# Drives the real HTTP API against real Postgres and real S3 (LocalStack):
#   sign in -> create album -> declare upload -> PUT bytes -> complete
#   -> read the feed -> follow the image redirect -> download the original
#
# THE LOAD-BEARING ASSERTION is the last one: the sha256 of the downloaded
# original must equal the sha256 of the file we uploaded, byte for byte. That is
# the regression test for the product's central promise — "original quality, no
# compression, ever". If anything in the pipeline ever re-encodes a photo, this
# fails.
#
# Run: task smoke   (requires `task up:infra`, `task migrate` and `task api`)
set -euo pipefail

API="${API_BASE_URL:-http://localhost:8080}"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

pass() { printf '\033[32m ok \033[0m %s\n' "$1"; }
fail() { printf '\033[31mFAIL\033[0m %s\n' "$1" >&2; exit 1; }
step() { printf '\n\033[36m==>\033[0m %s\n' "$1"; }

need() { command -v "$1" >/dev/null 2>&1 || fail "$1 is required"; }
need curl
need jq
need python3

# --- 0. the API is up ------------------------------------------------------
step "Checking the API"
curl -sf "$API/readyz" >"$TMP/ready.json" || fail "$API/readyz is not responding — is \`task api\` running?"
jq -e '.status == "ready"' "$TMP/ready.json" >/dev/null \
  || fail "API is not ready: $(cat "$TMP/ready.json")"
pass "API ready (postgres + s3)"

# --- 1. sign in ------------------------------------------------------------
# APP_ENV=local wires a fake verifier that accepts any token and derives a stable
# subject from it, so this needs no Apple or Google credentials. Outside local the
# fake is not wired at all — see auth.NewService.
step "Signing in"
SUBJECT="smoke-$(date +%s)-$RANDOM"
curl -sf -X POST "$API/v1/auth/apple" \
  -H 'Content-Type: application/json' \
  -d "{\"idToken\":\"$SUBJECT\"}" >"$TMP/session.json" \
  || fail "sign-in failed"

ACCESS=$(jq -r '.accessToken' "$TMP/session.json")
REFRESH=$(jq -r '.refreshToken' "$TMP/session.json")
USER_ID=$(jq -r '.user.id' "$TMP/session.json")
[ -n "$ACCESS" ] && [ "$ACCESS" != "null" ] || fail "no access token returned"
jq -e '.isNewUser == true' "$TMP/session.json" >/dev/null || fail "expected a new user"
pass "signed in as $USER_ID"

AUTH=(-H "Authorization: Bearer $ACCESS")

# --- 2. refresh rotation ---------------------------------------------------
# Rotation and reuse detection are the parts of the token model most likely to be
# broken by a later change, so they are exercised here rather than assumed.
step "Rotating the refresh token"
curl -sf -X POST "$API/v1/auth/refresh" \
  -H 'Content-Type: application/json' \
  -d "{\"refreshToken\":\"$REFRESH\"}" >"$TMP/refreshed.json" || fail "refresh failed"
ACCESS=$(jq -r '.accessToken' "$TMP/refreshed.json")
AUTH=(-H "Authorization: Bearer $ACCESS")
pass "refresh rotated"

# The old token is now spent. Presenting it again must fail AND revoke the family.
code=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$API/v1/auth/refresh" \
  -H 'Content-Type: application/json' -d "{\"refreshToken\":\"$REFRESH\"}")
[ "$code" = "401" ] || fail "reusing a rotated refresh token returned $code, expected 401"
pass "refresh-token reuse rejected"

# --- 3. profile ------------------------------------------------------------
step "Reading the profile"
curl -sf "${AUTH[@]}" "$API/v1/me" >"$TMP/me.json" || fail "GET /v1/me failed"
jq -e --arg id "$USER_ID" '.id == $id' "$TMP/me.json" >/dev/null || fail "wrong user"
jq -e '.freeAlbumsUsed == 0' "$TMP/me.json" >/dev/null || fail "expected 0 free albums used"
pass "profile reports 0 of $(jq -r '.freeAlbumsTotal' "$TMP/me.json") free albums used"

# --- 4. create an album ----------------------------------------------------
step "Creating an album"
curl -sf -X POST "$API/v1/albums" "${AUTH[@]}" \
  -H 'Content-Type: application/json' \
  -d '{"title":"Lisbon, March","template":"trip","privacyMode":"open"}' \
  >"$TMP/album.json" || fail "album creation failed"

ALBUM_ID=$(jq -r '.id' "$TMP/album.json")
[ -n "$ALBUM_ID" ] && [ "$ALBUM_ID" != "null" ] || fail "no album id returned"
jq -e '.memberCount == 1' "$TMP/album.json" >/dev/null \
  || fail "creator was not added as a member — they would see nothing in their own album"
pass "album $ALBUM_ID created, creator is a member"

# The free-album counter must have moved, server-side.
curl -sf "${AUTH[@]}" "$API/v1/me" >"$TMP/me2.json"
jq -e '.freeAlbumsUsed == 1' "$TMP/me2.json" >/dev/null \
  || fail "creating an album did not consume a free slot"
pass "one free slot consumed"

# --- 5. declare an upload --------------------------------------------------
step "Uploading a photo at original quality"

# A real JPEG, generated rather than committed so the repo carries no binary
# fixture. Deliberately noisy: a re-encode of a flat image could coincidentally
# produce identical bytes, which would make the byte-for-byte assertion vacuous.
python3 - "$TMP/original.jpg" <<'PY'
import sys, zlib, struct, random
path = sys.argv[1]
random.seed(1234)
# Minimal but valid JPEG via PIL if available; otherwise a PNG (also accepted).
try:
    from PIL import Image
    img = Image.new("RGB", (640, 480))
    px = img.load()
    for y in range(480):
        for x in range(640):
            px[x, y] = (random.randrange(256), random.randrange(256), random.randrange(256))
    img.save(path, "JPEG", quality=95)
except ImportError:
    # Hand-rolled PNG: no dependencies, still a real decodable image.
    path = path.replace(".jpg", ".png")
    w = h = 64
    raw = b"".join(
        b"\x00" + bytes(random.randrange(256) for _ in range(w * 3)) for _ in range(h)
    )
    def chunk(tag, data):
        return (struct.pack(">I", len(data)) + tag + data
                + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF))
    png = (b"\x89PNG\r\n\x1a\n"
           + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0))
           + chunk(b"IDAT", zlib.compress(raw))
           + chunk(b"IEND", b""))
    open(path, "wb").write(png)
print(path)
PY

FILE="$TMP/original.jpg"
CONTENT_TYPE="image/jpeg"
if [ ! -f "$FILE" ]; then
  FILE="$TMP/original.png"
  CONTENT_TYPE="image/png"
fi
[ -f "$FILE" ] || fail "could not generate a test image"

BYTES=$(wc -c <"$FILE" | tr -d ' ')
# Base64 sha256, the format S3 expects for x-amz-checksum-sha256.
SHA_B64=$(python3 -c "
import base64,hashlib,sys
print(base64.b64encode(hashlib.sha256(open(sys.argv[1],'rb').read()).digest()).decode())
" "$FILE")
SHA_HEX=$(python3 -c "
import hashlib,sys
print(hashlib.sha256(open(sys.argv[1],'rb').read()).hexdigest())
" "$FILE")
pass "test image: $BYTES bytes, sha256 ${SHA_HEX:0:16}…"

CLIENT_MEDIA_ID="smoke-asset-1"
curl -sf -X POST "$API/v1/albums/$ALBUM_ID/uploads" "${AUTH[@]}" \
  -H 'Content-Type: application/json' \
  -d "{\"clientMediaId\":\"$CLIENT_MEDIA_ID\",\"contentType\":\"$CONTENT_TYPE\",\"byteSize\":$BYTES,\"sha256\":\"$SHA_B64\",\"originalFilename\":\"$(basename "$FILE")\",\"width\":640,\"height\":480}" \
  >"$TMP/declare.json" || fail "upload declare failed"

MEDIA_ID=$(jq -r '.mediaId' "$TMP/declare.json")
PUT_URL=$(jq -r '.upload.url' "$TMP/declare.json")
[ -n "$PUT_URL" ] && [ "$PUT_URL" != "null" ] || fail "no presigned URL returned"
pass "declared media $MEDIA_ID"

# Idempotency: declaring the same client asset again must return the SAME media id,
# not create a duplicate photo. This is what makes background retry safe.
curl -sf -X POST "$API/v1/albums/$ALBUM_ID/uploads" "${AUTH[@]}" \
  -H 'Content-Type: application/json' \
  -d "{\"clientMediaId\":\"$CLIENT_MEDIA_ID\",\"contentType\":\"$CONTENT_TYPE\",\"byteSize\":$BYTES,\"sha256\":\"$SHA_B64\"}" \
  >"$TMP/declare2.json" || fail "second declare failed"
[ "$(jq -r '.mediaId' "$TMP/declare2.json")" = "$MEDIA_ID" ] \
  || fail "re-declaring the same clientMediaId created a DUPLICATE photo"
pass "declare is idempotent"

# --- 6. PUT the bytes straight to S3 --------------------------------------
# Bytes never pass through the API. The headers must be exactly what was signed.
PUT_ARGS=()
while IFS= read -r line; do PUT_ARGS+=(-H "$line"); done < <(
  jq -r '.upload.headers | to_entries[] | "\(.key): \(.value)"' "$TMP/declare.json"
)

# Guard the trap this script cannot otherwise explain.
#
# The API signs upload URLs for S3_ENDPOINT_PUBLIC, which `task api:emulator` sets
# to 10.0.2.2 and `task api:device` sets to the LAN IP — neither routable from this
# machine. The PUT then fails with curl code 000 (could not connect), which reads
# like S3 being down rather than a deliberately different target host. And the URL
# cannot simply be rewritten: SigV4 covers the Host header. See docs/adr/0003.
PUT_HOST=$(printf '%s' "$PUT_URL" | sed -E 's#^https?://([^/:]+).*#\1#')
case "$PUT_HOST" in
  localhost|127.0.0.1) : ;;
  *)
    fail "the API signed this upload for host '$PUT_HOST', which this machine cannot reach.
      That means the API is running in emulator or device mode. Restart it with
      \`task api\` (localhost) before running the smoke test." ;;
esac

code=$(curl -s -o "$TMP/put.out" -w '%{http_code}' -X PUT "${PUT_ARGS[@]}" \
  --data-binary "@$FILE" "$PUT_URL")
[ "$code" = "200" ] || fail "S3 PUT returned $code: $(head -c 400 "$TMP/put.out")"
pass "bytes uploaded directly to S3"

# --- 7. complete -----------------------------------------------------------
# The server HEADs the object and compares size and checksum against what was
# declared. This is the trust boundary.
step "Completing the upload"
curl -sf -X POST "$API/v1/uploads/$MEDIA_ID/complete" "${AUTH[@]}" \
  -H 'Content-Type: application/json' -d '{}' >"$TMP/complete.json" \
  || fail "complete failed — the server rejected what actually landed in S3"
jq -e '.state == "uploaded"' "$TMP/complete.json" >/dev/null \
  || fail "unexpected state: $(cat "$TMP/complete.json")"
pass "upload verified against S3 and marked uploaded"

# Idempotent: a retried complete is a success, not a conflict.
curl -sf -X POST "$API/v1/uploads/$MEDIA_ID/complete" "${AUTH[@]}" \
  -H 'Content-Type: application/json' -d '{}' >/dev/null \
  || fail "retrying complete failed; it must be idempotent"
pass "complete is idempotent"

# The processing job must exist, and must have been enqueued in the same
# transaction as the state change.
JOBS=$(docker compose exec -T postgres psql -U photu -d photu -tAc \
  "SELECT count(*) FROM media_jobs WHERE media_item_id = '$MEDIA_ID'" 2>/dev/null | tr -d '[:space:]')
[ "$JOBS" = "2" ] || fail "expected 2 queued jobs (thumbnail, face), found ${JOBS:-0}"
pass "thumbnail and face jobs enqueued"

# --- 8. the feed -----------------------------------------------------------
# The worker has not run yet, so the item is still 'uploaded' rather than 'ready'
# and MUST NOT appear: an unprocessed photo has zero detected faces, which under
# face-privacy would otherwise read as "no people in it".
step "Checking the feed"

# Assert "not-ready media is invisible" with a DECLARED-BUT-NEVER-UPLOADED item.
#
# This used to assert it against the item above, right after /complete — which
# raced the media worker, since it promotes an `uploaded` item to `ready` in
# milliseconds. A `pending` item is deterministic: the worker only ever claims jobs
# for completed uploads, so nothing can promote it out from under the assertion.
curl -sf -X POST "$API/v1/albums/$ALBUM_ID/uploads" "${AUTH[@]}" \
  -H 'Content-Type: application/json' \
  -d "{\"clientMediaId\":\"never-uploaded\",\"contentType\":\"$CONTENT_TYPE\",\"byteSize\":$BYTES}" \
  >"$TMP/pending.json" || fail "declare of the pending fixture failed"
PENDING_ID=$(jq -r '.mediaId' "$TMP/pending.json")

curl -sf "${AUTH[@]}" "$API/v1/albums/$ALBUM_ID/media" >"$TMP/feed_before.json" || fail "feed failed"
jq -e --arg id "$PENDING_ID" 'all(.items[]; .id != $id)' "$TMP/feed_before.json" >/dev/null \
  || fail "a photo whose bytes were never uploaded appeared in the feed.
      Unprocessed media has zero detected faces, which under face-privacy reads as
      'no people in it' — so it must stay invisible until it is ready."
pass "media that is not ready is absent from the feed"

# Wait for the REAL media worker. This is the end-to-end path: no faked renditions.
step "Waiting for the media worker"
ready=""
for _ in $(seq 1 30); do
  state=$(docker compose exec -T postgres psql -U photu -d photu -tAc \
    "SELECT state FROM media_items WHERE id = '$MEDIA_ID'" 2>/dev/null | tr -d '[:space:]')
  if [ "$state" = "ready" ]; then ready=1; break; fi
  sleep 1
done
[ -n "$ready" ] || fail "the photo never became ready after 30s.
      Is the media worker running? Start it with \`task mediaworker\`."
rends=$(docker compose exec -T postgres psql -U photu -d photu -tAc \
  "SELECT count(*) FROM media_renditions WHERE media_item_id = '$MEDIA_ID'" 2>/dev/null | tr -d '[:space:]')
[ "$rends" = "2" ] || fail "expected 2 renditions (thumb_256, preview_1024), found ${rends:-0}"
pass "worker generated 2 renditions and marked the photo ready"

# face_proc_state must still be 'queued': the face handler is M4, and setting it
# early would make every photo read as "no people detected" and be visible to the
# whole album under face-privacy.
fps=$(docker compose exec -T postgres psql -U photu -d photu -tAc \
  "SELECT face_proc_state FROM media_items WHERE id = '$MEDIA_ID'" 2>/dev/null | tr -d '[:space:]')
[ "$fps" = "queued" ] || fail "face_proc_state is '$fps', expected 'queued'.
      The thumbnail worker must NOT mark face processing done — see docs/adr/0005."
pass "face processing left queued (face-privacy stays fail-closed)"

curl -sf "${AUTH[@]}" "$API/v1/albums/$ALBUM_ID/media" >"$TMP/feed.json" || fail "feed failed"
jq -e '.items | length == 1' "$TMP/feed.json" >/dev/null \
  || fail "expected 1 feed item, got $(jq '.items | length' "$TMP/feed.json")"
jq -e --arg id "$MEDIA_ID" '.items[0].id == $id' "$TMP/feed.json" >/dev/null || fail "wrong item"
jq -e '.items[0].thumbUrl | startswith("http")' "$TMP/feed.json" >/dev/null \
  || fail "feed item has no thumb URL"
pass "processed photo appears in the feed with a stable thumb URL"

# --- 9. authorization on the image path -----------------------------------
step "Checking image authorization"
THUMB_URL=$(jq -r '.items[0].thumbUrl' "$TMP/feed.json")

# The stable URL must 302 rather than embed a presigned URL, so the image cache
# works AND authorization runs on every fetch.
code=$(curl -s -o /dev/null -w '%{http_code}' "${AUTH[@]}" "$THUMB_URL")
[ "$code" = "302" ] || fail "thumb URL returned $code, expected a 302 redirect"
pass "thumb URL redirects (302)"

# Without a token it must be refused.
code=$(curl -s -o /dev/null -w '%{http_code}' "$THUMB_URL")
[ "$code" = "401" ] || fail "an unauthenticated image request returned $code, expected 401"
pass "unauthenticated image request rejected"

# A DIFFERENT signed-in user who is not a member must get 404, not 403: a 403 would
# confirm the photo exists, which is what face-privacy protects.
curl -sf -X POST "$API/v1/auth/google" -H 'Content-Type: application/json' \
  -d "{\"idToken\":\"intruder-$RANDOM\"}" >"$TMP/intruder.json" || fail "second sign-in failed"
INTRUDER=$(jq -r '.accessToken' "$TMP/intruder.json")
code=$(curl -s -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $INTRUDER" "$THUMB_URL")
[ "$code" = "404" ] || fail "a non-member got $code for someone else's photo, expected 404"
pass "non-member gets 404 (not 403 — existence is not confirmed)"

# --- 10. byte-for-byte original ------------------------------------------
step "Verifying the original is byte-for-byte identical"
ORIGINAL_URL="${THUMB_URL%/*}/original"
curl -sfL "${AUTH[@]}" -o "$TMP/downloaded" "$ORIGINAL_URL" || fail "original download failed"

DOWNLOADED_HEX=$(python3 -c "
import hashlib,sys
print(hashlib.sha256(open(sys.argv[1],'rb').read()).hexdigest())
" "$TMP/downloaded")

[ "$DOWNLOADED_HEX" = "$SHA_HEX" ] || fail "ORIGINAL WAS MODIFIED.
  uploaded:   $SHA_HEX
  downloaded: $DOWNLOADED_HEX
  Something in the pipeline re-encoded or truncated the photo. The product's
  central promise is original quality with no compression, ever."
pass "original is byte-for-byte identical ($BYTES bytes)"

# --- 11. window and lifecycle enforcement --------------------------------
step "Checking upload-window enforcement"
docker compose exec -T postgres psql -U photu -d photu -q >/dev/null 2>&1 <<SQL
UPDATE albums SET state = 'locked', locked_at = now() WHERE id = '$ALBUM_ID';
SQL
code=$(curl -s -o "$TMP/locked.json" -w '%{http_code}' -X POST \
  "$API/v1/albums/$ALBUM_ID/uploads" "${AUTH[@]}" \
  -H 'Content-Type: application/json' \
  -d "{\"clientMediaId\":\"after-lock\",\"contentType\":\"$CONTENT_TYPE\",\"byteSize\":$BYTES}")
[ "$code" = "403" ] || fail "uploading to a locked album returned $code, expected 403"
jq -e '.type == "album_locked"' "$TMP/locked.json" >/dev/null \
  || fail "expected a stable album_locked error type, got $(cat "$TMP/locked.json")"
pass "locked album refuses uploads with a stable error type"

echo
printf '\033[32m════ SMOKE PASSED ════\033[0m\n'
echo "sign in -> album -> upload -> verify -> feed -> authorize -> byte-exact original"
