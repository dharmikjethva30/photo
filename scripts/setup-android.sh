#!/usr/bin/env bash
# Install the Android toolchain needed to build and run the app on an emulator.
#
# Deliberately uses the `openjdk@17` FORMULA rather than a JDK cask: casks install
# into /Library/Java/JavaVirtualMachines and need sudo, which cannot work in a
# non-interactive run. The formula installs into the Homebrew prefix.
#
# React Native 0.86's Gradle requires JDK 17 specifically. This script does NOT
# change the system default java — it prints the JAVA_HOME to export, so a newer
# JDK stays available for other work.
#
# Idempotent: safe to re-run.
set -euo pipefail

API=36
IMAGE_TAG=google_apis
AVD_NAME=photu-android-36

log() { printf '\n\033[36m==> %s\033[0m\n' "$1"; }

log "Installing JDK 17 and Android command line tools"
brew list openjdk@17 >/dev/null 2>&1 || brew install openjdk@17
brew list --cask android-commandlinetools >/dev/null 2>&1 \
  || brew install --cask android-commandlinetools

JAVA_HOME="$(brew --prefix openjdk@17)/libexec/openjdk.jdk/Contents/Home"
export JAVA_HOME
[ -x "$JAVA_HOME/bin/java" ] || { echo "JDK 17 not found at $JAVA_HOME"; exit 1; }
echo "JAVA_HOME=$JAVA_HOME"
"$JAVA_HOME/bin/java" -version 2>&1 | head -1

# The cask ships the tools; the SDK itself lives in the conventional location so
# Gradle, Expo and Android Studio all find it without extra configuration.
ANDROID_HOME="$HOME/Library/Android/sdk"
export ANDROID_HOME ANDROID_SDK_ROOT="$ANDROID_HOME"
mkdir -p "$ANDROID_HOME"

CMDLINE="$(brew --prefix)/share/android-commandlinetools"
[ -d "$CMDLINE/cmdline-tools/latest" ] || { echo "cmdline-tools not found at $CMDLINE"; exit 1; }

# sdkmanager and avdmanager derive the SDK root from THEIR OWN location (../../),
# ignoring ANDROID_HOME. With Homebrew's cmdline-tools outside the SDK root, both
# operate on the wrong root: `sdkmanager --list_installed` comes back empty and
# avdmanager reports "Package path is not valid ... Valid system image paths are:
# null" despite the image being installed.
#
# It must be a COPY, not a symlink — the tools resolve the real path, so a link
# back into the Homebrew prefix reproduces the same problem.
TOOLS_DIR="$ANDROID_HOME/cmdline-tools/latest"
# Test for a symlink explicitly: `-x .../bin/sdkmanager` succeeds through a link,
# so a plain existence check would leave a previously-linked install in place.
if [ -L "$TOOLS_DIR" ] || [ ! -x "$TOOLS_DIR/bin/sdkmanager" ]; then
  rm -rf "$TOOLS_DIR"
  mkdir -p "$ANDROID_HOME/cmdline-tools"
  cp -R "$CMDLINE/cmdline-tools/latest" "$TOOLS_DIR"
fi

SDKMANAGER="$ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager"
AVDMANAGER="$ANDROID_HOME/cmdline-tools/latest/bin/avdmanager"
[ -x "$SDKMANAGER" ] || { echo "sdkmanager not found at $SDKMANAGER"; exit 1; }

log "Accepting SDK licences"
yes 2>/dev/null | "$SDKMANAGER" --sdk_root="$ANDROID_HOME" --licenses >/dev/null 2>&1 || true

# arm64 host needs an arm64 system image; an x86_64 image would run under
# emulation at unusable speed.
ARCH=arm64-v8a
[ "$(uname -m)" = "x86_64" ] && ARCH=x86_64

log "Installing SDK packages (this is the slow part — a few GB)"
"$SDKMANAGER" --sdk_root="$ANDROID_HOME" \
  "platform-tools" \
  "platforms;android-$API" \
  "build-tools;$API.0.0" \
  "emulator" \
  "system-images;android-$API;$IMAGE_TAG;$ARCH"

log "Creating AVD '$AVD_NAME'"
if "$AVDMANAGER" list avd 2>/dev/null | grep -q "Name: $AVD_NAME"; then
  echo "AVD already exists"
else
  # Pixel 7 is a reasonable stand-in for the 412x892 Android artboard the design
  # was drawn against, and has a hole-punch camera like the prototype's chrome.
  echo "no" | "$AVDMANAGER" create avd \
    --name "$AVD_NAME" \
    --package "system-images;android-$API;$IMAGE_TAG;$ARCH" \
    --device "pixel_7" \
    --force
fi

log "Done"
cat <<EOF

Add to your shell profile (this script does not modify it):

  export JAVA_HOME="$JAVA_HOME"
  export ANDROID_HOME="$ANDROID_HOME"
  export ANDROID_SDK_ROOT="\$ANDROID_HOME"
  export PATH="\$PATH:\$ANDROID_HOME/platform-tools:\$ANDROID_HOME/emulator"

Boot the emulator with:  task emulator
EOF
