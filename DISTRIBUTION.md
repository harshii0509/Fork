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

## 3. Signing and notarization

Fork is signed with a **Developer ID** certificate and **notarized** by Apple (since 1.0.0), so it opens like any other Mac app, whether it came from a browser (which marks downloads with a **quarantine** flag that Gatekeeper checks) or from `curl` (which doesn't). There's no "Apple could not verify Fork" warning and no Open Anyway step. A browser download still gets macOS's normal "downloaded from the internet, open it?" question once.

The pieces, all on Harshvardhan's Mac (Apple Developer team `W34K99ZMX3`):

| Piece | Where | What it's for |
|---|---|---|
| **Developer ID Application** certificate | Keychain (made in Xcode → Settings → Accounts → Manage Certificates) | Signing. `package.json` → `build.mac.identity` names it. Only the Account Holder can make one. |
| **App Store Connect API key** `AuthKey_ZQKF9LDJFB.p8` | `~/.config/fork/` (chmod 600, never in the repo) | Sending builds to Apple for notarization. Apple only lets you download it once. |
| `~/.config/fork/notary.env` | same folder | `APPLE_API_KEY` (path to the .p8), `APPLE_API_KEY_ID`, `APPLE_API_ISSUER`. `npm run release` reads it. |

How a build uses them:

- **Every build is signed** (`npm run app` too). electron-builder signs with the Developer ID and the **hardened runtime**, which notarization requires. `build/entitlements.mac.plist` lists the three exceptions Fork needs under it: `allow-jit` and `allow-unsigned-executable-memory` for Electron's JavaScript engine, and `disable-library-validation` for node-pty (the terminals). The signature belongs to the team, not the build, so macOS keeps Fork's Downloads/Desktop/Documents permission across updates.
- **Only releases are notarized.** electron-builder notarizes the app only when the `APPLE_API_*` variables are set, so `npm run app` stays quick (your own builds don't need it). `npm run release` loads `notary.env`, electron-builder notarizes the app (5–10 minutes), then the script notarizes and staples `Fork.dmg` too, and checks that Gatekeeper says `source=Notarized Developer ID`.
- **New Mac?** Export the certificate from Keychain Access (Developer ID Application → right-click → Export, a `.p12` with a password) and copy `~/.config/fork/` across. Or make a new certificate in Xcode; the old one keeps working until it expires.
- **Expiry:** the certificate lasts 5 years; Apple Developer membership renews yearly ($99). Already-notarized releases keep opening even after either lapses.

To check a build by hand:

    codesign -dv --verbose=2 dist/mac-arm64/Fork.app   # Authority=Developer ID Application: …, flags=0x10000(runtime)
    spctl -a -vv dist/mac-arm64/Fork.app               # accepted, source=Notarized Developer ID
    xcrun stapler validate dist/Fork.dmg               # The validate action worked!

## 4. Packaging (done)

The app builds and installs locally. Everything lives in `package.json`:

- **`npm run app`** builds `Fork.app` and installs it into `/Applications`, replacing the old copy. Quit Fork first. This is the everyday command after making changes.
- **`npm run dist`** makes `dist/Fork.dmg` for sharing.
- The `build` block includes every file except dev-only ones (`*.md`, `check.mjs`, `build/`, `vendor/bloub/src/`, `shell/.zsh_history`), so new files ship without editing a list. It unpacks `shell/` (zsh can't read inside `app.asar`) and `node-pty` (its `spawn-helper`).
- `npmRebuild: false`: node-pty ships prebuilt binaries that work with Electron as they are, so nothing is compiled.
- **Signing:** Developer ID with the hardened runtime and `build/entitlements.mac.plist`; releases are notarized. See section 3.
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
   - `codesign -dv --verbose=2 "dist/mac-arm64/Fork.app"` shows `Authority=Developer ID Application` (it was `Signature=adhoc` before 1.0.0).
   - Open the `.app` **from Finder**:
     - the start screen appears;
     - typing `cd` in a pane moves the sidebar;
     - ⌘K → Ask AI returns a command (this confirms the PATH fix).
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

**How people get updates (1.0.0 and later):** Fork updates itself with `electron-updater` (`main.js`, "Updates"). On launch, then at most once an hour (also when its window comes to the front), it reads `latest-mac.yml` on the latest GitHub release. If there's a newer Fork it downloads the zip in the background; Squirrel.Mac checks the new app is signed by the same Developer ID team before using it. Once it's downloaded, a "Fork X.Y.Z · Restart" pill shows in the top bar. Clicking it opens the notes with **Restart now**, which saves the tabs, swaps the app and reopens it. Ignored, it installs the next time Fork quits. On the first launch of a new version, a "What's new" card shows the notes once (not if you just read them from the pill). Offline, nothing shows. `npm start` never checks.
- **Every release needs** `Fork.dmg` (new installs, `install.sh`, Forks before 1.0), `Fork-X.Y.Z-arm64-mac.zip` + its `.blockmap` (what updates download) and `latest-mac.yml` (what installed Forks read). `npm run release` uploads all four and checks the yml is live. Betas write `beta-mac.yml`, which installed Forks ignore, so betas stay link-only.
- **The old way, still there as a fallback:** a Fork that can't update itself in place (opened from the DMG instead of Applications, an `npm run app` build, which has no `app-update.yml`, or when the updater fails) shows a "Fork X.Y.Z" pill with **Update and restart**, which quits Fork, runs `install.sh` and reopens the new version. This is also how Forks before 1.0 reach 1.0.
- **Testing an update without publishing:** build the "old" version (zip target, it has to have `app-update.yml`) and a newer zip with `npx electron-builder --mac zip --arm64 --publish never -c.extraMetadata.version=X.Y.Z -c.directories.output=<folder>`, serve the newer folder with `python3 -m http.server 8765`, and open the old app with `FORK_UPDATE_URL=http://localhost:8765` (and `FORK_DATA_DIR` set to an empty folder, so your real tabs are left alone).

**Anonymous usage (PostHog):** a packaged Fork sends anonymous usage events to PostHog, so we can see how new people find their way around (`analytics.mjs`). It's on by default. The start screen says so, with a **Turn off** link, and **Settings → Privacy → Share anonymous usage** switches it off or on.
- **Who:** one random ID per install, stored in `~/Library/Application Support/designer-terminal/analytics.json`. No login, name or email. Turn on **Discard client IP data** in the PostHog project settings.
- **What:** which features get used: `app_opened` / `app_closed`, `start_choice`, `command_run` / `command_failed` (just the tool, like `git` or `claude`, from an allow-list; anything else becomes `other`), `folder_opened`, `file_previewed` (the file type only), `palette_opened` / `palette_used`, `tab_opened`, `pane_split`, `setting_changed`, `update_clicked`, and a few more (search `dt.track(` in `renderer.js`). Every event is charted on the PostHog dashboard; `scripts/dashboard-charts.mjs` is the full list, and `npm run check` keeps the two in step.
- **Never:** commands, file or folder names, paths, terminal output, or what's typed in ⌘K.

**Smarter matching (Jev, by TypeSafe):** when someone types plain words in ⌘K, or clicks "What went wrong?" on an error Fork's library doesn't recognise, Fork sends that text (the request, or the failed command's output) through Fork's website (`fork-website`, `app/api/jev/route.ts`) to TypeSafe to pick the matching built-in command or known error (`jev.mjs`). Never in the background. On by default; **Settings → Privacy → Smarter matching** turns it off.
**Ask AI (Claude Code, `claude.mjs`):** uses the person's own Claude Code login. Opening ⌘K or pressing "What went wrong?" starts Claude Code (Haiku) in the background so an answer comes a few seconds sooner; it sends nothing until Ask AI is pressed, closes after 5 minutes unused, and quits with Fork. While running it uses about 250 MB of memory. Without Claude Code (or logged out) it fails quietly and Ask AI says so.
- **Key:** the TypeSafe key lives only on the server, as `TYPESAFE_API_KEY` in the fork-website Vercel project (live at https://fork-terminal.vercel.app/api/jev). **No key is inside Fork** (0.3.1 and later; 0.3.0 shipped one, which has been replaced). The server only accepts Fork's two questions (the instructions in `jev.mjs` `INSTRUCTIONS`, which `npm run check` keeps in step with the route), caps the text at 4,000 characters, and allows about 60 asks per 10 minutes per address. Keep a spending limit on the key in TypeSafe as the ceiling. Server down or offline: Fork works without Jev. To test against a local copy: `npx next dev` in fork-website with `TYPESAFE_API_KEY` set, then `FORK_JEV_URL=http://localhost:3000/api/jev npm start`.
- **Key:** `POSTHOG_KEY` / `POSTHOG_HOST` at the top of `analytics.mjs`. An empty key sends nothing. `npm start` never sends: it prints each event to the terminal it was started from. `FORK_ANALYTICS=1 npm start` sends for real, for testing.

## 7. README snippet for users

```markdown
## Install

**Easiest:** paste this into Terminal and press Enter:

    curl -fsSL https://raw.githubusercontent.com/harshii0509/Fork/main/install.sh | bash

**Or download the app:** [Fork.dmg](https://github.com/harshii0509/Fork/releases/latest/download/Fork.dmg).
Drag it to Applications and open it.

Requires an Apple Silicon Mac (M1 or newer).
```

## 8. Later

- ~~**Notarization**~~ Done in 1.0.0 (section 3).
- ~~**Automatic updates**~~ Done in 1.0.0 (electron-updater, see "How people hear about it").
- ~~**A landing page**~~ Built: Next.js site in its own repo, [harshii0509/fork-website](https://github.com/harshii0509/fork-website) (local copy `~/Downloads/fork-website`), from the Figma file "Fork", frame `13:7616`. **Download for Mac** points at the "latest" URL, so new releases need no site changes. It's hosted on Vercel, connected to the repo, so every push to `main` deploys. Since 1.0.0 browser downloads open without a warning, so the page needs no "Open Anyway" help.
- **Intel support**: an `x64` or `universal` build.
- **Size**: Electron DMGs run about 100 MB, compared with Nyx's native 19 MB. That's fine for now.
