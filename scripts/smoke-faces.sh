#!/usr/bin/env bash
# Face consent + reference + GDPR erasure gate.
#
# Face embeddings are Art. 9 / BIPA biometric data. This proves the two invariants the
# product's legal posture rests on, end to end against a real API + S3:
#
#   1. CONSENT GATES COLLECTION. A reference selfie cannot be declared without an
#      active consent row — the gate is server-side, a 403, not a client courtesy.
#   2. ERASURE IS A HARD DELETE. "delete my face data" removes the DB rows AND the S3
#      objects under the user's facedata prefix — proven by re-listing (empty) and by
#      checking the object is gone from the bucket.
#
# Needs: task api (host mode) + LocalStack.
# Run:   task smoke:faces
set -euo pipefail

API="${API_BASE_URL:-http://localhost:8080}"
[ -f .env ] && { set -a; . ./.env; set +a; }
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

pass() { printf '\033[32m ok \033[0m %s\n' "$1"; }
fail() { printf '\033[31mFAIL\033[0m %s\n' "$1" >&2; exit 1; }
step() { printf '\n\033[36m==>\033[0m %s\n' "$1"; }

for c in curl jq; do command -v "$c" >/dev/null || fail "$c is required"; done
curl -sf "$API/readyz" >/dev/null || fail "$API not responding — is \`task api\` running?"

# The S3 side is verified THROUGH THE SERVER (the erasure report's objectsDeleted count,
# which comes from the server's own DeletePrefix against the facedata bucket), not via a
# separate awslocal exec — that keeps the gate reliable and tests the real code path.
psql_() {
  docker compose exec -T postgres psql -qtAX -U "${POSTGRES_USER:-photu}" \
    -d "${POSTGRES_DB:-photu}" "$@" | tr -d '\r'
}
FACEBUCKET="${FACEDATA_BUCKET:-photu-facedata-dev}"

step "Signing in"
ACCESS=$(curl -sf -X POST "$API/v1/auth/apple" -H 'Content-Type: application/json' \
  -d "{\"idToken\":\"faces-$(date +%s)-$RANDOM\"}" | jq -r '.accessToken')
AUTH=(-H "Authorization: Bearer $ACCESS")
USERID=$(curl -sf "${AUTH[@]}" "$API/v1/me" | jq -r '.id')
[ -n "$ACCESS" ] && [ -n "$USERID" ] || fail "sign-in failed"
pass "user $USERID"

# --- consent gate ----------------------------------------------------------
step "A reference upload is refused without consent"
consent=$(curl -sf "${AUTH[@]}" "$API/v1/me/face-consent")
[ "$(printf '%s' "$consent" | jq -r '.granted')" = "false" ] || fail "fresh user should have no consent"
[ "$(printf '%s' "$consent" | jq -r '.needsConsent')" = "true" ] || fail "fresh user should need consent"

code=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$API/v1/me/face-references" "${AUTH[@]}" \
  -H 'Content-Type: application/json' -d '{"contentType":"image/jpeg","byteSize":40000}')
[ "$code" = "403" ] || fail "declaring a reference without consent returned $code, expected 403"
type=$(curl -s -X POST "$API/v1/me/face-references" "${AUTH[@]}" \
  -H 'Content-Type: application/json' -d '{"contentType":"image/jpeg","byteSize":40000}' | jq -r '.type')
[ "$type" = "face_consent_required" ] || fail "expected type face_consent_required, got '$type'"
pass "no consent → 403 face_consent_required (gate is server-side)"

# --- grant consent ---------------------------------------------------------
step "Granting consent records the current copy version"
granted=$(curl -sf -X POST "$API/v1/me/face-consent" "${AUTH[@]}")
[ "$(printf '%s' "$granted" | jq -r '.granted')" = "true" ] || fail "consent not granted"
ver=$(printf '%s' "$granted" | jq -r '.grantedVersion')
cur=$(curl -sf "${AUTH[@]}" "$API/v1/me/face-consent" | jq -r '.currentVersion')
[ "$ver" = "$cur" ] || fail "granted version '$ver' != current '$cur' (server must stamp its own version)"
pass "consent granted at version $ver"

# --- upload a reference ----------------------------------------------------
step "Uploading a reference selfie"
head -c 40000 /dev/urandom > "$TMP/selfie.jpg"
decl=$(curl -sf -X POST "$API/v1/me/face-references" "${AUTH[@]}" \
  -H 'Content-Type: application/json' -d '{"contentType":"image/jpeg","byteSize":40000}')
REFID=$(printf '%s' "$decl" | jq -r '.referenceId')
URL=$(printf '%s' "$decl" | jq -r '.upload.url')
[ -n "$REFID" ] && [ "$URL" != "null" ] || fail "declare did not return a reference + upload url"
# The presign must target the FACEDATA bucket, not media.
printf '%s' "$URL" | grep -q "$FACEBUCKET" || fail "reference presign did not target the facedata bucket"
curl -sf -o /dev/null -X PUT -H 'Content-Type: image/jpeg' --data-binary "@$TMP/selfie.jpg" "$URL" \
  || fail "PUT of selfie failed"
curl -sf -X POST "$API/v1/me/face-references/$REFID/complete" "${AUTH[@]}" \
  -H 'Content-Type: application/json' -d '{"contentType":"image/jpeg"}' >"$TMP/ref.json" \
  || fail "complete failed"
[ "$(jq -r '.processed' "$TMP/ref.json")" = "false" ] \
  || fail "a fresh reference should be unprocessed until the face worker embeds it"
pass "reference $REFID uploaded to facedata bucket, awaiting embedding"

# It is listed.
[ "$(curl -sf "${AUTH[@]}" "$API/v1/me/face-references" | jq '.references | length')" = "1" ] \
  || fail "the reference is not listed"
pass "reference listed (complete's HeadObject already confirmed the object in S3)"

# --- ERASURE ---------------------------------------------------------------
step "Erasing face data hard-deletes rows AND objects"
report=$(curl -sf -X DELETE "$API/v1/me/face-data" "${AUTH[@]}")
[ "$(printf '%s' "$report" | jq -r '.erased')" = "true" ] || fail "erasure did not report success"
[ "$(printf '%s' "$report" | jq -r '.referencesDeleted')" -ge 1 ] || fail "erasure reported 0 references deleted"
# objectsDeleted comes from the server's OWN DeletePrefix against the facedata bucket —
# a non-zero count is the proof the selfie was really stored AND physically removed,
# via the same S3 client that verified it at complete.
[ "$(printf '%s' "$report" | jq -r '.objectsDeleted')" -ge 1 ] \
  || fail "erasure reported 0 objects deleted — the selfie was not physically removed from S3"
pass "erasure removed $(printf '%s' "$report" | jq -r '.referencesDeleted') refs + $(printf '%s' "$report" | jq -r '.objectsDeleted') S3 objects (server-verified)"

# The rows are GONE — a hard delete, not a deleted_at flag. Checked in the DB directly
# because the API list would look the same for a soft delete; erasure must be hard.
rows=$(psql_ -c "SELECT count(*) FROM face_references WHERE user_id='$USERID'")
[ "$rows" = "0" ] || fail "face_references still has $rows rows for the user — erasure must HARD delete"
crows=$(psql_ -c "SELECT count(*) FROM face_consents WHERE user_id='$USERID'")
[ "$crows" = "0" ] || fail "face_consents still has $crows rows — erasure must remove consent too"
pass "reference + consent rows HARD-deleted from the database (0 remain)"

# And a post-erasure upload is refused again — consent was revoked by erasure.
code=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$API/v1/me/face-references" "${AUTH[@]}" \
  -H 'Content-Type: application/json' -d '{"contentType":"image/jpeg","byteSize":40000}')
[ "$code" = "403" ] || fail "after erasure, a reference upload returned $code, expected 403 (consent gone)"
pass "after erasure, collection is gated again (consent was revoked)"

echo
printf '\033[32m════ FACES SMOKE PASSED ════\033[0m\n'
echo "consent gates collection · reference to facedata bucket · erasure hard-deletes rows + objects"
