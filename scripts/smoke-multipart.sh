#!/usr/bin/env bash
# Multipart upload gate: resumable upload of a file large enough to need parts.
#
# What it proves, in order:
#   1. declare returns a multipart plan above the threshold
#   2. parts PUT directly to S3 and report ETags
#   3. RESUME reports exactly which parts landed and which are missing
#   4. an interrupted upload finishes by sending only the gap
#   5. complete assembles the object and verifies it against the declared size
#   6. the reassembled original is byte-for-byte identical to the input
#
# Step 4 is the point of the whole design: on a phone network a 400 MB upload WILL
# be interrupted, and the cost must be one part rather than the file.
#
# Run: task smoke:multipart   (needs `task up:infra` and `task api`; NOT the worker)
set -euo pipefail

API="${API_BASE_URL:-http://localhost:8080}"
# Read the compose/bucket settings the same way the API does, so this cannot drift.
[ -f .env ] && { set -a; . ./.env; set +a; }
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

pass() { printf '\033[32m ok \033[0m %s\n' "$1"; }
fail() { printf '\033[31mFAIL\033[0m %s\n' "$1" >&2; exit 1; }
step() { printf '\n\033[36m==>\033[0m %s\n' "$1"; }

for c in curl jq python3; do command -v "$c" >/dev/null || fail "$c is required"; done

curl -sf "$API/readyz" >/dev/null || fail "$API is not responding — is \`task api\` running?"

# --- sign in and create an album -------------------------------------------
step "Setting up"
curl -sf -X POST "$API/v1/auth/apple" -H 'Content-Type: application/json' \
  -d "{\"idToken\":\"mp-$(date +%s)-$RANDOM\"}" >"$TMP/session.json" || fail "sign-in failed"
ACCESS=$(jq -r '.accessToken' "$TMP/session.json")
AUTH=(-H "Authorization: Bearer $ACCESS")

curl -sf -X POST "$API/v1/albums" "${AUTH[@]}" -H 'Content-Type: application/json' \
  -d '{"title":"Multipart test","template":"trip","privacyMode":"open"}' >"$TMP/album.json" \
  || fail "album creation failed"
ALBUM_ID=$(jq -r '.id' "$TMP/album.json")
pass "album $ALBUM_ID"

# --- a file larger than the multipart threshold ----------------------------
# The threshold is 16 MiB and the part size 8 MiB, so ~20 MiB gives 3 parts —
# enough to leave a real gap in the middle for the resume test.
step "Generating a 20 MiB test image"
python3 - "$TMP/big.jpg" <<'PY'
import sys, random
# Incompressible noise, so the file cannot be silently shrunk by a re-encode and
# the byte-for-byte assertion at the end is meaningful.
random.seed(99)
size = 20 * 1024 * 1024
with open(sys.argv[1], "wb") as f:
    # A real JPEG SOI/EOI wrapper around noise: the API's content-type allowlist is
    # checked against the declared type, and the worker is not involved here.
    f.write(b"\xff\xd8\xff\xe0")
    f.write(random.randbytes(size - 6))
    f.write(b"\xff\xd9")
PY
BYTES=$(wc -c <"$TMP/big.jpg" | tr -d ' ')
SHA_HEX=$(python3 -c "
import hashlib,sys
h=hashlib.sha256()
with open(sys.argv[1],'rb') as f:
    for b in iter(lambda: f.read(1<<20), b''): h.update(b)
print(h.hexdigest())" "$TMP/big.jpg")
pass "$BYTES bytes, sha256 ${SHA_HEX:0:16}…"

# --- declare ---------------------------------------------------------------
step "Declaring the upload"
curl -sf -X POST "$API/v1/albums/$ALBUM_ID/uploads" "${AUTH[@]}" \
  -H 'Content-Type: application/json' \
  -d "{\"clientMediaId\":\"mp-asset-1\",\"contentType\":\"image/jpeg\",\"byteSize\":$BYTES,\"originalFilename\":\"big.jpg\"}" \
  >"$TMP/declare.json" || fail "declare failed"

MODE=$(jq -r '.mode' "$TMP/declare.json")
[ "$MODE" = "multipart" ] || fail "expected mode 'multipart' for a ${BYTES}-byte file, got '$MODE'"
MEDIA_ID=$(jq -r '.mediaId' "$TMP/declare.json")
PART_SIZE=$(jq -r '.partSize' "$TMP/declare.json")
PART_COUNT=$(jq -r '.partCount' "$TMP/declare.json")
[ "$PART_COUNT" -ge 3 ] || fail "expected at least 3 parts, got $PART_COUNT"
pass "multipart plan: $PART_COUNT parts of $PART_SIZE bytes"

# Declare must NOT hand out part URLs: signing a part requires that part's sha256,
# which the client cannot know before reading the bytes.
jq -e 'has("parts") | not' "$TMP/declare.json" >/dev/null \
  || fail "declare returned part URLs. They cannot be signed before the client has
      hashed each part — see s3store.PresignParts."

# Split the file and hash each part. The hash is not optional bookkeeping: it goes
# INTO the signature, because SigV4 rejects an unsigned x-amz-checksum-sha256.
step "Slicing and hashing parts"
python3 - "$TMP/big.jpg" "$TMP" "$PART_SIZE" <<'PY'
import sys, hashlib, base64, json
src, outdir, part = sys.argv[1], sys.argv[2], int(sys.argv[3])
out = []
with open(src, "rb") as f:
    n = 1
    while True:
        chunk = f.read(part)
        if not chunk: break
        open(f"{outdir}/part-{n}", "wb").write(chunk)
        out.append({"partNumber": n,
                    "sha256": base64.b64encode(hashlib.sha256(chunk).digest()).decode()})
        n += 1
json.dump(out, open(f"{outdir}/hashes.json", "w"))
PY
pass "$(jq 'length' "$TMP/hashes.json") parts hashed"

# Ask for URLs for every part, supplying the checksums.
curl -sf -X POST "$API/v1/uploads/$MEDIA_ID/parts" "${AUTH[@]}" \
  -H 'Content-Type: application/json' \
  -d "$(jq -c '{parts: .}' "$TMP/hashes.json")" >"$TMP/urls.json" \
  || fail "part URL request failed"
[ "$(jq '.parts | length' "$TMP/urls.json")" = "$PART_COUNT" ] \
  || fail "asked for $PART_COUNT part URLs, got $(jq '.parts | length' "$TMP/urls.json")"
pass "signed $PART_COUNT part URLs"

# Guard the emulator/device presign trap, same as scripts/smoke.sh.
PUT_HOST=$(jq -r '.parts[0].url' "$TMP/urls.json" | sed -E 's#^https?://([^/:]+).*#\1#')
case "$PUT_HOST" in
  localhost|127.0.0.1) : ;;
  *) fail "parts were signed for '$PUT_HOST', unreachable from here. Use \`task api\`." ;;
esac

put_part() { # part_number [urls_file] -> echoes the ETag
  local n="$1" src="${2:-$TMP/urls.json}"
  local url ck
  url=$(jq -r --argjson n "$n" '.parts[] | select(.partNumber == $n) | .url' "$src")
  ck=$(jq -r --argjson n "$n" '.parts[] | select(.partNumber == $n) | .sha256' "$src")
  [ -n "$url" ] && [ "$url" != "null" ] || { echo "no url for part $n" >&2; return 1; }
  [ -n "$ck" ] && [ "$ck" != "null" ] || { echo "no checksum echoed for part $n" >&2; return 1; }
  local etag
  # The checksum header is mandatory: it is inside the signature, so omitting it is a
  # signature mismatch rather than merely a skipped integrity check.
  etag=$(curl -sf -D - -o /dev/null -X PUT \
           -H "x-amz-checksum-sha256: $ck" \
           --data-binary "@$TMP/part-$n" "$url" \
           | awk 'tolower($1) ~ /^etag:/ {gsub(/\r/,""); print $2}')
  [ -n "$etag" ] || { echo "no ETag returned for part $n" >&2; return 1; }
  echo "$etag"
}

# --- interrupt deliberately: send all parts EXCEPT one --------------------
step "Uploading all parts except one (simulating an interruption)"
GAP=2
for n in $(seq 1 "$PART_COUNT"); do
  [ "$n" = "$GAP" ] && continue
  put_part "$n" >/dev/null || fail "PUT of part $n failed"
done
pass "sent $((PART_COUNT - 1)) of $PART_COUNT parts, deliberately skipping part $GAP"

# --- re-declare must not throw away the parts already sent ------------------
# This is the real resume-across-app-kill path. A client that was killed has lost the
# mediaId, so its first move on retry is to re-declare with the same clientMediaId. If
# that started a fresh S3 multipart upload it would orphan everything already uploaded —
# silently turning resume into start-over for exactly the user whose connection is bad
# enough to need resuming.
step "Re-declaring, as a killed client would"
curl -sf -X POST "$API/v1/albums/$ALBUM_ID/uploads" "${AUTH[@]}" \
  -H 'Content-Type: application/json' \
  -d "{\"clientMediaId\":\"mp-asset-1\",\"contentType\":\"image/jpeg\",\"byteSize\":$BYTES,\"originalFilename\":\"big.jpg\"}" \
  >"$TMP/redeclare.json" || fail "re-declare failed"

[ "$(jq -r '.mediaId' "$TMP/redeclare.json")" = "$MEDIA_ID" ] \
  || fail "re-declare returned a different mediaId; the idempotency key is not working"
[ "$(jq -r '.uploadId' "$TMP/redeclare.json")" = "$(jq -r '.uploadId' "$TMP/declare.json")" ] \
  || fail "re-declare started a NEW S3 multipart upload, orphaning the parts already
      uploaded. Resume after an app kill would silently restart from zero."
pass "re-declare returned the same mediaId and the same live upload"

# --- resume ----------------------------------------------------------------
step "Asking the server what is missing"
curl -sf "${AUTH[@]}" "$API/v1/uploads/$MEDIA_ID" >"$TMP/resume.json" || fail "resume failed"

jq -e '.mode == "multipart"' "$TMP/resume.json" >/dev/null || fail "resume did not report multipart"
MISSING=$(jq -r '.missing | join(",")' "$TMP/resume.json")
COMPLETED_N=$(jq -r '.completed | length' "$TMP/resume.json")

[ "$MISSING" = "$GAP" ] || fail "resume reported missing=[$MISSING], expected exactly [$GAP].
      The gap is computed from S3's own ListParts, so a wrong answer here means a
      resumed upload would either re-send everything or assemble a corrupt object."
[ "$COMPLETED_N" = "$((PART_COUNT - 1))" ] \
  || fail "resume reported $COMPLETED_N completed parts, expected $((PART_COUNT - 1))"
pass "resume identified exactly the missing part from S3's ListParts"

# Completing now must be refused: the object would be short by one part.
code=$(curl -s -o "$TMP/early.json" -w '%{http_code}' -X POST \
  "$API/v1/uploads/$MEDIA_ID/complete" "${AUTH[@]}" -H 'Content-Type: application/json' \
  -d "$(jq -c '{parts: [.completed[] | {partNumber, etag: .etag}]}' "$TMP/resume.json")")
[ "$code" = "409" ] || fail "completing an incomplete upload returned $code, expected 409"
pass "completing with a missing part is refused (409)"

# --- fill the gap and finish ----------------------------------------------
# A wrong checksum must be rejected rather than silently stored — that is the whole
# point of signing the checksum into the URL.
#
# This runs against the part that is still MISSING, deliberately. A rejected PUT is not
# guaranteed to leave an existing part untouched: LocalStack registers the part as
# zero-length, which then surfaces as a short object at completion. Aiming the probe at
# an absent part means the test cannot corrupt the upload it is about to verify.
step "Checking that a mismatched checksum is refused"
BAD_CK=$(printf 'these-are-not-the-bytes-you-want' | openssl dgst -sha256 -binary | base64)
curl -sf -X POST "$API/v1/uploads/$MEDIA_ID/parts" "${AUTH[@]}" \
  -H 'Content-Type: application/json' \
  -d "{\"parts\":[{\"partNumber\":$GAP,\"sha256\":\"$BAD_CK\"}]}" >"$TMP/urls-bad.json" \
  || fail "part URL request failed"
BAD_URL=$(jq -r '.parts[0].url' "$TMP/urls-bad.json")
code=$(curl -s -o /dev/null -w '%{http_code}' -X PUT \
  -H "x-amz-checksum-sha256: $BAD_CK" --data-binary "@$TMP/part-$GAP" "$BAD_URL")
[ "$code" != "200" ] || fail "S3 accepted a part whose bytes do not match its signed
      checksum. Per-part integrity is not actually being enforced."
pass "a part whose bytes do not match its signed checksum is refused (HTTP $code)"

# And omitting the header entirely must fail too: it is inside the signature, so this
# is a signature error rather than a skipped optional check.
code=$(curl -s -o /dev/null -w '%{http_code}' -X PUT \
  --data-binary "@$TMP/part-$GAP" \
  "$(jq -r --argjson n "$GAP" '.parts[] | select(.partNumber == $n) | .url' "$TMP/urls.json")")
[ "$code" != "200" ] || fail "S3 accepted a part with no checksum header at all."
pass "a part sent without its checksum header is refused (HTTP $code)"

step "Sending only the missing part"
# Re-request the URL rather than reusing the original. This is also the recovery path
# for a presign that expired mid-upload.
curl -sf -X POST "$API/v1/uploads/$MEDIA_ID/parts" "${AUTH[@]}" \
  -H 'Content-Type: application/json' \
  -d "$(jq -c --argjson n "$GAP" '{parts: [.[] | select(.partNumber == $n)]}' "$TMP/hashes.json")" \
  >"$TMP/urls2.json" || fail "part URL refresh failed"
put_part "$GAP" "$TMP/urls2.json" >/dev/null || fail "PUT of the missing part failed"
pass "missing part uploaded via a freshly signed URL"

curl -sf "${AUTH[@]}" "$API/v1/uploads/$MEDIA_ID" >"$TMP/resume2.json" || fail "resume failed"
jq -e '.missing | length == 0' "$TMP/resume2.json" >/dev/null \
  || fail "still missing $(jq -c '.missing' "$TMP/resume2.json") after filling the gap"

# Presence is not enough — assert S3 holds the exact bytes we computed. A part that is
# merely LISTED can still be zero-length, which shows up only as a short final object.
MISMATCH=$(jq -r --slurpfile want "$TMP/hashes.json" '
  [ .completed[]
    | . as $got
    | ($want[0][] | select(.partNumber == $got.partNumber)) as $exp
    | select($got.sha256 != $exp.sha256)
    | "part \($got.partNumber)" ] | join(", ")' "$TMP/resume2.json")
[ -z "$MISMATCH" ] || fail "S3's stored checksum disagrees with ours for: $MISMATCH"
pass "all $PART_COUNT parts present, each matching the checksum we computed"

step "Completing the upload"
# An EMPTY body: the server sources the part list and the per-part checksums from S3
# itself. This is what lets a client survive being killed knowing only the mediaId.
curl -sf -X POST "$API/v1/uploads/$MEDIA_ID/complete" "${AUTH[@]}" \
  >"$TMP/complete.json" || fail "complete failed"
jq -e '.state == "uploaded"' "$TMP/complete.json" >/dev/null \
  || fail "unexpected state: $(cat "$TMP/complete.json")"
pass "S3 assembled the parts and the server verified the size"

# --- byte-for-byte ---------------------------------------------------------
# Read the object straight out of S3 rather than through GET /v1/media/{id}/original.
#
# Not a shortcut: this test's subject is multipart assembly, and the read path needs the
# item to be `ready`, which needs the worker to decode it — but the test asset is
# incompressible noise precisely so that its size cannot be fudged, and no decoder will
# accept it. scripts/smoke.sh covers the authorized read path with a real photo. Keeping
# them separate also means this gate does not need the worker running.
step "Verifying the reassembled original"
KEY=$(docker compose exec -T postgres psql -qtAX -U "${POSTGRES_USER:-photu}" \
        -d "${POSTGRES_DB:-photu}" \
        -c "SELECT storage_key FROM media_items WHERE id = '$MEDIA_ID'" | tr -d '\r')
[ -n "$KEY" ] || fail "could not read the storage key for $MEDIA_ID"

GOT=$(docker compose exec -T localstack sh -c \
  "awslocal s3api get-object --bucket '${MEDIA_BUCKET:-photu-media-dev}' --key '$KEY' /tmp/dl >/dev/null \
   && sha256sum /tmp/dl | cut -d' ' -f1 && rm -f /tmp/dl" | tr -d '\r')

[ "$GOT" = "$SHA_HEX" ] || fail "REASSEMBLED OBJECT DIFFERS FROM THE INPUT.
  uploaded:   $SHA_HEX
  in S3:      $GOT
  key:        $KEY
  A multipart assembly that does not reproduce the input byte-for-byte breaks the
  product's central promise of the untouched original."
pass "reassembled original is byte-for-byte identical ($BYTES bytes across $PART_COUNT parts)"

# --- the reconciler --------------------------------------------------------
# The gap the client-callback design deliberately leaves open (docs/adr/0003): a client
# that uploads its last part and then dies before calling /complete. Nothing else will
# ever finish that upload, so the sweep has to — and this is the only assertion that
# proves it, since the real trigger is a 30-minute-old row on a 5-minute timer.
step "Checking the stalled-upload reconciler"
curl -sf -X POST "$API/v1/albums/$ALBUM_ID/uploads" "${AUTH[@]}" \
  -H 'Content-Type: application/json' \
  -d "{\"clientMediaId\":\"mp-orphan\",\"contentType\":\"image/jpeg\",\"byteSize\":$BYTES}" \
  >"$TMP/declare3.json" || fail "third declare failed"
ORPHAN=$(jq -r '.mediaId' "$TMP/declare3.json")

curl -sf -X POST "$API/v1/uploads/$ORPHAN/parts" "${AUTH[@]}" \
  -H 'Content-Type: application/json' -d "$(jq -c '{parts: .}' "$TMP/hashes.json")" \
  >"$TMP/urls3.json" || fail "part URL request failed"
for n in $(seq 1 "$PART_COUNT"); do
  put_part "$n" "$TMP/urls3.json" >/dev/null || fail "PUT of part $n failed"
done
# ...and now the client "dies": no /complete call at all.
pass "all parts uploaded, /complete never called (client died)"

psql_() {
  docker compose exec -T postgres psql -qtAX -U "${POSTGRES_USER:-photu}" \
    -d "${POSTGRES_DB:-photu}" "$@"
}
[ "$(psql_ -c "SELECT state FROM media_items WHERE id = '$ORPHAN'" | tr -d '\r')" = "pending" ] \
  || fail "expected the orphaned upload to still be pending"

# -stale-after=0s makes the sweep deterministic instead of a race against the clock.
(cd services/api && go run ./cmd/worker -once -stale-after=0s) >"$TMP/worker.log" 2>&1 \
  || fail "reconciler failed: $(tail -3 "$TMP/worker.log")"

STATE=$(psql_ -c "SELECT state FROM media_items WHERE id = '$ORPHAN'" | tr -d '\r')
[ "$STATE" = "uploaded" ] || fail "the reconciler left the orphaned upload in '$STATE'.
      A client that dies after its last part must still end up with a usable photo;
      otherwise the upload is silently lost. Worker log:
$(tail -5 "$TMP/worker.log")"
pass "the reconciler assembled the parts and marked it uploaded"

# It must also be idempotent — the sweep runs every 5 minutes forever.
(cd services/api && go run ./cmd/worker -once -stale-after=0s) >>"$TMP/worker.log" 2>&1 \
  || fail "a second reconciler pass failed"
[ "$(psql_ -c "SELECT state FROM media_items WHERE id = '$ORPHAN'" | tr -d '\r')" = "uploaded" ] \
  || fail "a second reconciler pass changed the state"
pass "a repeated sweep is a no-op"

# --- abort -----------------------------------------------------------------
step "Checking abort"
curl -sf -X POST "$API/v1/albums/$ALBUM_ID/uploads" "${AUTH[@]}" \
  -H 'Content-Type: application/json' \
  -d "{\"clientMediaId\":\"mp-abandoned\",\"contentType\":\"image/jpeg\",\"byteSize\":$BYTES}" \
  >"$TMP/declare2.json" || fail "second declare failed"
ABANDONED=$(jq -r '.mediaId' "$TMP/declare2.json")
code=$(curl -s -o /dev/null -w '%{http_code}' -X DELETE "$API/v1/uploads/$ABANDONED" "${AUTH[@]}")
[ "$code" = "204" ] || fail "abort returned $code, expected 204"
# Idempotent: a client retrying an abort after a dropped response must not error.
code=$(curl -s -o /dev/null -w '%{http_code}' -X DELETE "$API/v1/uploads/$ABANDONED" "${AUTH[@]}")
[ "$code" = "204" ] || fail "a repeated abort returned $code, expected 204 (abort must be idempotent)"
pass "abort discards the parts and is idempotent"

echo
printf '\033[32m════ MULTIPART SMOKE PASSED ════\033[0m\n'
echo "declare -> parts -> interrupt -> resume -> fill gap -> assemble -> byte-exact"
