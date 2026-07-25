#!/usr/bin/env bash
# HEIC and video end-to-end.
#
# HEIC is the iPhone default and nothing on Android or the web can render it, so the
# JPEG renditions are the ONLY way the photo is viewable — a correctness requirement,
# not an optimisation. Video is never transcoded (that would violate "no compression
# ever" and is the biggest cost line in the plan); its only derivatives are a poster
# frame and the thumbnails made from it, and playback streams the untouched original.
#
# What this proves:
#   HEIC  : upload -> worker decodes via libheif -> thumb+preview renditions -> ready,
#           and the stored original is byte-for-byte the HEIC that was sent.
#   video : upload -> worker probes real duration with ffprobe (the API's cap was on a
#           client-declared number) -> extracts a poster frame -> thumb+poster
#           renditions + a video_metadata row -> ready, original byte-for-byte intact.
#
# Needs: task up:infra, task api (host mode), task mediaworker, and ffmpeg on PATH.
# Run:   task smoke:media
set -euo pipefail

API="${API_BASE_URL:-http://localhost:8080}"
[ -f .env ] && { set -a; . ./.env; set +a; }
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

pass() { printf '\033[32m ok \033[0m %s\n' "$1"; }
fail() { printf '\033[31mFAIL\033[0m %s\n' "$1" >&2; exit 1; }
step() { printf '\n\033[36m==>\033[0m %s\n' "$1"; }

for c in curl jq python3 ffmpeg uv; do command -v "$c" >/dev/null || fail "$c is required"; done
curl -sf "$API/readyz" >/dev/null || fail "$API not responding — is \`task api\` running?"

psql_() {
  docker compose exec -T postgres psql -qtAX -U "${POSTGRES_USER:-photu}" \
    -d "${POSTGRES_DB:-photu}" "$@" | tr -d '\r'
}
s3_sha() { # bucket key -> sha256 of the stored object
  docker compose exec -T localstack sh -c \
    "awslocal s3api get-object --bucket '$1' --key '$2' /tmp/o >/dev/null && sha256sum /tmp/o | cut -d' ' -f1 && rm -f /tmp/o"
}
sha_local() { python3 -c "
import hashlib,sys
h=hashlib.sha256()
with open(sys.argv[1],'rb') as f:
    for b in iter(lambda: f.read(1<<20), b''): h.update(b)
print(h.hexdigest())" "$1"; }

# --- setup -----------------------------------------------------------------
step "Setting up"
curl -sf -X POST "$API/v1/auth/apple" -H 'Content-Type: application/json' \
  -d "{\"idToken\":\"media-$(date +%s)-$RANDOM\"}" >"$TMP/s.json" || fail "sign-in failed"
ACCESS=$(jq -r '.accessToken' "$TMP/s.json")
AUTH=(-H "Authorization: Bearer $ACCESS")
curl -sf -X POST "$API/v1/albums" "${AUTH[@]}" -H 'Content-Type: application/json' \
  -d '{"title":"Media test","template":"trip","privacyMode":"open"}' >"$TMP/al.json" \
  || fail "album creation failed"
ALBUM=$(jq -r '.id' "$TMP/al.json")
pass "album $ALBUM"

# upload_one <file> <contentType> <clientId> [durationMs] -> echoes mediaId
# Small assets, so always the single-PUT path (multipart is covered by smoke-multipart).
upload_one() {
  local file="$1" ctype="$2" cid="$3" dur="${4:-}"
  local bytes body
  bytes=$(wc -c <"$file" | tr -d ' ')
  body="{\"clientMediaId\":\"$cid\",\"contentType\":\"$ctype\",\"byteSize\":$bytes"
  [ -n "$dur" ] && body="$body,\"durationMs\":$dur"
  body="$body}"
  curl -sf -X POST "$API/v1/albums/$ALBUM/uploads" "${AUTH[@]}" \
    -H 'Content-Type: application/json' -d "$body" >"$TMP/d.json" || return 1
  local url mid
  mid=$(jq -r '.mediaId' "$TMP/d.json")
  url=$(jq -r '.upload.url' "$TMP/d.json")
  [ "$url" != "null" ] || { echo "expected a single-PUT url for $cid" >&2; return 1; }
  curl -sf -o /dev/null -X PUT -H "Content-Type: $ctype" --data-binary "@$file" "$url" || return 1
  curl -sf -X POST "$API/v1/uploads/$mid/complete" "${AUTH[@]}" >/dev/null || return 1
  echo "$mid"
}

wait_ready() { # mediaId -> waits up to ~40s for state=ready
  local mid="$1" state
  for _ in $(seq 1 40); do
    state=$(psql_ -c "SELECT state FROM media_items WHERE id='$mid'")
    [ "$state" = "ready" ] && return 0
    [ "$state" = "failed" ] && { echo "media $mid went to 'failed'" >&2; return 1; }
    sleep 1
  done
  echo "media $mid still '$state' after 40s — is \`task mediaworker\` running?" >&2
  return 1
}

# --- HEIC ------------------------------------------------------------------
step "HEIC end-to-end"
uv run --project services/mediaworker python - "$TMP/photo.heic" <<'PY'
import sys
from PIL import Image
import pillow_heif
pillow_heif.register_heif_opener()
# A real HEIC with genuine structure (a gradient), so libheif has something to decode.
img = Image.new("RGB", (2400, 1600))
px = img.load()
for y in range(img.height):
    for x in range(0, img.width, 8):
        px[x, y] = ((x * 255) // img.width, (y * 255) // img.height, 128)
        for k in range(1, 8):
            if x + k < img.width:
                px[x + k, y] = px[x, y]
img.save(sys.argv[1], "HEIF", quality=90)
PY
HEIC_SHA=$(sha_local "$TMP/photo.heic")
HEIC_ID=$(upload_one "$TMP/photo.heic" "image/heic" "heic-1") || fail "HEIC upload failed"
pass "uploaded HEIC ($(wc -c <"$TMP/photo.heic" | tr -d ' ') bytes) as $HEIC_ID"

wait_ready "$HEIC_ID" || fail "HEIC never became ready — libheif decode may be broken"
RENDS=$(psql_ -c "SELECT string_agg(name,',' ORDER BY name) FROM media_renditions WHERE media_item_id='$HEIC_ID'")
[ "$RENDS" = "preview_1024,thumb_256" ] \
  || fail "HEIC renditions were [$RENDS], expected preview_1024,thumb_256"
pass "worker decoded HEIC and wrote JPEG renditions: $RENDS"

# The original must be untouched — the whole point is the JPEG is a DERIVATIVE, the
# HEIC is preserved.
HEIC_KEY=$(psql_ -c "SELECT storage_key FROM media_items WHERE id='$HEIC_ID'")
[ "$(s3_sha "${MEDIA_BUCKET:-photu-media-dev}" "$HEIC_KEY")" = "$HEIC_SHA" ] \
  || fail "the stored HEIC original differs from what was uploaded"
pass "HEIC original preserved byte-for-byte; JPEG renditions are derivatives"

# --- video -----------------------------------------------------------------
step "Video end-to-end"
# A real 3-second H.264 clip with an audio stream, so the probe has codec/duration/audio
# to find. testsrc gives moving content; sine gives the audio stream. (No rotation: the
# legacy `rotate` metadata tag is dropped by ffmpeg 8 and injecting a display matrix from
# the CLI is not portable — rotation PARSING of both formats is covered by
# tests/test_video.py instead, so here rotation is expected to be 0.)
ffmpeg -nostdin -y -f lavfi -i testsrc=size=1280x720:rate=30:duration=3 \
  -f lavfi -i sine=frequency=440:duration=3 \
  -c:v libx264 -pix_fmt yuv420p -c:a aac \
  "$TMP/clip.mp4" >/dev/null 2>&1 || fail "ffmpeg could not build the test clip"
VID_BYTES=$(wc -c <"$TMP/clip.mp4" | tr -d ' ')
VID_SHA=$(sha_local "$TMP/clip.mp4")
pass "built a 3s H.264 test clip ($VID_BYTES bytes)"

# Declare a slightly-off client duration (2900) so we can prove the worker OVERWRITES it
# with the probed value rather than trusting the client.
VID_ID=$(upload_one "$TMP/clip.mp4" "video/mp4" "vid-1" 2900) || fail "video upload failed"
pass "uploaded video as $VID_ID (client-declared 2900ms)"

wait_ready "$VID_ID" || fail "video never became ready — ffprobe/ffmpeg path may be broken"

VRENDS=$(psql_ -c "SELECT string_agg(name,',' ORDER BY name) FROM media_renditions WHERE media_item_id='$VID_ID'")
[ "$VRENDS" = "poster,thumb_256" ] \
  || fail "video renditions were [$VRENDS], expected poster,thumb_256"
pass "worker extracted a poster and wrote renditions: $VRENDS"

# The probed duration must have replaced the client's hint. testsrc is exactly 3000ms.
DUR=$(psql_ -c "SELECT duration_ms FROM media_items WHERE id='$VID_ID'")
[ "$DUR" -ge 2950 ] && [ "$DUR" -le 3100 ] \
  || fail "probed duration was ${DUR}ms, expected ~3000 (and NOT the client's 2900)"
[ "$DUR" != "2900" ] || fail "duration is still the client-declared 2900 — worker did not probe"
pass "duration replaced with the PROBED value: ${DUR}ms"

# video_metadata must be populated from the probe.
read -r VCODEC VROT VAUDIO <<<"$(psql_ -c \
  "SELECT codec, rotation_deg, has_audio FROM video_metadata WHERE media_item_id='$VID_ID'" \
  | tr '|' ' ')"
[ "$VCODEC" = "h264" ] || fail "video_metadata.codec was '$VCODEC', expected h264"
[ "$VROT" = "0" ] || fail "video_metadata.rotation_deg was '$VROT', expected 0 for this clip"
[ "$VAUDIO" = "t" ] || fail "video_metadata.has_audio was '$VAUDIO', expected t (the clip has audio)"
pass "video_metadata populated from probe: codec=$VCODEC rotation=$VROT has_audio=$VAUDIO"

# Original streamed for playback must be untouched — no transcode.
VID_KEY=$(psql_ -c "SELECT storage_key FROM media_items WHERE id='$VID_ID'")
[ "$(s3_sha "${MEDIA_BUCKET:-photu-media-dev}" "$VID_KEY")" = "$VID_SHA" ] \
  || fail "the stored video original differs — something transcoded it"
pass "video original preserved byte-for-byte (no transcode)"

# The worker being the real duration cap is not asserted here: with the default 60s cap
# a running worker accepts any clip we can build quickly, so a shell assertion would be
# meaningless. The cap is a comparison in derive._handle_video against the PROBED
# duration, and that probe is unit-tested in tests/test_video.py; the "duration replaced
# with the probed value" check above already proves the worker probes rather than trusts
# the client, which is the fact the cap depends on.

echo
printf '\033[32m════ MEDIA SMOKE PASSED ════\033[0m\n'
echo "HEIC decoded to JPEG renditions · video probed + postered · originals byte-exact"
