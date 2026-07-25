#!/usr/bin/env bash
# The walking skeleton's defining constraint is that nothing in it is mocked.
# The design prototype ships attractive fixture data (PHOTO_SET, PEOPLE,
# photoBackground(), "184 photos") and it is very easy to port a screen by
# copying that data and never noticing the screen isn't wired to the API.
#
# This gate fails the build if prototype fixtures appear in shipped app code.
# docs/prototype/ is the reference copy and is exempt.
set -uo pipefail

patterns=(
  'PHOTO_SET'
  'photoBackground'
  'const PEOPLE'
  'personColor'
  '184 photos'
)

roots=(apps packages)
found=0

for p in "${patterns[@]}"; do
  # --exclude-dir covers generated output and the reference bundle.
  hits=$(grep -rIn --fixed-strings \
      --exclude-dir=node_modules --exclude-dir=dist --exclude-dir=.next \
      --exclude-dir=.expo --exclude-dir=generated --exclude-dir=prototype \
      -- "$p" "${roots[@]}" 2>/dev/null || true)
  if [ -n "$hits" ]; then
    printf '\033[31mFAIL\033[0m prototype fixture "%s" found in app code:\n' "$p"
    echo "$hits" | sed 's/^/      /'
    found=1
  fi
done

if [ "$found" -eq 1 ]; then
  cat <<'EOF'

These are design-prototype fixtures, not product data. Every number and image on
screen must come from the API. If you need sample content to develop against,
use `task seed` — it creates real rows through the same service layer the API
uses, so the app stays honest.
EOF
  exit 1
fi

printf '\033[32m ok \033[0m no prototype fixtures in app code\n'
