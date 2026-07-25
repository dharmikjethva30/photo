#!/usr/bin/env bash
# Report what this machine is missing. Exits non-zero if anything REQUIRED for
# the current stage is absent; native mobile toolchains are reported as warnings
# because M0/M1 steps 1-16 deliberately need none of them.
set -uo pipefail

ok=0; warn=0; fail=0
green() { printf '\033[32m  ok  \033[0m'; }
yellow() { printf '\033[33m warn \033[0m'; }
red() { printf '\033[31m FAIL \033[0m'; }

pass() { green; echo "$1"; ok=$((ok+1)); }
warning() { yellow; echo "$1"; warn=$((warn+1)); }
failure() { red; echo "$1"; fail=$((fail+1)); }

echo
echo "photu doctor"
echo "============"
echo
echo "Required now (M0/M1 backend + tokens + web):"

need_cmd() { # name, min-desc, version-cmd
  local name=$1 desc=$2
  if command -v "$name" >/dev/null 2>&1; then
    pass "$name — $(eval "$3" 2>&1 | head -1)"
  else
    failure "$name missing — $desc"
  fi
}

need_cmd node   "install Node 22 (nvm use)"        'node --version'
need_cmd pnpm   "npm i -g pnpm@10"                 'pnpm --version'
need_cmd go     "brew install go"                  'go version'
need_cmd python3 "brew install python@3.12"        'python3 --version'
need_cmd uv     "brew install uv"                  'uv --version'
need_cmd task   "brew install go-task"             'task --version'
need_cmd sqlc   "brew install sqlc"                'sqlc version'
need_cmd goose  "brew install goose"               'goose --version'
need_cmd docker "install Docker Desktop"           'docker --version'
# The media worker shells out to these for the video path (probe + poster frame).
# Photos need neither, so this is required-for-video rather than required-to-boot.
need_cmd ffprobe "brew install ffmpeg (needed for video uploads)" 'ffprobe -version'
need_cmd ffmpeg  "brew install ffmpeg (needed for video uploads)" 'ffmpeg -version'

if docker info >/dev/null 2>&1; then
  pass "docker daemon running"
else
  failure "docker daemon not running — start Docker Desktop"
fi

# node-linker=hoisted must be set BEFORE the first pnpm install, or Metro,
# Gradle autolinking and CocoaPods will all fail to resolve workspace packages.
if grep -qx 'node-linker=hoisted' .npmrc 2>/dev/null; then
  pass ".npmrc has node-linker=hoisted"
else
  failure ".npmrc must contain 'node-linker=hoisted' (see docs/adr/0001)"
fi

echo
echo "LAN address (presigned URLs and PUBLIC_BASE_URL are signed for this):"
lan=$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || echo "")
if [ -n "$lan" ]; then
  pass "LAN_IP=$lan"
else
  warning "no LAN address — a physical device cannot reach the API or LocalStack"
fi

echo
echo "Required later (M1 step 17+, mobile on device):"

if [ -d /Applications/Xcode.app ]; then
  xp=$(xcode-select -p 2>/dev/null)
  if [[ "$xp" == *Xcode.app* ]]; then
    pass "Xcode selected — $xp"
  else
    warning "Xcode installed but not selected — sudo xcode-select -s /Applications/Xcode.app/Contents/Developer"
  fi
else
  warning "Xcode not installed (~10GB from the App Store). Needed for local iOS builds; EAS Build is the alternative."
fi

if command -v pod >/dev/null 2>&1; then
  pass "cocoapods — $(pod --version 2>&1 | head -1)"
else
  warning "cocoapods missing — brew install cocoapods (needed after Xcode)"
fi

sdk="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-$HOME/Library/Android/sdk}}"
if [ -d "$sdk" ]; then
  pass "Android SDK at $sdk"
else
  warning "Android SDK missing — install Android Studio + SDK 36, then export ANDROID_HOME"
fi

# React Native 0.86's Gradle needs JDK 17. Java 23 on PATH fails with errors
# that do not mention the version, so check it explicitly.
if command -v java >/dev/null 2>&1; then
  jv=$(java -version 2>&1 | head -1)
  jmaj=$(java -version 2>&1 | head -1 | sed -E 's/.*"([0-9]+).*/\1/')
  if [ "$jmaj" = "17" ]; then
    pass "java — $jv"
  else
    warning "java is $jmaj, React Native's Gradle needs 17 — brew install --cask zulu@17 and pin JAVA_HOME per-project (keep $jmaj available for other work)"
  fi
else
  warning "java missing — brew install --cask zulu@17"
fi

if command -v watchman >/dev/null 2>&1; then
  pass "watchman — $(watchman --version 2>&1 | head -1)"
else
  warning "watchman missing — brew install watchman (Metro is slow and flaky without it)"
fi

echo
echo "-----------------------------------------------"
printf 'ok: %d   warnings: %d   failures: %d\n' "$ok" "$warn" "$fail"
if [ "$fail" -gt 0 ]; then
  echo
  echo "Fix the failures above before running 'task up'."
  exit 1
fi
if [ "$warn" -gt 0 ]; then
  echo
  echo "Warnings are expected until the mobile toolchain is installed."
  echo "Backend, tokens and web work are unblocked."
fi
