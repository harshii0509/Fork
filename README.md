# Fork

A terminal for designers, with Claude built in. Split panes, a file sidebar that follows `cd`, file previews, and ⌘K to ask Claude for a command in plain English.

https://github.com/user-attachments/assets/c06bb1b9-58f7-4fd4-94d4-fc6b548e3b44

## Install

**Easiest:** paste this into Terminal and press Enter:

    curl -fsSL https://raw.githubusercontent.com/harshii0509/Fork/main/install.sh | bash

**Or download the app:** [Fork.dmg](https://github.com/harshii0509/Fork/releases/latest/download/Fork.dmg).
Drag it to Applications and open it.

Requires an Apple Silicon Mac (M1 or newer).

## Develop

    npm install
    npm start        # run from source
    npm run app      # build Fork.app and install it into /Applications
    npm run dist     # build dist/Fork.dmg
    npm run release -- patch   # ship a new version (see RELEASING.md)

See [RELEASING.md](RELEASING.md) for version numbers and shipping, and [DISTRIBUTION.md](DISTRIBUTION.md) for how installing and updating work.
