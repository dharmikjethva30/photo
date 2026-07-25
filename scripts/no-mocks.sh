#!/usr/bin/env bash
# The walking skeleton's defining constraint is that nothing in it is mocked.
# The design prototype ships attractive fixture data (PHOTO_SET, PEOPLE,
# photoBackground(), "184 photos") and it is very easy to port a screen by
# copying that data and never noticing the screen isn't wired to the API.
#
# This gate fails the build if prototype fixtures appear in shipped app code.
#
# It matches CODE only. Comments and docstrings legitimately reference these
# names to explain what was deliberately NOT ported — flagging those would
# punish exactly the documentation we want. Lines whose first non-space
# character starts a comment (`//`, `*`, `/*`, `#`) are skipped, as are
# docs/prototype/ (the reference copy) and generated output.
#
# `app/_dev/**` is also exempt. Those routes (the component gallery, the palette
# matrix) exist to render primitives on a device and genuinely need sample people
# to draw avatars with — they are development tooling, not product screens, and
# the rule this gate enforces is that PRODUCT screens are wired to the API.
set -uo pipefail

patterns=(
  'PHOTO_SET'
  'photoBackground'
  'PEOPLE'
  'personColor'
  '184 photos'
)

roots=(apps packages)
found=0

for p in "${patterns[@]}"; do
  hits=$(
    grep -rIn --fixed-strings \
      --exclude-dir=node_modules --exclude-dir=dist --exclude-dir=.next \
      --exclude-dir=.expo --exclude-dir=generated --exclude-dir=prototype \
      --exclude-dir=_dev \
      -- "$p" "${roots[@]}" 2>/dev/null \
      | awk -F: '
          {
            # $1=file $2=line, rest is content (which may itself contain colons)
            content = $0
            sub(/^[^:]*:[0-9]+:/, "", content)
            sub(/^[ \t]+/, "", content)
            if (content ~ /^(\/\/|\/\*|\*|#)/) next
            print
          }'
  )
  if [ -n "$hits" ]; then
    printf '\033[31mFAIL\033[0m prototype fixture "%s" used in app code:\n' "$p"
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

If a match is inside a comment explaining what was not ported, reformat it as a
comment line so this gate skips it.
EOF
  exit 1
fi

printf '\033[32m ok \033[0m no prototype fixtures in app code\n'
