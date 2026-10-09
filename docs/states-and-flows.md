# Fork: terminal states, edge cases and flows

The working list for the UI redesign. The same content lives in Figma, on the **States & Flows** page of the [Fork file](https://www.figma.com/design/tye8q3pJnMryvznnylAujR/Fork). The Figma page is for designing; this copy is for building.

The page also has **screens**. Section 06 shows each state as Fork looks today, as a real screenshot, next to a first pass in the new Workspaces design. Section 07 does the same for the first-launch flow.

Each item says where it lives in the code today, using the file and the function or constant name. Names move less than line numbers.

**Status:** ✓ Today (works, may only need a new look) · ◐ Needs design (exists but unclear or misleading) · ✕ Missing (not built).
**Who it hurts most:** Dev · Designer (designers and non-tech folks) · Both.
**Severity (edge cases):** High (loses work or misleads) · Med (confusing) · Low (polish).

---

## 1. Terminal session states

These are states of one terminal (a pane). A tab shows its most urgent pane (see the priority ladder).

| # | State | What it means | What triggers it | Today | What the redesign must show | Shows in | Code |
|---|---|---|---|---|---|---|---|
| 1 | **Starting** ✕ | The shell is opening | A new tab, a split, or a relaunch | Nothing. The tab appears as "New tab" until the first folder report | Usually instant, so show nothing. If it takes over ~300ms, a quiet "Opening…" in the pane | Pane | renderer.js `newPane`, main.js `pty:create` |
| 2 | **Ready** ✓ | Prompt is waiting; nothing running | First prompt, or a command finished fine | Solid workspace square | Calm default. Folder + git branch in the pane header | Tab, pane header | renderer.js `LOOKS.ready` |
| 3 | **Running** ✓ | A command is working (install, build, dev server) | Shell reports a command start (OSC 133 C) | The workspace square splits into a rippling lattice | Command name + elapsed time in the pane header; Stop; "Play a game while you wait" stays optional | Tab, pane header, notch | renderer.js `LOOKS.running`, `working()` |
| 4 | **Agent working** ◐ | An AI agent (Claude, Codex, OpenCode, Gemini) is doing a task | Agent open + spinner in its title, or "esc to interrupt" on screen | Same as Running, but "Claude is working." and Stop sends Esc | Its own look, apart from plain Running, with the agent's name. Stop = "Stop it (Esc)" | Tab, pane header, notch | renderer.js `setThinking()`, protocols.js `AGENTS`, `interruptHint` |
| 5 | **Agent open, your turn** ◐ | The agent finished and waits for your next message (it isn't asking anything) | Agent title goes back to "✳", or the interrupt hint disappears | Shows **Ready**, yet chips are disabled and closing asks "Something is still running" | A soft "Claude · your turn" so it doesn't read as an idle shell. Chips explain why they're off | Tab, pane header | renderer.js `pane.busy` vs `working()` |
| 6 | **Needs you** ✕ | Something is blocked on you: agent permission prompt, y/n question, sudo password, git editor | Agent notification (OSC 9/777/99) or bell; a password prompt | Looks the same as "done" (another tab) or "ready" (this tab). Password prompts look like Running | The loudest state: tab badge, notch, notification "Claude needs you: allow edit?", jump straight to the pane | Tab, notch, notification, dock | renderer.js `toolNotified()`, protocols.js `notifyFrom`; the bell (`term.onBell`) isn't wired |
| 7 | **Done, not seen** ✓ | Finished while you looked elsewhere | A command ends, an agent goes working → your turn, or a tool notifies, while on another tab | Yellow badge at the end of the workspace name; clears when you open it; notification if Fork is in the background | Keep it. Also mark split panes in the *current* tab that finished out of view | Tab, notch, notification, dock badge | renderer.js `pane.unseen`, `LOOKS.done` |
| 8 | **Failed** ✓ | The last command ended with an error | Exit code isn't 0 or 130 | Red badge at the end of the workspace name until the next command; banner "That didn't work · What went wrong?" only if the pane was active | Show the banner again when you come back to the pane. Don't call harmless exits failures (grep found nothing) | Tab, pane, notification | renderer.js `pane.failed`, `LOOKS.failed`, the `#oops` banner, `explained()` |
| 9 | **Stopped** ✓ | You stopped it (Ctrl-C or Stop) | Exit code 130 | Treated as Ready | A brief "Stopped" line in the pane so it's clear it didn't finish | Pane | renderer.js (code 130 check) |
| 10 | **Interactive app** ✕ | A full-screen or long-lived app: ssh, vim, tmux, top, less, a REPL | Command start without an end, and the app takes the screen | Counts as Running forever: rippling lattice, "working · 2h" in the notch, Stop sends Ctrl-C into vim | Its own quiet look: "In vim", "Connected to server". No "finished" notifications, no Stop | Tab, pane header, notch | Not built (would extend `working()`) |
| 11 | **Exited** ✕ | The shell ended: you typed `exit`, or it crashed | The terminal process ends | The pane closes silently. The last pane closes the window **and erases its saved tabs** | Keep the pane with "Session ended (code X) · Restart · Close". Never erase saved tabs on a crash | Pane | renderer.js `dt.onExit` → `closePane`, `forgetAndClose()` |
| 12 | **Couldn't start** ✕ | The shell failed to open (bad shell, missing folder) | Opening the terminal fails | Nothing. The tab never appears; restore can get stuck and stop saving | Error in the pane: what failed, "Try again", "Open in home folder" | Pane | renderer.js `dt.create`, main.js `pty.spawn` |
| 13 | **Dozing** ✓ | Nothing touched for 5 minutes | No typing or commands in any pane of the tab | Nothing extra (solid square) | Keep it; very quiet | Tab | renderer.js `DOZE_AFTER`, `LOOKS.dozing` |
| 14 | **Restored** ◐ | Reopened after relaunch | A saved session exists | Old screen above "── Restored · 10:42 ──"; Claude gets `claude --continue`; dev servers aren't restarted | Say what *wasn't* brought back: "npm run dev was running · Run again" | Pane | renderer.js `restore()`, session.mjs |

### Priority ladder (what a tab shows when its panes disagree)

**Today:** Running › Failed › Done › Dozing › Ready (renderer.js `tabKey()`).

**Proposed:**
1. Needs you
2. Failed
3. Exited / Couldn't start
4. Done, not seen
5. Agent working
6. Running
7. Interactive app
8. Agent open, your turn
9. Ready
10. Dozing

Something blocked on you always wins. Work that's happening ranks below work that's finished and waiting for you to look.

### How states move

- Starting → Ready, or → Couldn't start
- Ready → Running → Ready (fine) · Failed (error) · Stopped (Ctrl-C)
- Running → Needs you (password, y/n) → Running
- Ready → Agent working ⇄ Agent open, your turn; Agent working → Needs you → Agent working
- Ready → Interactive app (ssh, vim) → Ready when you leave it
- Any finish while you're elsewhere → Done, not seen → (you look) → Ready
- Failed → (next command) → Running
- Ready → Dozing after 5 min → Ready on any touch
- Any → Exited (`exit` or crash) → Restart → Starting
- Relaunch → Restored → Ready

---

## 2. States by area

### Panes & layout
- **One pane** ✓: no header chrome needed.
- **Split, focused / unfocused** ◐: today, unfocused panes are at 50% opacity with a 2px accent line on the active one (index.html `.pane`). The redesign shows titled panes; decide how the active one stands out.
- **Resizing** ✓: drag the divider (15–85%); double-click resets (renderer.js `drag()`).
- **Too small** ✕: there's no minimum pane size, so repeated splits become unusable.
- **Drop target** ✓: a file dragged over a pane shows an accent ring and types the path.
- **Closing a busy pane** ◐: native `confirm()` "Something is still running here" (renderer.js `closePane`). Needs a Fork-styled confirm.
- **Last pane closed** ◐: the window closes and its tabs are forgotten (`forgetAndClose`).
- **Zero tabs** ✕: can't happen today (the window closes). Decide if an empty state should exist.

### Sidebar & files
- **Folder listed** ✓: dotfiles hidden; `node_modules`, `dist` and similar dimmed and sorted last (files.mjs).
- **Empty folder** ✓: "This folder is empty." / "Empty" (renderer.js, the sidebar tree).
- **Blocked by macOS privacy** ✕: shows as empty. Should say "Fork needs access · Open Settings".
- **Huge folder** ✕: renders every entry at once (no virtual list).
- **Remote folder (ssh)** ✕: the sidebar shows a local path that doesn't exist, so it looks empty.
- **Hidden / shown** ✓: ⌘B; width 180–420.

### Preview: File / App / Read
- **File:**
  - ✓ image, video, Markdown, code, HTML, empty ("Nothing to preview yet")
  - ✓ too big (>1MB), can't preview (binary), gone (deleted), live reload
- **App:**
  - ✓ empty ("No app yet…"), loading, loaded
  - ◐ failed ("Nothing is showing at X · Try again"); certificate errors and auth pages get the same generic message
  - ✓ app detected: its address shows in Workspace info; click it to see it (the banner was removed 9 Oct)
- **Read:**
  - ✓ empty shelf, reading (pages or scroll)
  - ✓ missing / too big / damaged-or-DRM file, "Claude's done · Back to terminal"
- ◐ The panel's width and mode aren't remembered.

### ⌘K palette
- ✓ empty list, filtering, "Looking…" (Jev), answer card with Run, needs input (Run disabled), busy message inline.
- ✓ Ask AI: "Thinking…" → card "Suggested by AI. Check it before running."
- ◐ AI failed: "AI couldn't turn that into a command" (doesn't say whether it was offline, not logged in or timed out).
- ✕ Offline: there's no message; Jev just returns nothing.

### Error help
- ✓ "That didn't work · What went wrong?"
- ✓ known fix from Fork's library (~35 errors) → "Type the fix"
- ✓ Jev answer (smart on) → "Type the fix" + "Not it? Ask AI"
- ✓ "This one's unusual. Want AI to take a look?" → "Reading the error…" → answer
- ◐ "Couldn't reach Claude. To log in, open a new tab and type claude.": the same message for not installed / not logged in / timed out. It can take 60s with no cancel.

### Updates
- ✓ checking, downloading ("Fork X is downloading"), ready ("Restart now"), up to date, offline ("Couldn't check"), dev build ("Updates only work in the installed Fork").
- ✓ the pill "Fork X · Restart".
- ✕ download progress; install failed.

### Notch & notifications
- **Notch** (off by default): idle (hidden), working ("Claude is working · 2m" / "N things working"), moment (Done / Failed / Ready for 6s), list on hover.
- **Notifications:** only when Fork isn't focused; failed, long command (10s+), agent done, the tool's own message, app ready. Clicking opens the pane.
- ✕ Notification permission denied: nothing tells you.
- ◐ With alerts off, notch moments still appear.

### Settings
- Appearance (Light / Dark / System), font, font size (8–32, stepper only), smoothing, translucent sidebar, open links in Fork, alerts, notch, smart help, reopen tabs, usage analytics.
- ◐ The sidebar shows one item ("Appearance") but the page holds every section.

### Workspace status (new, from the Revamp notes)
Fields: git branch, branch state, what's running, dev server port, build status, agent info. Each field needs these states:
- **Unknown:** not a git folder; no dev server.
- **Loading:** reading git.
- **OK:** clean, running on :3000, build passed.
- **Attention:** modified files, behind remote, agent waiting.
- **Failed:** build failed, server crashed, merge conflict.

---

## 3. Edge cases

### Losing work
| Case | Today | Direction | Who | Sev |
|---|---|---|---|---|
| ⌘Q or closing the last window while things are running | Quits without asking (main.js `before-quit`) | "2 things are still running · Quit anyway" | Both | High |
| `exit` or a crash in the last pane | Window closes and its saved tabs are erased (`forgetAndClose`) | Keep the pane as "Session ended"; erase saved tabs only on a deliberate close | Both | High |
| ⌘R (View → Reload) | Reloads the window; shells keep running unseen; you get a fresh tab | Remove from the release menu, or reattach | Dev | High |
| Shell fails to start | Nothing shows; restore can stop saving (`dt.create` rejection) | "Couldn't start" state with retry | Both | High |
| Quitting halfway through the welcome | Marked as onboarded at the start, so it never shows again | Mark done at the end or on Skip | Designer | Med |
| Dev servers after relaunch | Not restarted; only Claude continues | Offer "Run again" on the restored line | Dev | Med |

### Wrong or misleading state
| Case | Today | Direction | Who | Sev |
|---|---|---|---|---|
| Agent asks permission | Looks like Done or Ready | Needs you state | Both | High |
| Agent idle at its prompt | Says Ready, but chips are off and close asks to confirm | "Your turn" state | Both | Med |
| Harmless non-zero exits (grep found nothing, diff, test) | Failed + failure notification | Quiet list of commands where non-zero is normal | Dev | Med |
| Error banner after switching away and back | Gone; tab still red | Show the banner again on return | Designer | Med |
| A split pane in the current tab finishes out of view | Not marked | Mark the pane header | Dev | Low |
| bash or fish shell | No folder, no running/failed, tab says "New tab", close never asks | Add integration or say "Limited support" | Dev | Med |
| `npx codex`, aliases, `cd x && claude` | Not seen as an agent | Detect by title / process, not first word | Dev | Low |
| Prompt themes (oh-my-zsh) that set titles | Can be read as Claude | Tighter title match | Dev | Low |

### Full-screen apps, ssh, tmux, sudo
| Case | Today | Direction | Who | Sev |
|---|---|---|---|---|
| ssh, vim, tmux, top, less | Running forever; notch "working · 2h"; Stop sends Ctrl-C | Interactive app state | Dev | High |
| sudo password and y/n prompts | Look like Running | Needs you state | Both | High |
| tmux swallows Fork's shell reports | Folder and status go stale | Document it; detect tmux and say so | Dev | Low |
| Option key as Meta, ⌘← / ⌘→ line editing | Don't work | Setting + key mapping | Dev | Med |

### Scale
| Case | Today | Direction | Who | Sev |
|---|---|---|---|---|
| Hundreds of tabs | Many rows update often; every working square animates | Pause off-screen animations; virtual list | Dev | Med |
| Two tabs with the same folder name | Look identical ("src", "src") | Add the parent folder when names clash | Both | Med |
| Very long folder / tab names | Cut with "…", tooltip only on the row | Middle ellipsis + full path on hover | Both | Low |
| Many splits | WebGL runs out and drops to slower text; no minimum size | Minimum pane size; cap or warn | Dev | Med |
| Huge output bursts | No back-pressure; each chunk is scanned | Throttle scanning | Dev | Low |
| Huge folders in the sidebar | Renders everything; first read can hang | Virtual list, read in the background | Both | Med |

### Preview & links
| Case | Today | Direction | Who | Sev |
|---|---|---|---|---|
| Dev server on a LAN IP, `*.localhost`, custom host | Not detected | Wider match | Dev | Low |
| Restarted dev server | ~~"Your app is running" isn't offered again~~ Resolved 9 Oct: no offer any more; the address comes back in Workspace info when it restarts | n/a | Both | Low |
| Certificate errors, login pages | Generic "Nothing is showing" | Say what happened | Both | Low |
| Minimum window width with the preview open | Terminal squeezed to ~190px | Minimum terminal width; overlay preview | Both | Med |
| Plain click on a link | Nothing (⌘-click only) | Hint on hover already says where it opens; consider single click for designers | Designer | Low |

### Network & AI
| Case | Today | Direction | Who | Sev |
|---|---|---|---|---|
| Offline or Jev down | Silent; looks like "no answer" | "You're offline" note | Both | Med |
| Ask AI: Claude not installed vs not logged in vs timed out | One message for all three | Three messages with the right next step | Designer | High |
| Ask AI takes up to 60s | No cancel | Cancel button + time hint | Both | Med |
| No AI tool at all | ⌘K and errors still work (library + Jev); Ask AI fails | Make the no-AI path first-class (see flows) | Designer | High |

### Notifications & permissions
| Case | Today | Direction | Who | Sev |
|---|---|---|---|---|
| Notification permission denied | Nothing tells you; dock badge still counts | Detect and offer to fix in Settings | Both | Med |
| Several windows | A background window can notify while Fork is in front | Check the app, not the window | Both | Low |
| Alerts off | Notch moments still appear | Respect alerts in the notch too, or label it | Both | Low |
| Folder blocked by privacy | "This folder is empty." | "Fork needs access" | Designer | Med |

### Window & keyboard
| Case | Today | Direction | Who | Sev |
|---|---|---|---|---|
| Font zoom (⌘+ / ⌘−) | Not available; only the Settings stepper | Add zoom keys | Both | Med |
| Large or multi-line paste | Pasted straight in | Confirm when it has many lines | Both | Med |
| Image paste | Not handled | Save to a temp file and type its path (agents read it) | Designer | Med |
| Right-click | No menu | Copy / Paste / Clear / Split | Designer | Med |
| ⌘W while in Settings | Closes a terminal pane | Close Settings | Both | Med |
| Fullscreen | Keeps the gap for the traffic lights | Remove the gap in fullscreen | Both | Low |

---

## 4. Flows

### Designer / non-tech: first launch
1. Open Fork → welcome (3 cards, Skip any time).
2. "What do you use for your AI work?" → Claude · Codex · Gemini · Nothing yet · Not sure.
3. Fork checks what's installed:
   - **Installed and logged in** (Point 01) → go to 4.
   - **Installed, not logged in** (Point 02) → "Let's log in" → Fork types the tool's login command → the browser opens → back to Fork → 4.
   - **Not installed** (Point 03) → "Install <tool>" → Fork types the install command → Enter → progress (Running) → done → log in → 4.
   - **Nothing yet / Not sure** → "Fork works without AI too" → show ⌘K ("say what you want, get the command") and error help → 4 without an agent.
4. "Where do you want to work?" → a recent folder · Choose a folder · Get a project from GitHub · Just open the terminal.
5. The terminal opens in that folder with the tool's command pre-filled → "Press Enter to start Claude".
6. Agent working (rippling lattice) → maybe **Needs you** ("Allow edit?") → answer → Agent working → **Your turn**.
7. A dev server starts → its address shows in Workspace info → click it → preview opens beside the terminal.
8. Something fails → "That didn't work · What went wrong?" → plain explanation → "Type the fix" → Enter.
9. Spotlight tour (only if the welcome wasn't skipped; never for returning users, even after an update).

### Designer: coming back
- Open Fork → tabs restored (Restored line) → Claude continues where it was.
- A dev server isn't running any more → "npm run dev was running · Run again".
- Update ready → pill "Fork X · Restart" → after restart, What's new once.

### Dev: daily
1. Open Fork → tabs restored; Claude gets `claude --continue`.
2. ⌘D split → `npm run dev` on one side (Running → app detected → preview).
3. Agent on the other side → working → the dev switches to another tab.
4. Agent finishes → Done, not seen on that tab; notification if Fork is in the background → click → straight to the pane.
5. Agent asks permission → **Needs you** (tab badge, notch) → answer.
6. A test fails → Failed → banner → known fix or Ask AI.
7. ssh into a server → **Interactive app** (no false "working · 2h", no "finished" alerts).
8. ⌘Q with the dev server still running → **"2 things are still running · Quit anyway?"**

### Shared
- **Close a busy pane or tab:** a Fork-styled confirm that says what's running.
- **Close the last tab:** the window closes; its tabs are only forgotten if you meant it.
- **Shell ends:** the pane says "Session ended · Restart · Close".
- **Update arrives:** pill → card with notes → "Restart now" (tabs come back) or Later.
- **Settings change:** applies live in every window.

---

## 5. Open questions

1. What does **Needs you** look like in the tab, the pane and the notch?
2. Do we support **bash and fish** properly, or say "Fork works best with zsh"?
3. **Confirm on quit** when things are running: always, or only for agents and servers?
4. The **no-AI-tool** user: what's Fork's promise for them? (⌘K, error help, preview, games.)
5. **Harmless non-zero exits** (grep found nothing): failed, or quiet?
6. Can tabs be **renamed, pinned, grouped or reordered**?
7. **Interactive apps** (ssh, vim): show what's inside ("Connected to prod"), or stay neutral?
8. Should a **plain click** open links for designers, with ⌘-click for devs?
