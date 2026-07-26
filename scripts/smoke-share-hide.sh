#!/usr/bin/env bash
# Subject controls end-to-end (M5): the hide-me veto and allowlist grants.
#
# Builds on the real face pipeline so "subject" means what it means in production —
# a CONFIRMED media_subjects row, not a fixture. Three people:
#   A owns a face album and uploads a group photo containing B.
#   B enrols a selfie, is auto-matched, and CONFIRMS -> B is a subject and sees it.
#   C is a plain member who does NOT appear -> sees nothing.
#
# Then it exercises B's controls over the one photo B appears in:
#   - single grant: B shows the photo to C; revoke hides it again
#   - bulk grant:   B shows C every photo of B in the album; revoke via the list
#   - hide-me:      B's veto removes the photo from EVERYONE's feed — B, the owner A,
#                   and C even while C holds a live grant (veto beats grant) — and
#                   unhiding restores it. A non-subject (C) cannot hide or grant.
#
# Needs the same services as smoke:faces-match. Run: task smoke:share-hide
set -euo pipefail

API="${API_BASE_URL:-http://localhost:8080}"
[ -f .env ] && { set -a; . ./.env; set +a; }
SP="${SP:-/private/tmp/claude-501/-Users-dharmikjethva-Desktop-photo/ebcc32c7-0fc1-40d2-b128-cffdd8fc276b/scratchpad}"

pass() { printf '\033[32m ok \033[0m %s\n' "$1"; }
fail() { printf '\033[31mFAIL\033[0m %s\n' "$1" >&2; exit 1; }
step() { printf '\n\033[36m==>\033[0m %s\n' "$1"; }

for c in curl jq; do command -v "$c" >/dev/null || fail "$c required"; done
curl -sf "$API/readyz" >/dev/null || fail "$API not up (task api)"

# Reuse the face-match asset generator: a real multi-face group photo + a selfie crop.
if [ ! -f "$SP/group.jpg" ] || [ ! -f "$SP/selfie.jpg" ]; then
  step "Generating test faces from InsightFace's sample image"
  ( cd services/mediaworker && SP="$SP" uv run python - <<'PY'
import os, warnings; warnings.filterwarnings("ignore")
import cv2
from insightface.app import FaceAnalysis
from insightface.data import get_image as ins_get_image
sp = os.environ["SP"]
app = FaceAnalysis(name="buffalo_l", providers=["CPUExecutionProvider"],
                   allowed_modules=["detection", "recognition"])
app.prepare(ctx_id=-1, det_size=(640, 640))
img = ins_get_image("t1")
faces = sorted(app.get(img), key=lambda f: -(f.bbox[2] - f.bbox[0]))
cv2.imwrite(f"{sp}/group.jpg", img)
f = faces[0]; x1, y1, x2, y2 = (int(v) for v in f.bbox)
px, py = int((x2 - x1) * 0.4), int((y2 - y1) * 0.4)
h, w = img.shape[:2]
cv2.imwrite(f"{sp}/selfie.jpg", img[max(0, y1-py):min(h, y2+py), max(0, x1-px):min(w, x2+px)])
PY
  ) >/dev/null 2>&1 || fail "could not generate test assets (is the face lane installed?)"
  pass "generated group.jpg + selfie.jpg"
fi

psql_() {
  docker compose exec -T postgres psql -qtAX -U "${POSTGRES_USER:-photu}" \
    -d "${POSTGRES_DB:-photu}" "$@" | tr -d '\r'
}
signin() { curl -sf -X POST "$API/v1/auth/apple" -H 'Content-Type: application/json' -d "{\"idToken\":\"$1\"}"; }
feed_count() { curl -sf "$API/v1/albums/$ALBUM/media" -H "Authorization: Bearer $1" | jq '.items|length'; }
upload() {
  local tok="$1" album="$2" cid="$3" file="$4" ctype="$5" bytes url mid d
  bytes=$(wc -c <"$file" | tr -d ' ')
  d=$(curl -sf -X POST "$API/v1/albums/$album/uploads" -H "Authorization: Bearer $tok" \
    -H 'Content-Type: application/json' \
    -d "{\"clientMediaId\":\"$cid\",\"contentType\":\"$ctype\",\"byteSize\":$bytes}")
  mid=$(echo "$d" | jq -r '.mediaId'); url=$(echo "$d" | jq -r '.upload.url')
  curl -sf -o /dev/null -X PUT -H "Content-Type: $ctype" --data-binary "@$file" "$url"
  curl -sf -X POST "$API/v1/uploads/$mid/complete" -H "Authorization: Bearer $tok" >/dev/null
  echo "$mid"
}

step "Three users: A (owner), B (appears + enrols selfie), C (plain member)"
A=$(signin "shA-$(date +%s)-$RANDOM" | jq -r '.accessToken')
B=$(signin "shB-$(date +%s)-$RANDOM" | jq -r '.accessToken')
C=$(signin "shC-$(date +%s)-$RANDOM" | jq -r '.accessToken')
BID=$(curl -sf -H "Authorization: Bearer $B" "$API/v1/me" | jq -r '.id')
CID=$(curl -sf -H "Authorization: Bearer $C" "$API/v1/me" | jq -r '.id')
curl -sf -X POST "$API/v1/me/face-consent" -H "Authorization: Bearer $B" >/dev/null
rd=$(curl -sf -X POST "$API/v1/me/face-references" -H "Authorization: Bearer $B" \
  -H 'Content-Type: application/json' \
  -d "{\"contentType\":\"image/jpeg\",\"byteSize\":$(wc -c <"$SP/selfie.jpg" | tr -d ' ')}")
RID=$(echo "$rd" | jq -r '.referenceId'); RURL=$(echo "$rd" | jq -r '.upload.url')
curl -sf -o /dev/null -X PUT -H 'Content-Type: image/jpeg' --data-binary "@$SP/selfie.jpg" "$RURL"
curl -sf -X POST "$API/v1/me/face-references/$RID/complete" -H "Authorization: Bearer $B" \
  -H 'Content-Type: application/json' -d '{"contentType":"image/jpeg"}' >/dev/null
pass "users ready (B=$BID, C=$CID)"

step "A creates a face album; B and C join; A uploads a group photo with B"
ALBUM=$(curl -sf -X POST "$API/v1/albums" -H "Authorization: Bearer $A" \
  -H 'Content-Type: application/json' \
  -d '{"title":"Share/hide test","template":"trip","privacyMode":"face"}' | jq -r '.id')
for T in "$B" "$C"; do
  CODE=$(curl -sf -X POST "$API/v1/albums/$ALBUM/invites" -H "Authorization: Bearer $A" \
    -H 'Content-Type: application/json' -d '{}' | jq -r '.code')
  curl -sf -X POST "$API/v1/invites/$CODE/accept" -H "Authorization: Bearer $T" >/dev/null
done
MID=$(upload "$A" "$ALBUM" "grp-1" "$SP/group.jpg" "image/jpeg")
for _ in $(seq 1 60); do
  st=$(psql_ -c "SELECT face_proc_state FROM media_items WHERE id='$MID'")
  [ "$st" = "done" ] && break; [ "$st" = "failed" ] && fail "face processing failed"; sleep 2
done
[ "$st" = "done" ] || fail "face_proc_state still '$st' — is a --kinds=face worker running?"
pass "photo $MID processed"

step "B confirms the suggestion -> B is a subject"
TAGID=$(curl -sf "$API/v1/albums/$ALBUM/my-suggested-tags" -H "Authorization: Bearer $B" \
  | jq -r --arg m "$MID" '.suggestions[] | select(.mediaId==$m) | .tagId' | head -1)
[ -n "$TAGID" ] && [ "$TAGID" != "null" ] || fail "B was not auto-suggested in the photo"
curl -sf -X POST "$API/v1/face-tags/$TAGID/confirm" -H "Authorization: Bearer $B" >/dev/null
[ "$(feed_count "$B")" = "1" ] || fail "B should see the photo after confirming"
[ "$(feed_count "$C")" = "0" ] || fail "C sees a photo they don't appear in — leak"
[ "$(feed_count "$A")" = "1" ] || fail "A (uploader) should see their own upload"
pass "B sees 1, C sees 0, A sees 1"

step "C cannot act on a photo they don't appear in"
hc=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$API/v1/media/$MID/hide" -H "Authorization: Bearer $C")
[ "$hc" = "404" ] || fail "C could hide a photo they're not in (HTTP $hc)"
gc=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$API/v1/media/$MID/grants" \
  -H "Authorization: Bearer $C" -H 'Content-Type: application/json' -d "{\"granteeUserId\":\"$BID\"}")
[ "$gc" = "404" ] || fail "C could grant a photo they're not in (HTTP $gc)"
pass "non-subject C gets 404 on hide and grant"

step "Single grant: B shows the photo to C, then revokes"
GID=$(curl -sf -X POST "$API/v1/media/$MID/grants" -H "Authorization: Bearer $B" \
  -H 'Content-Type: application/json' -d "{\"granteeUserId\":\"$CID\"}" | jq -r '.grantId')
[ -n "$GID" ] && [ "$GID" != "null" ] || fail "single grant did not return an id"
[ "$(feed_count "$C")" = "1" ] || fail "C should see the photo after the single grant"
pass "single grant -> C sees 1"
curl -sf -o /dev/null -X DELETE "$API/v1/grants/$GID" -H "Authorization: Bearer $B"
[ "$(feed_count "$C")" = "0" ] || fail "C still sees the photo after revoke"
pass "revoke -> C sees 0"

step "Bulk grant: B shows C every photo of B; revoke via the list"
curl -sf -X POST "$API/v1/albums/$ALBUM/grants" -H "Authorization: Bearer $B" \
  -H 'Content-Type: application/json' -d "{\"granteeUserId\":\"$CID\"}" >/dev/null
[ "$(feed_count "$C")" = "1" ] || fail "C should see the photo after the bulk grant"
BGID=$(curl -sf "$API/v1/albums/$ALBUM/grants" -H "Authorization: Bearer $B" \
  | jq -r '.grants[] | select(.scope=="all_media_of_grantor") | .grantId' | head -1)
[ -n "$BGID" ] && [ "$BGID" != "null" ] || fail "bulk grant not listed"
pass "bulk grant -> C sees 1 (listed as $BGID)"
curl -sf -o /dev/null -X DELETE "$API/v1/grants/$BGID" -H "Authorization: Bearer $B"
[ "$(feed_count "$C")" = "0" ] || fail "C still sees the photo after bulk revoke"
pass "bulk revoke -> C sees 0"

step "Hide-me: B's veto is absolute — even a live grant and the owner's feed lose it"
# Give C a live grant so we can prove the veto BEATS the grant.
curl -sf -X POST "$API/v1/media/$MID/grants" -H "Authorization: Bearer $B" \
  -H 'Content-Type: application/json' -d "{\"granteeUserId\":\"$CID\"}" >/dev/null
[ "$(feed_count "$C")" = "1" ] || fail "C should see the photo again (fresh grant)"
curl -sf -o /dev/null -X POST "$API/v1/media/$MID/hide" -H "Authorization: Bearer $B"
[ "$(psql_ -c "SELECT is_hidden FROM media_items WHERE id='$MID'")" = "t" ] \
  || fail "is_hidden trigger did not fire"
[ "$(feed_count "$B")" = "0" ] || fail "B still sees a photo they hid"
[ "$(feed_count "$A")" = "0" ] || fail "owner A still sees a hidden photo — veto not absolute"
[ "$(feed_count "$C")" = "0" ] || fail "C sees a hidden photo despite an active grant — veto must beat grant"
pass "hide -> nobody sees it (B, owner A, and granted C all 0)"

step "Unhide restores it (the grant is still live underneath)"
curl -sf -o /dev/null -X DELETE "$API/v1/media/$MID/hide" -H "Authorization: Bearer $B"
[ "$(feed_count "$B")" = "1" ] || fail "B should see the photo after unhiding"
[ "$(feed_count "$C")" = "1" ] || fail "C's grant should be honoured again after unhide"
pass "unhide -> B sees 1, C's grant honoured again"

echo
printf '\033[32m════ SHARE/HIDE SMOKE PASSED ════\033[0m\n'
echo "single grant · bulk grant · revoke · absolute veto (beats grant + owner) · unhide"
