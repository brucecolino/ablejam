#!/bin/bash
# Installs the AbleJam control surface into Ableton Live's User Library on macOS.
# Double-click in Finder, or run:  ./bridge/install.command
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
SRC="$HERE/AbleJam"
DEST="$HOME/Music/Ableton/User Library/Remote Scripts/AbleJam"

if [ ! -d "$SRC" ]; then echo "Source not found: $SRC" >&2; exit 1; fi

mkdir -p "$(dirname "$DEST")"
rm -rf "$DEST"
cp -R "$SRC" "$DEST"

echo "Installed AbleJam control surface to:"
echo "  $DEST"
echo ""
echo "Next steps:"
echo "  1. FULLY QUIT and reopen Ableton Live 12 (control surfaces are scanned at startup)."
echo "  2. Live > Settings > Link, Tempo & MIDI > Control Surface: select 'AbleJam'."
echo "  3. For PANIC: Audio MIDI Setup > IAC Driver > tick 'Device is online'."
echo "     Then in Live route the drum track: MIDI From = IAC Driver, Monitor = In."
echo "  4. You should see 'AbleJam connected' in Live's status bar."
