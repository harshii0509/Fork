# Fork speed audit

*Measured 7 Oct 2026 on the redesign (`ui-redesign`, working tree as of 17:23), on this Mac. The fixes worth doing each have a GitHub issue (see "What to do first").*

## Where Fork sits

| | Fork (redesign) | For comparison |
|---|---|---|
| **Launch** (to the restored terminal on screen) | **1.85 s**, or **0.85 s** with the login-shell fix | Empty Electron app: 0.5 s |
| **Memory, 1 terminal** | **285 MB** | Codex CLI alone: about 80–100 MB (reported on HN). Codex desktop app: 4–15 GB in bug reports |
| **Memory, 8 terminals** | **377 MB**; **453 MB** with full scrollback | Each extra terminal costs about 12 MB, plus about 5 MB for the shell |
| **CPU, idle** | **0.2%** of one core | Good |
| **CPU, idle with an unseen "done" or "failed" tab** | **16%** of one core, nonstop | Should be about 0.2% |
| **20 MB of agent output in one terminal** | **1.4 s** on screen, 115 fps, **no freezes** | Good. The generator alone takes 0.5 s |
| **Many terminals** | Terminals 18 and up silently lose GPU drawing | Rare for designers |
| **Page load** (inside the window) | 0.29 s | Good |

**The short version:** Fork is light for an Electron app. It's about 4× a native terminal, but nowhere near the Codex app. It handles agent output well. Two specific things make it feel heavier than it is: **launch waits on your shell**, and **a pulsing tab dot keeps the CPU busy**. Both are small fixes.

## How it was measured
- **The app under test:**
  - A copy of the redesign's working folder in the scratch folder. The real `fork-ui` folder, your dev data (`~/.fork-ui-dev`) and your installed Fork were never touched.
  - It started from a clean, saved session: 1 workspace, 1 terminal, in a tiny test project.
  - It was driven over CDP by a script (`bench.mjs`; commands below).
- **What counts as memory:** macOS `footprint` (real memory per process, more honest than Activity Monitor's numbers), added up across all of Fork's processes. Shells are counted separately.
- **CPU:** CPU time used by Fork's processes over 45–60 s, as a % of one core.
- **No real AI agents ran.** Agent output was simulated by a script that prints the way Claude does: coloured lines, a redrawn "Working… esc to interrupt" line and spinner titles.
- **Repeats:** each launch was run 4×; the number shown is the middle of the last 3.
- **Not compared:** the installed Fork 1.0.2 wasn't running at the time.

Where memory goes, with 1 terminal (285 MB):

| Process | MB | What it is |
|---|---|---|
| GPU process | 146 | Draws everything. Grows with each terminal's WebGL drawing (219 MB at 8 full terminals) |
| Fork window | 67 | The page and xterm. 159 MB at 8 full terminals |
| Main process | 49 | Windows, terminals, IPC |
| Notch window | 17 | Created even though the notch is off by default |
| Network process | 7 | |

Turning WebGL off for all 8 terminals saves about 60 MB (377 → 315 MB). Idle CPU is the same either way.

---

## Findings

### 1. Launch waits for your whole shell to load, twice (measured)
- **What happens:**
  - Before Fork even creates its window, `main.js:36-41` runs `execFileSync($SHELL, ['-ilc', …])`, a full interactive login shell, just to copy its PATH.
  - On this Mac, `zsh -ilc` takes **0.8–1.6 s** (oh-my-zsh and friends).
  - Nothing appears until it finishes. Then each terminal starts its own shell anyway.
- **Number:** launch is **1.85 s**. With that step skipped it's **0.85 s**, 54% faster. An empty Electron app takes 0.5 s, so Fork's own startup work is otherwise small.
- **Also in 1.0.2:** the same code is on main (`main.js:34`), so today's users pay it too.
- **Fix (S):**
  - Run the PATH lookup in the background (`execFile`, not `execFileSync`) while the window opens.
  - Only the things Fork itself runs need it (Ask AI's `claude`, "is X installed?" checks), so they can wait for it.
  - Optionally, cache the last PATH and refresh it in the background.
- **Gain:** about **1 s off every launch**, more for people with slow shell setups. Fork feels instant.

### 2. A pulsing tab dot costs 16% of a CPU core for as long as it pulses (measured)
- **What happens:**
  - When a command finishes or fails in a terminal you aren't looking at, its workspace's square gets a "Finished while you were away" or "failed" pulse: `.ws-sq[data-s]::before { animation: ws-pulse 2s … infinite }` (`index.html:180-185`).
  - It runs until you look. The "failed" state stays until another command succeeds, so it can pulse for hours.
  - The window is transparent with vibrancy (`main.js:67`, `visualEffectState: 'active'`), so every animation frame makes macOS recomposite the whole window.
- **Numbers:**
  - 8 terminals, one quick command run in each (one of them fails): **16.4%** of a core, nonstop. That's the GPU process (3.8 s per 45 s) plus the window (3.6 s).
  - Same state with the animation paused: **0.1%**.
  - That one CSS animation is the whole cost. It drains battery while Fork does nothing.
- **Also suspected (from code, not measured):**
  - The lattice animation on "working" tabs (`ws-lattice … infinite`) also runs for any long command, like `npm run dev`, which is "working" for hours.
  - A paused or hidden game keeps a requestAnimationFrame loop running (`games.js:358`).
- **Fix (S):**
  - Pulse 3 times, then hold a still dot.
  - Pause all animations when Fork isn't the front app.
  - Don't animate "working" for plain long-running commands (a dev server isn't "working", it's "running").
  - Consider `visualEffectState: 'followWindow'`.
- **Gain:** idle CPU goes from 16% to about 0.2% in a common state.

### 3. Things that run whether or not you use them (from code; one part measured)
- **Notch window** (`main.js:698`): created at launch on any Mac with a notch, even with the notch off (the default). Measured at **17 MB**. It still gets every state update, and ticks every second while a tab is running (`notch.js:56`).
  - **Fix:** create it when the notch is turned on, and destroy it when it's turned off.
- **Ask AI warm-up** (`renderer.js:1667`): just opening ⌘K starts a `claude -p` process (about 150–250 MB) and keeps it for 5 minutes, even if you never ask.
  - **Fix:** warm it when the Ask AI row shows or is hovered.
- **The App preview keeps running when hidden** (`renderer.js:1159`): once you've opened your app, its page (timers, hot reload) keeps running after you close the panel. That's typically 100–300 MB.
  - **Fix:** unload it after a minute hidden.
- **The before/after picture window** (`main.js:244`) stays alive after the first turn, with background throttling off.
  - **Fix:** close it after about 60 s idle.
- **The Design tab re-scans every 4 s** (`design.js:48`, `git ls-files -co`) while visible, including when Fork is in the background.
  - **Fix:** re-scan on file changes instead (the folder is already watched).

### 4. Every file change and every prompt starts about 4 git processes (from code)
- **What one refresh costs:**
  - Each `fs:changed` (debounced 150 ms) does a synchronous folder read, plus `suggest()` with about 10 file checks, on the main process.
  - It starts `git status -uall` and `git rev-parse`.
  - 300 ms later it starts `git status --branch` and `git diff HEAD --shortstat` (`main.js:211-233`, `renderer.js:791-839`, `:1016-1020`).
- **What triggers it:**
  - The same thing runs on **every shell prompt**, even when the folder didn't change (the OSC 7 handler, `renderer.js:146-162`).
  - Dotfiles aren't ignored. In a Home workspace, `.zsh_history` and `~/.claude.json` change constantly, so the refresh runs constantly.
  - A run in progress doesn't stop the next one from starting.
- **Why it matters:** while an agent edits many files, this keeps spawning processes. The main process's synchronous file reads delay terminal output for every pane.
- **Fix (S–M):**
  - Use one `git status --porcelain=v2 --branch -z` for both badges and info.
  - Refresh only when the folder actually changed.
  - Ignore dotfiles.
  - Have only one refresh in flight at a time, with a 1–2 s maximum wait while an agent works.
  - Use async file reads.
- **Not measured here:** the test project was tiny. Worth timing on a real project during an agent turn.

### 5. Closing a terminal can leave its programs running (from code)
- **What happens:**
  - `pty.kill()` (`main.js:101`, `:180`) sends a hang-up to the shell only.
  - Anything detached survives: dev servers an agent started in the background, MCP servers, watchers.
  - The window also never releases the pty handle.
- **Fix (S):** on close, hang up the terminal's whole process group, force-kill it after 2 s, then `pty.destroy()`.
- **Overlap:** this is the "clean up on close" step in #52.

### 6. Changes thumbnails decode full-size pictures (from code)
- **What happens:** each turn's before/after is up to 1280×4000 px, and the strip shows every turn as a full `<img>` (`changes.js:98-113`). That's about 20 MB decoded per picture, so hundreds of MB for a long session.
- **Fix (S):** save a 240 px thumbnail next to each picture and use it in the strip.

### 7. Smaller things
- **WebGL past 17 terminals** (measured): terminals 18 and up lose GPU drawing and never get it back (`renderer.js:33-42`). Rare, but a cheap fix: give WebGL only to the visible workspace's terminals.
- **Resizing** (from code): every pixel of a divider drag refits every terminal and reflows up to 10,000 lines (`renderer.js:143`, `:45-49`). Debounce it, and only tell the shell when columns or rows actually change.
- **Terminal output isn't batched** between processes (`main.js:55`, one message per chunk, no backpressure). The 20 MB flood test showed this isn't a problem yet (115 fps, no freezes). Revisit only if several terminals flood at once.
- **Restoring** (from code): terminals are recreated one after another, and every saved Claude terminal runs `claude --continue` at launch (`renderer.js:1505-1530`). Resuming only the visible workspace would cut the launch spike for people with many agents open.
- **App size:** 372 MB installed (1.0.2). `.map` files and all four terminal fonts ship (`files: ["**/*"]`). Excluding the maps saves about 8 MB+. This affects download size, not speed.
- **A shell warning, not Fork's:** every new terminal in the test printed `/dev/fd/13:18: command not found: compdef`. That's from this Mac's `~/.zshrc` loading a completion before `compinit`. Worth checking it doesn't also happen in your installed Fork.

---

## What to do first
1. **Launch without waiting for the shell** (finding 1): 1 s off every launch. Also helps 1.0.2. Issue #53.
2. **Stop the endless pulse** (finding 2): 16% → 0.2% CPU in a common idle state. Issue #54.
3. **Don't run what isn't used** (finding 3): notch window, Ask AI warm-up, hidden App preview, picture window, Design polling. Issue #55.

Next: **calm git refreshes** (finding 4, issue #56). Closing terminals cleanly is part of #52.

## Re-running these numbers
The scripts are in the scratch folder from this session. To keep them, copy `bench.mjs` and `flood.mjs` into `scripts/bench/`. Steps:

```
node bench.mjs setup                     # once: clean test data with 1 workspace
node bench.mjs launch                    # launch time ×4
node bench.mjs memory                    # 1 / 4 / 8 terminals, full scrollback, idle CPU
node bench.mjs unseen                    # CPU with a pulsing "done/failed" tab, then paused
node bench.mjs flood 20                  # 20 MB of agent-like output
node bench.mjs many                      # up to 24 terminals: memory and WebGL
APPDIR=../fork-nopath node bench.mjs launch   # launch with the login-shell step removed
```
