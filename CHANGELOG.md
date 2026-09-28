# Fork (formerly Designer Terminal): changelog & proposed features

Newest first. **Proposed** holds ideas we talked about but haven't built yet, with the open questions to answer before building. **Changelog** is what actually changed.

Add each change people will notice under **Unreleased** as you make it, in plain words: it becomes the release notes, the update card and What's new word for word. `npm run release` turns it into the version heading (see [RELEASING.md](RELEASING.md)).

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

### Unreleased

**New**
- **Read a book while Claude works.** Open a PDF or EPUB in the side panel (⌘P → **Read**, drag one in, or click it in the file list) and read next to your terminal. Books keep their own fonts and white pages. Pick **Pages** to turn one page at a time (←/→, Space, or a two-finger swipe), or **Scroll** for one long scroll. Fork remembers your place in every book, and when Claude finishes, a note says so with a link back to the terminal.

**Fixed**
- **"Claude is working" shows only while Claude is working.** The bar at the bottom used to say "Something is running" the whole time Claude was open, even while it waited for you. Now it appears only while Claude works on your prompt, and its Stop button sends Esc, which is how Claude stops. An idle Claude tab shows Ready, and one that finished while you were in another tab says "Finished while you were away". Plain `claude` also reopens properly after a restart now.

### 0.3.1 — 2026-09-26

**Better**
- **Smarter matching goes through Fork's own server**, so Fork no longer carries a TypeSafe key inside the app. It works the same: plain words in ⌘K and errors worded differently still find the right answer.

### 0.3.0 — 2026-09-26

**New**
- **"What went wrong?" knows the common errors itself.** Missing tools, typos in folder names, a port that's already in use, a missing script, Git asking who you are, merge conflicts and about 30 more are explained instantly, even offline and without Claude, with a fix Fork types for you. For anything unusual, **Ask AI** takes a look.
- **⌘K answers in place.** Type what you want, like "how to run a dev server", and ⌘K shows the answer right there: what it does, the command, and **Run**. One Enter runs it; nothing is left half-typed in the terminal. Commands that need a name (a new folder, a branch, a GitHub link) ask for it in the card. **Ask AI** only shows when Fork's own list has no answer.
- **Ask AI answers sooner.** Fork gets Claude ready in the background while ⌘K is open, so answers come back a few seconds faster (about 5s instead of 8–10s in testing). Nothing is sent until you press Ask AI.
- **⌘K understands plain words.** "take me up one folder" or "save my work" finds the right command in under a second, without Claude. "What went wrong?" also recognises errors worded differently from the ones it knows. Both use Jev (TypeSafe), only when you use ⌘K or ask what went wrong. Turn it off in **Settings → Privacy → Smarter matching**.
- **Fork reopens the way you left it.** Quit, close the window or update, and next time your tabs, splits and folders are back, with what was on screen above a quiet "Restored" line. If Claude was running, it picks up the conversation where it left off. Closing every tab yourself means you're done, so the next start is fresh. Turn it off in **Settings → Startup**.
- **Find with ⌘F.** Search what's in a terminal: every match lights up, Enter and ⇧Enter move between them, Esc closes. ⌘G finds the next one.
- **Links you can click.** ⌘-click any web address in the output to open it in your browser. Your own app (localhost) shows up next to the terminal, like **Show it**.
- **Open things in their own apps.** Prefer your browser and your usual apps? Turn off **Settings → Links & files → Open links and files inside Fork**: your app opens in your browser, and files you click open in Preview, Figma or whatever your Mac uses for them.
- **Games while you wait.** Snake, Stack (falling blocks) and Space Run (a little shoot-em-up), like the old Nokia phones, in small square pixels and your theme's colours. A game opens as a pane next to your terminal (to the right, or below in a tall window) and fills it, with a status line along the bottom. No room for another pane? It gets its own tab. Open one from ⌘K (type "play" or a game's name) or with **Play a game while you wait** when something is running. Esc takes you back to the terminal (the game waits, paused) and ⌘W closes it. When Claude or a command in your terminal finishes while you're playing, the game pauses to tell you: Enter takes you back, Space keeps playing. Best scores are kept on your Mac. Sound is off until you turn it on, and games aren't reopened next time Fork starts.
- **The blob is pixel art now.** Every blob (in the sidebar, beside "Something is running", in "What went wrong?" and on the welcome cards) is drawn in solid square pixels, like a little game sprite. It still breathes, blinks, thinks and pulls faces the same way, and follows your theme colours.

**Better**
- **Explanations read only the command that failed**, not whatever else is on screen, so they're more accurate. If Claude's suggestion isn't a real command, Fork doesn't offer to type it.
- **Scroll back ten times further:** each terminal keeps its last 10,000 lines instead of 1,000, so a long Claude conversation is still there.
- **Smoother with busy output.** Terminals are drawn by your Mac's graphics chip, so long output and Claude's screens scroll without stutter.


### 0.2.1 — 2026-09-26

**Better**
- **New versions show up within the hour.** Fork looks for updates every hour and whenever you switch back to it, instead of every 6 hours. It still asks GitHub at most once an hour.

### 2026-09-26: Fork 0.2.0 released
Everything below, down to "updates", ships in 0.2.0: the first version that updates itself. People on 0.1.0 reinstall once.

### 2026-09-26 (installer window)
**Changed**
- **Opening Fork.dmg looks like Fork.** A warm cream window (the icon's colour) with a hand-drawn arrow from Fork to Applications and one quiet line: "Drag Fork into Applications". The window is titled just "Fork", not "Fork 0.1.0-arm64", and no longer shows a scrollbar.

### 2026-09-26 (shift+enter)
**Fixed**
- **Shift+Enter starts a new line in Claude** instead of sending your message. Enter still sends. At the normal prompt, Shift+Enter adds a second line to the command instead of running it.

### 2026-09-26 (onboarding)
**Added**
- **A welcome for people new to terminals.** The first time Fork opens, three short cards (with the blob) explain what a terminal is, that Fork does the typing, and that ⌘K and Claude are there when you're stuck. Next / Skip, dots for progress, and → ← Esc work too.
- **A spotlight tour** once you've picked where to work. It lights up one part at a time (the terminal, suggestions, the folder list, Search, Preview, your terminals) with a "2 of 6" count, Back / Next, and Skip tour. Skipping the cards skips the tour too.
- Replay it any time from **Settings → Help → Show again** or **Help → Show the Welcome Tour**.

**Changed**
- The welcome cards, the start screen and the update card sit in the middle of the window, not near the top. ⌘K stays near the top, because its list changes height as you type.
- **Icons are one size and weight:** 14px (the small ▸, × and stepper arrows stay 12px and 10px), all with a 1.5px line. Every icon now sits exactly in the middle of its button (the + next to Terminals was 2px off).
- Search and Settings in the sidebar, and the options on the start screen, are #E6E6E6 like the file list. The start-screen icons are gray instead of purple.
- **Shortcut hints are soft pills** (⌘K, ⌘, in the sidebar and "↵ Enter" in the bottom bar): easier to read than the old faint text, still quieter than the labels, with a little space between ⌘ and the key.

### 2026-09-26 (appearance)
**Changed**
- **Appearance: Light, Dark or System**, at the top of Settings → Appearance. Light and Dark show one Theme list with only that kind of theme. System follows your Mac and shows two lists, a Light theme and a Dark theme, then swaps between them when macOS switches (the frosted sidebar follows too).
- New installs start on System, with Designer for dark and Catppuccin Latte for light. If you'd already picked a theme, it stays: you land on its side (Dark or Light) with that theme selected.
- **Font smoothing is a switch.** On is macOS's own smoothing (the old "Default"); Off draws sharp, unsmoothed text. "Thin" is gone, and anyone who had it is now On.

**Removed**
- **"Stay frosted when unfocused."** The sidebar now always stays frosted when another app is in front. "Translucent sidebar" still turns the glass off altogether.

### 2026-09-26 (anonymous usage)
**Added**
- **Anonymous usage, to learn how new people use Fork.** Fork sends which features get used (start screen choice, commands by tool name like `git` or `claude`, sidebar, preview, ⌘K, settings) to PostHog under a random per-install ID. It never sends commands, file names, paths or output. It's on by default, with a line on the start screen that says so and a **Turn off** link, plus a switch in **Settings → Privacy**. See DISTRIBUTION.md.

### 2026-09-26 (sidebar blobs)
**Changed**
- **Each terminal in the sidebar has its own blob**, in place of the small grey/green dot, so you can tell what every tab is doing at a glance:
  - **Ready:** a round blob that breathes and blinks now and then.
  - **Running:** the "thinking" dots.
  - **Failed:** a red, sad blob when the last command ended in an error. The next command clears it. Stopping something with Ctrl+C doesn't count as failing.
  - **Finished while you were away:** a command ended in a tab you weren't looking at. The blob shows a little notification dot until you open that tab.
  - **Dozing:** no typing or commands for 5 minutes. The blob shrinks to a small, softly bobbing dot and wakes when you use the tab.
- With split panes, the tab shows whichever pane needs you most: running, then failed, then finished, then dozing.
- Hover a tab to read its state in words. The blobs follow the theme accent, and failed ones follow the theme red. With Reduce Motion on, they hold still.
- The blobs only react to what the terminal is doing. No sound or microphone input.

### 2026-09-26 (sidebar, Relay style)
**Changed**
- **Sidebar follows the Relay design.** The top row has the traffic lights, a sidebar toggle and ← → arrows, lined up with the main top bar. Under it: a "Fork" wordmark (IBM Plex Mono Bold), then **Search ⌘K** and **Settings ⌘,** as icon rows, then a thin divider. The Settings button at the bottom is gone.
- Section headings are quieter: sentence case, 12px, dimmed, instead of small caps. Rows are 13px, and the selected row is a softer 10% highlight with 6px corners.
- Hiding the sidebar (⌘B or the toggle) leaves a toggle in the top bar, in the same spot, to bring it back.
- **Files and folders are one gray.** Icons and names in the sidebar list and the preview header are #E6E6E6 on dark themes (the theme's text colour on light ones, so they stay readable). Icons still change shape by file type; the per-type colours and the accent-coloured folders are gone.

**Added**
- **Back and forward through folders**, like Finder: ← → in the sidebar, or ⌘[ and ⌘] (new **Go** menu). Each pane keeps its own history. They're greyed out when there's nowhere to go, and wait if something is running.

### 2026-09-26 (updates)
**Added**
- **Update pill:** when a newer Fork is on GitHub, a small "Fork X.Y.Z" pill shows in the top bar. Click it to read what's new, then **Update and restart**: Fork closes, installs the new version and reopens. Anything running in your terminals stops, so the card says so.
- **What's new:** the first time you open a new version, a card shows its release notes once.
- Works from the next release on. Anyone on 0.1.0 re-runs the install command once to get it.

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
