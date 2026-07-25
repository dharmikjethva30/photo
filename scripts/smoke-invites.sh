#!/usr/bin/env bash
# Invites end-to-end: mint a code, a second user joins with it, and the guarantees
# around that hold.
#
# The security model (docs/adr/0004): a code grants NOTHING on its own. It looks up an
# album's public preview unauthenticated, but joining needs a session, and access then
# comes from membership. This gate proves both halves: the preview is reachable without
# a token, and a member who joined via a code can see the album's feed while the code
# alone cannot.
#
# What it checks, in order:
#   1. create -> a code and a shareable /a/<code> link
#   2. GET /v1/invites/{code} works WITHOUT auth and returns the album preview
#   3. a SECOND user accepts and becomes a member (member count goes 1 -> 2)
#   4. accept is idempotent — a second accept does not consume another use
#   5. a single-use invite is spent after one join (410-equivalent 409)
#   6. a revoked invite cannot be accepted
#   7. a bogus code is 404, distinct from a spent/revoked one (409)
#
# Run: task smoke:invites   (needs `task api` host mode)
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

signin() { # label -> echoes access token
  curl -sf -X POST "$API/v1/auth/apple" -H 'Content-Type: application/json' \
    -d "{\"idToken\":\"inv-$1-$(date +%s)-$RANDOM\"}" | jq -r '.accessToken'
}

# --- setup: owner creates an album ----------------------------------------
step "Setting up two users and an album"
OWNER=$(signin owner)
GUEST=$(signin guest)
[ -n "$OWNER" ] && [ -n "$GUEST" ] || fail "sign-in failed"
ALBUM=$(curl -sf -X POST "$API/v1/albums" -H "Authorization: Bearer $OWNER" \
  -H 'Content-Type: application/json' \
  -d '{"title":"Invite test","template":"trip","privacyMode":"open"}' | jq -r '.id')
[ -n "$ALBUM" ] || fail "album creation failed"
pass "album $ALBUM, owner + a would-be guest"

# --- create ----------------------------------------------------------------
step "Owner mints an invite"
curl -sf -X POST "$API/v1/albums/$ALBUM/invites" -H "Authorization: Bearer $OWNER" \
  -H 'Content-Type: application/json' -d '{"channel":"link"}' >"$TMP/inv.json" \
  || fail "create invite failed"
CODE=$(jq -r '.code' "$TMP/inv.json")
URL=$(jq -r '.url' "$TMP/inv.json")
[ -n "$CODE" ] && [ "$CODE" != "null" ] || fail "no code returned"
case "$URL" in
  */a/"$CODE") : ;;
  *) fail "shareable url '$URL' should end in /a/$CODE" ;;
esac
pass "minted code $CODE with link $URL"

# --- public preview (no auth) ---------------------------------------------
step "Anyone with the code can see the album preview, unauthenticated"
curl -sf "$API/v1/invites/$CODE" >"$TMP/preview.json" || fail "unauth preview failed"
[ "$(jq -r '.albumTitle' "$TMP/preview.json")" = "Invite test" ] \
  || fail "preview did not return the album title"
[ "$(jq -r '.valid' "$TMP/preview.json")" = "true" ] || fail "fresh invite should be valid"
# The preview must NOT leak members or media — only the public shape.
jq -e 'has("members") or has("media")' "$TMP/preview.json" >/dev/null \
  && fail "preview leaked members/media to an unauthenticated holder" || true
pass "unauth preview returns title + validity, nothing sensitive"

# A guest who has NOT joined cannot see the album. The album detail endpoint 404s for
# a non-member (it must not even confirm the album exists — same non-leaking rule as
# face-privacy). The FEED endpoint deliberately returns 200-with-empty instead, because
# membership is enforced structurally in the visibility CTE, not as a 403; asserting on
# the detail endpoint is the clean membership gate.
code=$(curl -s -o /dev/null -w '%{http_code}' "$API/v1/albums/$ALBUM" \
  -H "Authorization: Bearer $GUEST")
[ "$code" = "404" ] || fail "a non-member could see the album (got $code, want 404)"
pass "the code alone does not grant album access (404 before joining)"

# --- accept ----------------------------------------------------------------
step "Guest accepts and becomes a member"
members_before=$(curl -sf "$API/v1/albums/$ALBUM/members" -H "Authorization: Bearer $OWNER" \
  | jq '.members | length')
curl -sf -X POST "$API/v1/invites/$CODE/accept" -H "Authorization: Bearer $GUEST" \
  >"$TMP/joined.json" || fail "accept failed"
[ "$(jq -r '.id' "$TMP/joined.json")" = "$ALBUM" ] || fail "accept did not return the album"
members_after=$(curl -sf "$API/v1/albums/$ALBUM/members" -H "Authorization: Bearer $OWNER" \
  | jq '.members | length')
[ "$members_after" = "$((members_before + 1))" ] \
  || fail "member count went $members_before -> $members_after, expected +1"
pass "guest joined; members $members_before -> $members_after"

# Now a member, the guest CAN see the album that 404'd a moment ago.
code=$(curl -s -o /dev/null -w '%{http_code}' "$API/v1/albums/$ALBUM" \
  -H "Authorization: Bearer $GUEST")
[ "$code" = "200" ] || fail "joined member cannot see the album (got $code)"
pass "the joined member can now see the album (200)"

# --- idempotent accept -----------------------------------------------------
step "Accepting again is a harmless no-op"
uses_before=$(curl -sf "$API/v1/albums/$ALBUM/invites" -H "Authorization: Bearer $OWNER" \
  | jq --arg c "$CODE" '.invites[] | select(.code==$c) | .useCount')
curl -sf -X POST "$API/v1/invites/$CODE/accept" -H "Authorization: Bearer $GUEST" >/dev/null \
  || fail "second accept errored"
uses_after=$(curl -sf "$API/v1/albums/$ALBUM/invites" -H "Authorization: Bearer $OWNER" \
  | jq --arg c "$CODE" '.invites[] | select(.code==$c) | .useCount')
[ "$uses_before" = "$uses_after" ] \
  || fail "a repeat accept consumed a use ($uses_before -> $uses_after); single-use invites would burn on a double-tap"
pass "repeat accept consumed nothing (useCount stayed $uses_after)"

# --- single-use spend ------------------------------------------------------
step "A single-use invite is spent after one join"
THIRD=$(signin third)
curl -sf -X POST "$API/v1/albums/$ALBUM/invites" -H "Authorization: Bearer $OWNER" \
  -H 'Content-Type: application/json' -d '{"maxUses":1}' >"$TMP/single.json" || fail "create failed"
SINGLE=$(jq -r '.code' "$TMP/single.json")
curl -sf -X POST "$API/v1/invites/$SINGLE/accept" -H "Authorization: Bearer $THIRD" >/dev/null \
  || fail "first single-use accept failed"
# The preview should now report it as spent...
[ "$(curl -sf "$API/v1/invites/$SINGLE" | jq -r '.invalidReason')" = "full" ] \
  || fail "a spent single-use invite should preview as invalidReason=full"
# ...and a fourth user cannot accept it.
FOURTH=$(signin fourth)
code=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$API/v1/invites/$SINGLE/accept" \
  -H "Authorization: Bearer $FOURTH")
[ "$code" = "409" ] || fail "a spent invite returned $code on accept, expected 409"
pass "single-use invite spent after one join; further accepts are 409"

# --- revoke ----------------------------------------------------------------
step "A revoked invite stops working immediately"
INV_ID=$(jq -r '.id' "$TMP/inv.json")
code=$(curl -s -o /dev/null -w '%{http_code}' -X DELETE \
  "$API/v1/albums/$ALBUM/invites/$INV_ID" -H "Authorization: Bearer $OWNER")
[ "$code" = "204" ] || fail "revoke returned $code, expected 204"
FIFTH=$(signin fifth)
code=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$API/v1/invites/$CODE/accept" \
  -H "Authorization: Bearer $FIFTH")
[ "$code" = "409" ] || fail "a revoked invite returned $code on accept, expected 409"
[ "$(curl -sf "$API/v1/invites/$CODE" | jq -r '.invalidReason')" = "revoked" ] \
  || fail "a revoked invite should preview as invalidReason=revoked"
pass "revoked invite is refused (409) and previews as revoked"

# --- bogus code ------------------------------------------------------------
step "A bogus code is a 404, distinct from a spent/revoked 409"
code=$(curl -s -o /dev/null -w '%{http_code}' "$API/v1/invites/ZZZZZZZZ")
[ "$code" = "404" ] || fail "a nonexistent code returned $code, expected 404"
pass "nonexistent code is 404 (the client can tell 'wrong link' from 'dead link')"

echo
printf '\033[32m════ INVITES SMOKE PASSED ════\033[0m\n'
echo "mint -> unauth preview -> join -> feed access · idempotent · single-use · revoke"
