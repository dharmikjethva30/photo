#!/usr/bin/env bash
# Web invite-landing gate.
#
# The web app exists so a shared photu.app/a/<code> link UNFURLS in a chat and opens a
# join page in a browser — the adoption-velocity requirement in the plan. This proves
# that: the landing server-renders the album's name, carries the OG meta a chat client
# reads to build its card, generates a per-code OG image, tells apart a dead link from
# a valid one, and serves the app-association files that make the link deep-link into
# the app.
#
# Needs: the API (host mode) and the web app running (task api & task web), with the
# web app pointed at the API via API_INTERNAL_URL.
#
# Run: task smoke:web
set -euo pipefail

API="${API_BASE_URL:-http://localhost:8080}"
WEB="${WEB_BASE_URL:-http://localhost:3000}"
[ -f .env ] && { set -a; . ./.env; set +a; API="${API_BASE_URL:-$API}"; }

pass() { printf '\033[32m ok \033[0m %s\n' "$1"; }
fail() { printf '\033[31mFAIL\033[0m %s\n' "$1" >&2; exit 1; }
step() { printf '\n\033[36m==>\033[0m %s\n' "$1"; }

for c in curl jq; do command -v "$c" >/dev/null || fail "$c is required"; done
curl -sf "$API/readyz" >/dev/null || fail "$API not responding — is \`task api\` running?"
curl -sf -o /dev/null "$WEB/" || fail "$WEB not responding — is \`task web\` running?"

# --- mint an invite --------------------------------------------------------
step "Minting an invite to render"
TITLE="Sarahs Wedding $RANDOM"
OWNER=$(curl -sf -X POST "$API/v1/auth/apple" -H 'Content-Type: application/json' \
  -d "{\"idToken\":\"web-$(date +%s)-$RANDOM\"}" | jq -r '.accessToken')
ALBUM=$(curl -sf -X POST "$API/v1/albums" -H "Authorization: Bearer $OWNER" \
  -H 'Content-Type: application/json' \
  -d "{\"title\":\"$TITLE\",\"template\":\"wedding\",\"privacyMode\":\"open\"}" | jq -r '.id')
CODE=$(curl -sf -X POST "$API/v1/albums/$ALBUM/invites" -H "Authorization: Bearer $OWNER" \
  -H 'Content-Type: application/json' -d '{}' | jq -r '.code')
[ -n "$CODE" ] && [ "$CODE" != "null" ] || fail "could not mint an invite"
pass "code $CODE for album \"$TITLE\""

# --- the landing renders the album name ------------------------------------
step "The landing server-renders the album name"
HTML=$(curl -sf "$WEB/a/$CODE") || fail "landing fetch failed"
printf '%s' "$HTML" | grep -qF "$TITLE" \
  || fail "the album title is not in the server-rendered HTML — a crawler/unfurl would miss it"
pass "album name is in the HTML (server-rendered, so unfurl crawlers see it)"

# --- OG meta, the reason this page exists ----------------------------------
step "OG meta for chat unfurling"
printf '%s' "$HTML" | grep -qE '<meta property="og:title"[^>]*'"$TITLE" \
  || fail "og:title does not carry the album name; the chat card would be blank"
pass "og:title carries the album name"

code=$(curl -s -o /dev/null -w '%{http_code}' -H 'Accept: image/png' "$WEB/a/$CODE/opengraph-image")
ctype=$(curl -s -o /dev/null -w '%{content_type}' "$WEB/a/$CODE/opengraph-image")
[ "$code" = "200" ] || fail "OG image returned $code"
case "$ctype" in image/png*) : ;; *) fail "OG image content-type is '$ctype', expected image/png" ;; esac
pass "per-code OG image renders as PNG"

# --- a dead link reads as dead, not as a crash -----------------------------
step "An unknown code is a clean 'invalid' page"
BOGUS=$(curl -sf "$WEB/a/ZZZZZZZZ") || fail "invalid-code page errored instead of rendering"
printf '%s' "$BOGUS" | grep -qF "not valid" \
  || fail "an unknown code did not show the 'not valid' copy"
pass "unknown code renders the invalid-link page (no crash, no leak)"

# --- app-association files, so the link deep-links into the app ------------
step "App-association files are served"
pkg=$(curl -sf "$WEB/.well-known/assetlinks.json" | jq -r '.[0].target.package_name')
[ "$pkg" = "app.photu.mobile" ] || fail "assetlinks.json package_name was '$pkg'"
code=$(curl -s -o /dev/null -w '%{http_code}' "$WEB/.well-known/apple-app-site-association")
[ "$code" = "200" ] || fail "apple-app-site-association returned $code"
pass "assetlinks.json and apple-app-site-association are reachable"

echo
printf '\033[32m════ WEB SMOKE PASSED ════\033[0m\n'
echo "landing renders name · og:title + og:image unfurl · dead link handled · app links served"
