# Fork (formerly Designer Terminal): changelog & proposed features

Newest first. **Proposed** holds ideas we talked about but haven't built yet, with the open questions to answer before building. **Changelog** is what actually changed.

---

## Proposed

### Blur the window in Mission Control (like Granola)
When you swipe up with three fingers, Granola's window turns into a frosted card that says "Granola is here", so its content stays private. We built this and then took it out: it's nice to have, and the UX needs deciding first.

**Open UX questions**
- Only in Mission Control, or also App Exposé (three fingers down), which triggers the same way?
- What goes in the middle: the app name, or the current folder (useful with several windows open)?
- On by default, or off?
- Should it ever blur outside Mission Control? The first version blurred whenever the window lost focus, which hid terminal output when it sat next to another app. That felt wrong.

**What we learned (enough to rebuild it quickly)**
- macOS has no public "Mission Control opened" event. Granola runs a native helper (`Resources/native/mission_control.node`) built on private SkyLight APIs.
- WindowServer sends notification **1328** when Mission Control closes (via `CGSRegisterNotifyProc`, after `SLSMainConnectionID`), but **nothing when it opens**.
- What works: a tiny Swift helper that polls our window's on-screen scale with `SLSGetCatenatedWindowTransform` about 12 times a second. The scale is 1.0 normally and about 2.6 in Mission Control. Tested: one `enter` and one `exit` every time, and plain app switching doesn't trigger it. It doesn't need Accessibility permission.
- The window ID comes from `win.getMediaSourceId()` (`window:<id>:0`). Build with `swiftc -F /System/Library/PrivateFrameworks -framework SkyLight`. It's a private API, so a macOS update could break it.
- For the look, blur `.app` itself with `filter: blur()` and scale it up about 4% to hide the edges. `backdrop-filter` is patchy over the translucent sidebar.

### Smaller ideas skipped along the way
- Remember the sidebar width, whether it's hidden, and pane sizes across launches.
- More terminal options: line height, cursor style, ⌘+ / ⌘− for font size.
- Live theme preview on hover. We lost it when themes moved to a native dropdown.
- An accent colour that overrides the theme's.
- A list of Settings sections on the left, once there's more than Appearance.

---

## Changelog

### 2026-09-26 (on GitHub)
**Added**
- **Fork is public** at https://github.com/harshii0509/Fork, with a README. Anyone on an Apple Silicon Mac can install it with `curl -fsSL https://raw.githubusercontent.com/harshii0509/Fork/main/install.sh | bash`, or download `Fork.dmg` from the latest release.

### 2026-09-26 (Fork, installed)
**Added**
- **The app is called Fork** and installs as a real Mac app, `/Applications/Fork.app`. Open it from Spotlight, Launchpad or the Dock. Keep it in the Dock with right-click → Options → Keep in Dock.
- **`npm run app`** rebuilds and reinstalls it after changes (quit Fork first). `npm start` still runs the development copy, and both can be open at once, each with its own settings and recent folders.
- **App icon:** a hand-drawn fork on cream, fitted to the macOS icon shape (an 824px rounded square with the standard shadow). The artwork is `build/icon-art.png`; `build/icon.svg` fits it to the shape and renders `build/icon.png`, which the build uses.

**Fixed**
- Ask Claude and "What went wrong?" work when Fork is opened from Finder or the Dock. Those launches get a bare PATH, so Fork now borrows the one your shell uses.
- Commands you run in the app go into your normal `~/.zsh_history` again. macOS's `/etc/zshrc` had been saving them inside the app's own `shell` folder, so up-arrow history from other terminals didn't include them. The 32 commands already stuck in `shell/.zsh_history` are still there.

### 2026-09-26 (blob)
**Changed**
- **The blob shows when something is working.** Bloub, the mascot from the `reactive-blobs` side project, replaces the green pulsing dot in "Something is running". It morphs into its "thinking" dots, pulses while the command runs, and goes back to rest when the command finishes.
- **"What went wrong?" has a thinking blob too.** A curious blob sits beside "Reading the error…" until Claude's answer comes in.
- **The blob follows the theme accent** and fades to the new colour when you switch themes. With Reduce Motion on, it holds still.
- The mascot's framework-free core lives in `vendor/bloub/` (MIT, see its `LICENSE`). `bloub.js` is prebuilt, so `npm start` doesn't need a build step. After changing `vendor/bloub/src`, run `npm run build:bloub`. `npm run check` makes sure the bundle loads and draws.

### 2026-09-25 (icons)
**Changed**
- **One icon set everywhere: [Lucide](https://lucide.dev).** It replaces the hand-drawn icons and the text characters that stood in for icons (✕ ‹ › ↻ ＋ ↓ ▲ ▼). This covers the top bar, sidebar, preview panel, start screen, Settings and the dismiss buttons. The icons live in `icons.js`; to add one, copy the inside of its `<svg>` from lucide.dev.
- **Files show what they are.** The tree has an icon per kind, coloured from the terminal theme so every theme still works:
  - images, video, audio and design files (`.fig`, `.sketch`…): magenta
  - code: blue
  - styles: cyan
  - HTML and config: yellow/orange
  - PDF: red
  - docs: dim
- Open folders show an open-folder icon. The preview panel's header shows the file's icon too.
- In the preview header, **Finder** and **Browser** became icon buttons. Hover shows what they do.
- Scrollbars are thin, on a clear track, and follow the theme. No more white strip down the sidebar when the file list is long.

### 2026-09-25 (later)
The folder sidebar becomes the way to look at a project, without turning the app into a code editor. Files can be previewed but not typed into. Real edits go to the person's editor.

**Added**
- **Preview panel** on the right (**⌘P**, or the new button in the top bar). Drag its edge to resize.
  - **File:** click a file in the sidebar to see it next to the terminal:
    - **Images and videos**, with pixel size (transparency shows as a checkerboard).
    - **Markdown**, rendered. Relative images load, website links open in the browser, and links to other files open in the panel.
    - **Code**, read-only, with line numbers and the same colouring VS Code uses (Shiki). The colours follow the terminal theme.
    - Anything over 1 MB or not text says so instead.
    - **Open in {Cursor / VS Code / Zed}** (whichever is installed) and **Finder** buttons.
    - The preview updates when the file changes on disk, so you can watch Claude's edits land.
  - **App:** when the terminal prints a local address (like `http://localhost:3000` from `npm run dev`), a bar offers **"Your app is running at localhost:3000 · Show it"**. The app opens in the panel with back/forward, reload, an address field ("3000" is enough) and **Browser**. Switching between App and File keeps the page as it was.
  - `.html` files have **View as page**.
- **Folder tree:** ▸ opens a folder in place, and clicking a folder's name still moves there. `node_modules`, `dist`, `build` and similar are greyed out and listed last.
- **Drag a file onto a terminal** (from the sidebar or Finder) to type its path at the cursor, in the form Claude Code expects (`My\ Designs/hero.png`). It works while Claude is running.

**Changed**
- The file list stays usable while something is running. Only moving to another folder waits.
- The file list updates by itself when files are added, removed or renamed (by Claude, Finder or anything else), not only after a `cd`.
- Clicking a file previews it instead of opening it in its default app. **Open** in the preview does that.

### 2026-09-25
**Added**
- **⌘B** hides and shows the sidebar.
- Drag the line between split panes to resize them. Double-click it to go back to 50/50.
- Drag the sidebar's edge to resize it (180–420px).
- **Settings** (⌘, or the gear at the bottom of the sidebar) replaces the terminal while it's open. The sidebar shows "‹ Back to terminal" and ☀ Appearance. It contains:
  - **Theme:** 27 themes, 18 dark and 9 light (Designer, Dracula, Nord, Tokyo Night, Catppuccin, Gruvbox, One Dark/Light, Solarized, GitHub, Rosé Pine, Monokai Pro, Night Owl, Ayu, Everforest, Kanagawa, Poimandres, Vesper). The whole app follows the theme.
  - **Font:** JetBrains Mono, Geist Mono, IBM Plex Mono and Fira Code come with the app, plus any coding fonts installed on the Mac.
  - **Font size** box with ▲/▼ (8–32), and **font smoothing** (Default / Thin / Off).
  - A **preview** terminal that shows your choices.
  - **Translucent sidebar** switch (off = solid theme colour) and **Stay frosted when unfocused**.
- Settings are remembered after you quit, and other open windows follow changes.

**Changed**
- The suggestion chips ("Show in Finder", "Go up a folder"…) moved into the sidebar under Quick search.
- The bottom bar now only appears when it has something to say (the Enter-to-run hint, "Something is running", "That didn't work", or the ⌘ shortcut list), so the terminal gets the full height.

**Removed**
- Glass material dropdown and tint slider. One "Translucent sidebar" switch replaces them.
- Blur when the window is unfocused. Moved to Proposed above.
