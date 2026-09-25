#!/bin/bash
# Installs Fork:
#   curl -fsSL https://raw.githubusercontent.com/harshii0509/Fork/main/install.sh | bash
set -euo pipefail

URL="https://github.com/harshii0509/Fork/releases/latest/download/Fork.dmg"
APP="Fork.app"

[ "$(uname)" = "Darwin" ] || { echo "Fork only runs on macOS."; exit 1; }
[ "$(uname -m)" = "arm64" ] || { echo "Fork needs an Apple Silicon Mac (M1 or newer) for now."; exit 1; }

TMP=$(mktemp -d)
MNT="$TMP/mnt"
cleanup() { hdiutil detach "$MNT" -quiet 2>/dev/null || true; rm -rf "$TMP"; }
trap cleanup EXIT

echo "Downloading Fork..."
curl -fL --progress-bar "$URL" -o "$TMP/app.dmg"

hdiutil attach "$TMP/app.dmg" -nobrowse -quiet -mountpoint "$MNT"

DEST="/Applications"
[ -w "$DEST" ] || { DEST="$HOME/Applications"; mkdir -p "$DEST"; }

rm -rf "$DEST/$APP"
cp -R "$MNT/$APP" "$DEST/"

echo "Installed to $DEST/$APP. Opening it now."
open "$DEST/$APP"
