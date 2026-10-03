#!/bin/bash
# npm run app, after the build: put dist/mac-arm64/Fork.app into /Applications.
# Never swap Fork's files while it's open: a running Fork keeps reading its old app.asar, gets slices
# of the new one, and shows code as text. So if it's open, ask it to quit (it remembers its tabs),
# install, and open it again. A dev copy from `npm start` runs as Electron and is left alone.
#
# You're usually running this inside Fork, and quitting Fork closes that terminal and everything in
# it. So when Fork is open, this hands itself to a copy that isn't tied to the terminal (its own
# session, via setsid), which carries on after Fork quits. What it did goes to ~/Library/Logs/fork-install.log.
set -euo pipefail
APP=/Applications/Fork.app
ID=com.forkterminal.app
NEW="$(cd "$(dirname "$0")/.." && pwd)/dist/mac-arm64/Fork.app"
LOG="$HOME/Library/Logs/fork-install.log"
# ps, not pgrep: pgrep sometimes misses Fork when run from inside it.
running() { ps -axo command= | grep -qx "$APP/Contents/MacOS/Fork"; }
tell() { osascript -e "display notification \"$1\" with title \"Installing Fork\"" >/dev/null 2>&1 || true; }

install() {
  rm -rf "$APP" && ditto "$NEW" "$APP" && rm -rf "$NEW" && echo "Installed $APP"
}

if ! running; then
  install
  exit 0
fi

if [ "${FORK_INSTALL_DETACHED:-}" != 1 ]; then
  echo "Fork is open, so it will quit, update and reopen with your tabs in a few seconds."
  echo "(If you're running this inside Fork, this terminal closes too. Details: $LOG)"
  FORK_INSTALL_DETACHED=1 nohup perl -MPOSIX -e 'POSIX::setsid(); exec @ARGV' /bin/bash "$0" >"$LOG" 2>&1 </dev/null &
  exit 0
fi

# The detached copy: quit Fork, install, reopen. If installing fails, reopen the old one anyway.
sleep 1 # let npm and the terminal finish printing first
echo "$(date): quitting Fork"
osascript -e "quit app id \"$ID\"" >/dev/null
for _ in $(seq 1 60); do running || break; sleep 0.25; done # up to 15s; saving tabs takes about 3
if running; then
  echo "Fork didn't quit"
  tell "Fork didn't quit. Quit it (⌘Q) and run npm run app again."
  exit 1
fi
install || tell "Couldn't install the new Fork. See ~/Library/Logs/fork-install.log"
open -b "$ID" && echo "Reopened Fork"
