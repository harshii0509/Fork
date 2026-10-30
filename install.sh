#!/bin/bash
# Installs Fork:
#   curl -fsSL https://raw.githubusercontent.com/harshii0509/Fork/main/install.sh | bash
set -euo pipefail

URL="https://github.com/harshii0509/Fork/releases/latest/download/Fork.dmg"
APP="Fork.app"
TEAM="W34K99ZMX3" # Fork's Apple Developer ID team

[ "$(uname)" = "Darwin" ] || { echo "Fork only runs on macOS."; exit 1; }
[ "$(uname -m)" = "arm64" ] || { echo "Fork needs an Apple Silicon Mac (M1 or newer) for now."; exit 1; }

TMP=$(mktemp -d)
MNT="$TMP/mnt"
cleanup() { hdiutil detach "$MNT" -quiet 2>/dev/null || true; rm -rf "$TMP"; }
trap cleanup EXIT

# FORK_DMG=<file> FORK_DEST=<folder> bash install.sh: install a local DMG somewhere else, without opening it (for testing).
echo "Downloading Fork..."
if [ -n "${FORK_DMG:-}" ]; then cp "$FORK_DMG" "$TMP/app.dmg"
else curl -fL --proto '=https' --progress-bar "$URL" -o "$TMP/app.dmg"; fi

hdiutil attach "$TMP/app.dmg" -nobrowse -quiet -mountpoint "$MNT"

# Only a Fork signed by Fork's own team, that macOS accepts, replaces the one you have.
signed() {
  codesign --verify --deep --strict "$1" 2>/dev/null &&
    [ "$(codesign -dv "$1" 2>&1 | sed -n 's/^TeamIdentifier=//p')" = "$TEAM" ] &&
    spctl -a -t exec "$1" 2>/dev/null
}
signed "$MNT/$APP" || { echo "This download isn't a Fork signed by Fork, so nothing was changed."; exit 1; }

DEST="${FORK_DEST:-/Applications}"
[ -w "$DEST" ] || { DEST="$HOME/Applications"; mkdir -p "$DEST"; }

# Copy next to the old one first, so a failed copy never leaves you without Fork.
rm -rf "$DEST/.$APP.new"
cp -R "$MNT/$APP" "$DEST/.$APP.new"
rm -rf "$DEST/$APP"
mv "$DEST/.$APP.new" "$DEST/$APP"

echo "Installed to $DEST/$APP."
[ -n "${FORK_DEST:-}" ] || { echo "Opening it now."; open "$DEST/$APP"; }
