# Distributing Fork (formerly Designer Terminal)

How to ship the app as a `.dmg` plus a one-line `curl` install, the way Nyx does it.
The public repo is https://github.com/harshii0509/Fork. `install.sh` and `README.md` are in its root.

---

## 1. How Nyx does it

nyxterm.com offers two options that are really one:

- **Download for Mac** button
- `curl -fsSL https://nyxterm.com/api/download -o Nyx.dmg`

Both hit `https://nyxterm.com/api/download`, which answers with a `307` redirect to the newest build in blob storage:

```
/api/download  ->  .../releases/v1.31.9/Nyx.dmg   (about 19 MB)
```

The curl command only downloads the `.dmg`. It does not run an install script. The trick is a **stable URL that always points at the latest release**, so the website and the command never change between versions.

## 2. Our version of that

| Piece | Choice |
|---|---|
| Build | `electron-builder` makes `Fork.app` and `Fork.dmg` |
| Hosting | GitHub Releases (free) on a **public** repo |
| Stable "latest" URL | `https://github.com/harshii0509/Fork/releases/latest/download/Fork.dmg` |
| One-line install | `curl -fsSL https://raw.githubusercontent.com/harshii0509/Fork/main/install.sh \| bash` |

GitHub's `releases/latest/download/<file>` is the free version of Nyx's `/api/download` redirect. It only works if the file name is the **same in every release**, so the DMG must be called `Fork.dmg`, with no version number in it.

The repo has to be public, or `curl` gets a 404 for anyone who isn't logged in.

## 3. Signing, and why curl matters without it

macOS Gatekeeper checks apps that carry a **quarantine** flag. Browsers add that flag to downloads. `curl` doesn't.

Without an Apple Developer account ($99/yr), that means:

- **curl install:** no warning. The app just opens. Make this the main path in the README.
- **.dmg from a browser:** the first launch says *"Apple could not verify 'Fork' is free of malware"*. The user has to fix it once:
  1. Try to open the app, then click **Done**.
  2. Open **System Settings → Privacy & Security**.
  3. Scroll down, click **Open Anyway** next to Fork, and confirm.

  (Right-click → Open no longer skips this on macOS 15 and later.)

On Apple Silicon every binary needs *some* signature, or macOS says the app "is damaged". So the build uses an **ad-hoc signature** (`"identity": "-"`). It's free, and it's not the same as notarization.

**Later**, a Developer ID certificate plus notarization removes the warning completely. electron-builder does both once you set `mac.identity`, `mac.notarize: true`, and the App Store Connect API key env vars (`APPLE_API_KEY`, `APPLE_API_KEY_ID`, `APPLE_API_ISSUER`).

## 4. Packaging (done)

The app builds and installs locally. Everything lives in `package.json`:

- **`npm run app`** builds `Fork.app` and installs it into `/Applications`, replacing the old copy. Quit Fork first. This is the everyday command after making changes.
- **`npm run dist`** makes `dist/Fork.dmg` for sharing.
- The `build` block includes every file except dev-only ones (`*.md`, `check.mjs`, `build/`, `vendor/bloub/src/`, `shell/.zsh_history`), so new files ship without editing a list. It unpacks `shell/` (zsh can't read inside `app.asar`) and `node-pty` (its `spawn-helper`).
- `npmRebuild: false`: node-pty ships prebuilt binaries that work with Electron as they are, so nothing is compiled.
- **Signing:** ad-hoc (`identity: "-"`) with `hardenedRuntime: false`. With an ad-hoc signature the hardened runtime stops the native modules from loading, and the app quits silently on launch. Turn it back on together with a Developer ID and notarisation.
- `main.js` points `ZDOTDIR` at `app.asar.unpacked/shell`, and borrows `PATH` from an interactive login shell so `claude` is found when the app is opened from Finder or the Dock.
- **Icon:** `build/icon-art.png` is the artwork (1024×1024, full bleed). `build/icon.svg` fits it into the macOS shape (an 824px rounded square with a shadow on the 1024 canvas) and is rendered to `build/icon.png`, which the build uses. To change the icon, replace `icon-art.png`, re-render `icon.png` from `icon.svg` (any SVG renderer; Claude used an offscreen Electron window), then run `npm run app`. If the Dock keeps the old icon, run `killall Dock`.
- **Installer window** (what opening `Fork.dmg` shows): a cream background with a hand-drawn arrow and "Drag Fork into Applications". The design is `build/dmg-background.html` (600×400). `npm run dmg:background` renders it to `build/background.png` and `background@2x.png`, which electron-builder picks up by itself. The window title (`Fork`), icon size and the two icon spots (their centres, which sit on the arrow's line) are in `package.json` → `build.dmg`. Move the icons and the arrow together.
- **Reopening:** `session.json` in the same folder holds each window's tabs, splits, folders and the last 1,000 lines of each pane (`session.mjs`, `main.js`). It's readable only by the user and never leaves the Mac.
- **Settings:** the installed app and `npm start` share one settings folder, `~/Library/Application Support/designer-terminal` (Electron names it after `name` in `package.json`, not `build.productName`). Don't rename it: everyone's settings, recent folders and usage ID live there. For a clean first run from source, use `FORK_DATA_DIR=/some/empty/folder npm start`.

**Name check before going public:** there is already a well-known Mac Git client called Fork (fork.dev, `/Applications/Fork.app`). Anyone who has it would get a clash, and the name may be taken. Decide before the first public release.

## 5. `install.sh` (ready to copy into the repo root)

```bash
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
```

Because `curl` downloads the DMG, the app has no quarantine flag and opens without the Gatekeeper prompt.

## 6. Release checklist

First release:

1. ~~Create a **public** repo.~~ Done: `harshii0509/Fork`.
2. ~~Make the code changes in section 4 and add `install.sh`.~~ Done.
3. `npm install`, then `npm run dist`. The output is `dist/Fork.dmg` and `dist/mac-arm64/Fork.app`.
4. Check the build:
   - `ls "dist/mac-arm64/Fork.app/Contents/Resources/app.asar.unpacked/shell/"` shows `.zshrc`, `.zprofile` and `.zshenv`. Dotfiles can get filtered out; if they're missing, add `"shell/.*"` to `files`.
   - `codesign -dv "dist/mac-arm64/Fork.app"` shows `Signature=adhoc`.
   - Open the `.app` **from Finder**:
     - the start screen appears;
     - typing `cd` in a pane moves the sidebar;
     - ⌘K → Ask Claude returns a command (this confirms the PATH fix).
5. Push, then publish:

   ```bash
   gh release create v0.1.0 dist/Fork.dmg \
     --title "Fork 0.1.0" \
     --notes "Install: curl -fsSL https://raw.githubusercontent.com/harshii0509/Fork/main/install.sh | bash"
   ```

6. Test like a stranger would:
   - `curl -fsSIL https://github.com/harshii0509/Fork/releases/latest/download/Fork.dmg` ends in `200`.
   - Run the install one-liner. It lands in /Applications and opens with no warning.

Every later release: `npm run release -- patch` (or `minor`, `major`, `beta`). See [RELEASING.md](RELEASING.md) for version numbers, the changelog, betas and what to do when a release is broken.

The "latest" URL and the curl command stay the same.

**How people hear about it:** a packaged Fork asks GitHub for the latest release on launch, every hour, and when its window comes to the front, at most one GitHub call an hour (`update:check` in `main.js`). If it's newer, a small "Fork X.Y.Z" pill shows in the top bar. Clicking it opens the release notes with **Update and restart**. That quits Fork, runs `install.sh` (the same one-liner users installed with), and reopens the new version. On the first launch of a new version, a "What's new" card shows the notes once. Offline, nothing shows. `npm start` never checks.

**Anonymous usage (PostHog):** a packaged Fork sends anonymous usage events to PostHog, so we can see how new people find their way around (`analytics.mjs`). It's on by default. The start screen says so, with a **Turn off** link, and **Settings → Privacy → Share anonymous usage** switches it off or on.
- **Who:** one random ID per install, stored in `~/Library/Application Support/designer-terminal/analytics.json`. No login, name or email. Turn on **Discard client IP data** in the PostHog project settings.
- **What:** which features get used: `app_opened` / `app_closed`, `start_choice`, `command_run` / `command_failed` (just the tool, like `git` or `claude`, from an allow-list; anything else becomes `other`), `folder_opened`, `file_previewed` (the file type only), `palette_opened` / `palette_used`, `tab_opened`, `pane_split`, `setting_changed`, `update_clicked`, and a few more (search `dt.track(` in `renderer.js`).
- **Never:** commands, file or folder names, paths, terminal output, or what's typed in ⌘K.
- **Key:** `POSTHOG_KEY` / `POSTHOG_HOST` at the top of `analytics.mjs`. An empty key sends nothing. `npm start` never sends: it prints each event to the terminal it was started from. `FORK_ANALYTICS=1 npm start` sends for real, for testing.

## 7. README snippet for users

```markdown
## Install

**Easiest:** paste this into Terminal and press Enter:

    curl -fsSL https://raw.githubusercontent.com/harshii0509/Fork/main/install.sh | bash

**Or download the app:** [Fork.dmg](https://github.com/harshii0509/Fork/releases/latest/download/Fork.dmg).
Drag it to Applications. The first time you open it, macOS may say it can't verify the app:
open System Settings → Privacy & Security and click **Open Anyway**.

Requires an Apple Silicon Mac (M1 or newer).
```

## 8. Later

- **Notarization** (needs the Apple Developer Program). It removes the Open Anyway step for browser downloads.
- **Silent auto-updates** with `electron-updater`, replacing the update pill. Squirrel.Mac won't update an ad-hoc signed app, so notarization comes first.
- ~~**A landing page**~~ Built: Next.js site in its own repo, [harshii0509/fork-website](https://github.com/harshii0509/fork-website) (local copy `~/Downloads/fork-website`), from the Figma file "Fork", frame `13:7616`. **Download for Mac** points at the "latest" URL, so new releases need no site changes. It's hosted on Vercel, connected to the repo, so every push to `main` deploys. The page has no curl one-liner and no "Open Anyway" help yet; add them if browser downloads trip people up.
- **Intel support**: an `x64` or `universal` build.
- **Size**: Electron DMGs run about 100 MB, compared with Nyx's native 19 MB. That's fine for now.
