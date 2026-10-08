# Retro: how the setup around Fork's code helps or slows Claude

*7 Oct 2026, with Matt Pocock's `/retro` skill. It looked at three recent Fork build sessions:*
- *"fork04" on 7 Oct (the Changes and Design tabs)*
- *25–26 Sep (setup, preview, icons)*
- *27–28 Sep (dashboard, book reader)*

*It also checked the other 19 sessions in this project for patterns. Nothing was changed; pick what to apply.*

**What /retro looks at:** not the app, but the *environment* Claude works in: CLAUDE.md, automatic checks, docs, memory and tools. The aim is that future sessions make fewer mistakes and waste less time.

## Fix these (high)

### 1. The redesign's CLAUDE.md never loads
- **What's wrong:**
  - Every session starts in `~/Downloads/designer-terminal`. None of the 22 sessions started in `~/Downloads/fork-ui`.
  - Claude only reads a CLAUDE.md in the folder it started in (and that folder's parents). `fork-ui` is a sibling folder, so its new CLAUDE.md (read the docs, update docs in the same commit) never reaches Claude.
  - Every redesign command starts with `cd ~/Downloads/fork-ui`, and the shell resets each time. That happened 66 times in fork04 and 619 times in one 6 Oct session.
- **Change:**
  - Start redesign sessions *in* `~/Downloads/fork-ui`, after checking your memory still loads there.
  - Or add an untracked `designer-terminal/CLAUDE.local.md` with one line pointing to `fork-ui/CLAUDE.md`.
- **Effect:** the repo's own rules apply, and the `cd` noise goes away.

### 2. Nothing stops a commit that fails the checks
- **What's wrong:**
  - There's no pre-commit hook and no CI. `npm run check` is fast (0.28 s) and good.
  - In fork04 it caught three real mistakes: a duplicate variable from a rename, an analytics event with no chart, and missing docs.
  - But each was caught only because Claude chose to run it.
- **Change:**
  - Add a tracked `.githooks/pre-commit` that runs `npm run check`.
  - It should also refuse code changes that don't touch `docs/TECHNICAL.md` or `docs/IA.md`, unless `FORK_NO_DOCS=1` is set.
  - Run `git config core.hooksPath .githooks` once; that covers both folders.
  - Optional: a GitHub Actions job running `npm ci && npm run check` on macOS.
- **Effect:** "run the check" and "docs in the same commit" become gates, not reminders.

### 3. The app-testing script gets rewritten every session
- **What's wrong:**
  - A throwaway CDP script was written about 30 times across 14 sessions, on 12 different ports.
  - Failures:
    - "fetch failed" because the app wasn't up yet
    - a `const` reused across evals
    - confusion between the test copy and your window
    - Electron launched in the foreground and hit 2-minute timeouts (5+ times)
  - Errors in the Fork window only show up if Claude asks for them.
- **Change:**
  - Commit `scripts/drive.mjs` (`npm run drive -- launch | eval | shot | reload | logs`) and the stand-in `claude`.
  - In dev, main.js prints the window's console errors to its log.
  - Point TECHNICAL.md §7 at it.
  - The speed audit's `bench.mjs` is a good starting point.
- **Effect:** no rewrites, no port roulette, no launch timeouts.

### 4. `ls` still hangs, despite the memory note
- **What's wrong:**
  - `ls` is an alias for `eza`, which hangs inside Claude's shell.
  - The memory note (28 Sep) didn't stop it: 31 bare `ls` calls after it, and two 2-minute stalls on 6 Oct.
- **Change:** in `~/.zshrc`, `[[ -n $CLAUDECODE ]] || alias ls='eza …'`, and the same for `ll`, `la` and `lt`. Then delete the memory note.
- **Effect:** the problem disappears instead of depending on Claude remembering.

## Worth doing (medium)

### 5. Memory duplicates the repo's docs
- **What's wrong:**
  - `fork-ui-redesign.md` is 9 KB of commit hashes and file gotchas that `docs/TECHNICAL.md` now owns.
  - Other memory files restate CLAUDE.md or RELEASING.md.
  - One read of three memory files cost 14 KB.
- **Change:**
  - Cut `fork-ui-redesign.md` to about 8 lines that point at the docs.
  - Move the live gotchas into TECHNICAL.md:
    - the trees `[hidden]` needs `!important`
    - Shadow DOM styling only through `--trees-*-override`
    - `Page.reload`, not `location.reload()`
  - Delete the duplicates once #1 lands.

### 6. CLAUDE.md makes Claude read all three docs (~50 KB) for every change
- **What's wrong:** even a one-word copy tweak pays for reading all three.
- **Change:** one trigger per doc:
  - code → TECHNICAL.md
  - places, settings, words → IA.md
  - states → states-and-flows.md
  - Files tree or code preview → files-and-code-next.md (which has no pointer today)

### 7. "Never say designer-terminal" should be a check, not a rule
- **What's wrong:** on 4 Oct the menu said "Quit designer-terminal", and you caught it.
- **Change:** `check.mjs` scans the UI files, menu labels and the CHANGELOG's Unreleased section for "designer-terminal". Then drop the prose rule.

### 8. index.html's 750 lines of CSS have no section markers
- **What's wrong:** Claude read whole files (30–40 KB) to find one style.
- **Change:**
  - Add `/* --- Area --- */` banners that mirror renderer.js's.
  - Add one line to TECHNICAL.md on listing every section with one grep.

## Small (low)
- **9. Release guards:**
  - `npm run app` from the redesign folder would replace your daily Fork. Add a branch guard to `install-app.sh`.
  - Make release.mjs refuse a release within 3 days of the last one unless `--now` is passed.
- **10. Auto mode's trusted-repo description describes a different project** (a p5.js playground). Adding Fork and fork-website would stop surprise blocks on routine work like filing issues.
- **11. Edits through sed and python** caused one bad rename. The pre-commit hook (#2) makes that cheap to catch.
- **12. Your global CLAUDE.md:** the browser rules are already enforced by the chrome-guard hook. The long "Background" paragraph could be one line.

## Keep doing
- `npm run check`: fast, clear messages, and it already checks docs, secrets and icons.
- `release.mjs` refuses to run from a branch, with a dirty tree, or with failing checks.
- The chrome-guard hook.
- Isolated test data: `npm run ui` and scratch data folders.
- Plans first, with questions: nearly every plan was approved first time.
- renderer.js's section banners, and TECHNICAL.md's file map and IPC table.
- Memory that records *why* you decided things.

## Numbers
- **fork04:** 107 tool calls, 3 real catches by the check, 66 shell resets. Biggest costs were whole-file reads (main.js 39 KB, renderer.js 37 + 32 KB).
- **Across 22 sessions:**
  - about 30 throwaway CDP scripts
  - 21 two-minute timeouts (at least 5 from `ls`)
  - 3 auto-mode blocks
