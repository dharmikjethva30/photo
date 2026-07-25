#!/usr/bin/env bash
# Assert the local infrastructure is genuinely usable, not merely "running".
# This is M0's exit gate: it must pass with zero application code present.
set -euo pipefail

COMPOSE="docker compose"
: "${POSTGRES_USER:=photu}"
: "${POSTGRES_DB:=photu}"
: "${MEDIA_BUCKET:=photu-media-dev}"
: "${FACEDATA_BUCKET:=photu-facedata-dev}"

fail() { printf '\033[31mFAIL\033[0m %s\n' "$1"; exit 1; }
pass() { printf '\033[32m ok \033[0m %s\n' "$1"; }

echo
echo "Verifying local infrastructure"
echo "-----------------------------"

# --- Postgres --------------------------------------------------------------
$COMPOSE exec -T postgres pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB" >/dev/null 2>&1 \
  || fail "postgres is not accepting connections"
pass "postgres accepting connections"

# pgvector is not optional: face embeddings are vector(512) and the schema will
# not migrate without the extension.
ver=$($COMPOSE exec -T postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tAc \
  "select extversion from pg_extension where extname='vector'" 2>/dev/null | tr -d '[:space:]')
[ -n "$ver" ] || fail "pgvector extension not installed (check infra/postgres/init/01-extensions.sql)"
pass "pgvector installed (v$ver)"

pgc=$($COMPOSE exec -T postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tAc \
  "select extversion from pg_extension where extname='pgcrypto'" 2>/dev/null | tr -d '[:space:]')
[ -n "$pgc" ] || fail "pgcrypto extension not installed"
pass "pgcrypto installed (v$pgc)"

# A vector round-trip proves the type actually works, not just that the
# extension row exists.
$COMPOSE exec -T postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tAc \
  "select '[1,2,3]'::vector <=> '[1,2,3]'::vector" >/dev/null 2>&1 \
  || fail "vector cosine operator <=> not usable"
pass "vector cosine distance operator usable"

# --- LocalStack ------------------------------------------------------------
# The host has no awslocal CLI and does not need one: the localstack image
# ships awslocal internally and auto-runs /etc/localstack/init/ready.d/*.
health=$(curl -sf http://localhost:4566/_localstack/health 2>/dev/null) \
  || fail "localstack health endpoint unreachable on :4566"
echo "$health" | grep -q '"s3": *"\(available\|running\)"' \
  || fail "localstack S3 not available: $health"
pass "localstack S3 available"

# The ready.d hook runs ASYNCHRONOUSLY, after the health endpoint already
# reports S3 available — so `compose up --wait` returning healthy does not mean
# the buckets are configured. Asserting bucket state directly races the hook
# (observed: buckets present, CORS not yet applied). Gate on the init status
# endpoint instead, which also surfaces a failing script explicitly rather than
# leaving us to infer it from missing resources.
init=''
for _ in $(seq 1 60); do
  init=$(curl -sf http://localhost:4566/_localstack/init/ready 2>/dev/null || echo '')
  case "$init" in *'"completed": true'*) break ;; esac
  sleep 1
done
case "$init" in
  *'"completed": true'*) : ;;
  *) fail "localstack init hooks did not complete within 60s: ${init:-<no response>}" ;;
esac
case "$init" in
  *'"state": "ERROR"'*)
    fail "a localstack init script failed: $init
      A common cause is a non-executable hook. The scripts are mounted read-only,
      so the exec bit must be set on the host and committed:
        chmod +x infra/localstack/init/*.sh && git update-index --chmod=+x ..." ;;
esac
pass "localstack init hooks completed successfully"

for b in "$MEDIA_BUCKET" "$FACEDATA_BUCKET"; do
  $COMPOSE exec -T localstack awslocal s3api head-bucket --bucket "$b" >/dev/null 2>&1 \
    || fail "bucket $b missing (check infra/localstack/init/01-buckets.sh)"
  pass "bucket $b exists"
done

# ExposeHeaders: ETag is not cosmetic. The browser multipart uploader must read
# each part's ETag to send back to /complete; without the CORS expose-header it
# is invisible to JS and the web uploader silently cannot finish an upload.
cors=$($COMPOSE exec -T localstack awslocal s3api get-bucket-cors --bucket "$MEDIA_BUCKET" 2>/dev/null || echo '')
echo "$cors" | grep -q 'ETag' \
  || fail "$MEDIA_BUCKET CORS does not expose ETag — the web multipart uploader cannot work"
pass "$MEDIA_BUCKET CORS exposes ETag"

# Abandoned multipart parts are billed forever without this rule.
lc=$($COMPOSE exec -T localstack awslocal s3api get-bucket-lifecycle-configuration \
  --bucket "$MEDIA_BUCKET" 2>/dev/null || echo '')
echo "$lc" | grep -q 'AbortIncompleteMultipartUpload' \
  || fail "$MEDIA_BUCKET missing AbortIncompleteMultipartUpload lifecycle rule"
pass "$MEDIA_BUCKET aborts incomplete multipart uploads"

echo
printf '\033[32mInfrastructure OK.\033[0m\n'
