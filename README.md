# Fork

A terminal for designers, with Claude built in. Split panes, a file sidebar that follows `cd`, file previews, and ⌘K to ask Claude for a command in plain English.

## Install

**Easiest:** paste this into Terminal and press Enter:

    curl -fsSL https://raw.githubusercontent.com/harshii0509/Fork/main/install.sh | bash

**Or download the app:** [Fork.dmg](https://github.com/harshii0509/Fork/releases/latest/download/Fork.dmg).
Drag it to Applications. The first time you open it, macOS may say it can't verify the app:
open System Settings → Privacy & Security and click **Open Anyway**.

Requires an Apple Silicon Mac (M1 or newer).

## Develop

    npm install
    npm start        # run from source
    npm run app      # build Fork.app and install it into /Applications
    npm run dist     # build dist/Fork.dmg

See [DISTRIBUTION.md](DISTRIBUTION.md) for how releases work.
