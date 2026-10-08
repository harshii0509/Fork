# Files and code: what's next

Four upgrades to the Files tree (@pierre/trees) and the code preview (@pierre/diffs), written down to build
later. Order is smallest and safest first:

1. **Fold folder chains + sticky folders** in the Files tree.
2. **"+" on line hover** in the code preview: put this line in the terminal.
3. **What changed (diff view)** for files with a git badge.
4. **Code theme from Fork's palette** instead of Pierre's (needs a colour call first).

Each has: what the person sees, how to build it on today's code, edge cases, and tests.

**Today's code it builds on:**
- **The Files tree:**
  - `new Trees.FileTree` in renderer.js. It's lazy: the `loaded` Map, `treeList()`, and `tree.subscribe` reads newly opened folders.
  - Git badges come from main.js `git:files` → git.mjs `gitFiles`.
  - `rowAt(e)` finds a row's `data-item-path`.
- **The code preview:**
  - renderer.js `showCode()` → `D.File` with the worker pool (vendor/diffs/worker.js), `themeType` from `codeTheme()`, line selection → `pickLines` / `#pvLine`.
  - It's bundled by scripts/vendor.mjs (exports `File`, `getOrCreateWorkerPoolSingleton`).
- **Platform-neutral copy:** buttons say "terminal", not "Claude" (memory: fork-platform-neutral).

---

## 1. Fold folder chains + sticky folders (Files tree)
**What the person sees:**
- `src/components/ui` shows as one row when each folder holds only the next one. Clicking it opens the deepest folder.
- While scrolling a long open folder, its row stays pinned at the top, like VS Code. So you always know whose files you're looking at.

**How:**
- **Trees options:** `flattenEmptyDirectories: true` and `stickyFolders: true`, both in the `new Trees.FileTree({...})` call.
- **Lazy-loading catch:** Trees can only fold a chain it knows about. Unread folders look empty, so they never fold. Fix in **files.mjs `list(dir)`**: for each child folder, peek one level in (`readdirSync`, hidden entries skipped as today). If it holds exactly one entry and that entry is a folder, follow it, up to 6 levels. Return that as `chain: ['components', 'components/ui']`, relative to the child.
- **renderer `treeList()`:** add each chain step as a path (`src/components/`, `src/components/ui/`) and mark those folders `loaded` with their single entry. A folded row then expands straight into the deepest folder's contents (read on expand as today).
- **`tree.subscribe` expansion tracking:** a folded row's path is the deepest folder, so `expanded` stores the deepest path. Collapse all still works.
- **Git dot:** changed files deep inside a chain still add their paths (`treeList(changed)`), so the folded row shows the dot.
- **Sticky row background:** uses `--trees-bg-override: var(--card)` (already set), so nothing shows through.

**Edge cases:**
- **Noise folders** (node_modules…): never peek inside, so they stay cheap.
- **A folder that gains a second child:** the chain breaks on the next `refresh()`. `list()` re-peeks, and the `batch` diff removes the folded paths and adds the real ones.
- **Unreadable folders:** the peek is in try/catch, and the chain stops there.

**Tests (check.mjs):**
- `list()` on a temp `a/b/c/file`: `a` gets `chain ['b', 'b/c']`.
- A folder with two children gets no chain.
- Hidden entries don't count as the "one child".
- `node_modules` gets no chain.

---

## 2. "+" on line hover: put this line in the terminal (code preview)
**What the person sees:**
- Hovering a code line shows a small **+** in the line-number gutter.
- Clicking it types `files.mjs:42 ` into the active terminal and focuses it, so you can keep typing your question to Claude, or any tool.
- If lines are selected, **+** uses the whole range (`files.mjs:10-14`).
- Tooltip: "Put this line in the terminal".

**How:**
- **`D.File` options:** add `enableGutterUtility: true` and `onGutterUtilityClick: (range) => putLines(range)`.
- **Refactor:** pull the existing `#pvLine` click body into `putLines({ start, end })`. Both the header button and **+** use it. It does the relative-path logic, `Preview.dropText` escaping and `p.term.focus()`.
- **Built-in button:** keep Diffs' own **+** (`renderGutterUtility` not needed). Restyle it only through `unsafeCSS` if it clashes, using the gutter button's data attribute.
- **Busy terminal:** typing a path is safe even while Claude runs, since it's a prompt, like drag-to-terminal today. No `send()` busy check.

**Tests:** none in check.mjs (DOM). Verify in the test copy: hover line 42 → the **+** shows; click → the terminal line ends with `files.mjs:42 `.

---

## 3. What changed: diff view (code preview)
**What the person sees:**
- Previewing a file that has a git badge (M/A/U/D/R) adds a **File | Changes** switch in the preview header.
- **Changes** shows what's different from the last commit, as one stacked column: green added lines, red removed lines, word-level highlights. Unchanged stretches fold into "N unchanged lines".
- **Default:** clicking a file *with a badge* opens **Changes**. Clicking it again, or a file without changes, shows **File**.
- A small **Side by side** toggle appears when the panel is wide (≥ 900px).
- **Per badge:**
  - **New files (U/A):** all green.
  - **Deleted (D):** the row stays in the tree (it already does), and Changes shows the old text all red, instead of "This file is gone".
- **Live:** when Claude edits the file, the diff updates in place and keeps the scroll.

**How:**
- **main.js:** new `git:show` IPC, `(path) → string | null`.
  - It runs `git -C <dir> show HEAD:./<name>` with `--no-optional-locks`, the 2s timeout, and an 8 MB buffer, as `git:info` does.
  - It returns null when the file isn't in HEAD.
  - The preload exposes it as `dt.gitShow`.
- **Badge per file:** keep a renderer map `gitByPath` (absolute path → status), filled in `refresh()` from `changed`.
- **vendor.mjs:** also export `FileDiff` and `parseDiffFromFile` from `@pierre/diffs`, then re-run `npm run vendor`.
- **renderer.js:** `showChanges(view, path, r)` mirrors `showCode`.
  - `old = await dt.gitShow(path)`, `cur = r.text` (null when deleted).
  - `codeDiff = new D.FileDiff({ themeType, diffStyle: 'unified' | 'split', lineDiffType: 'word', hunkSeparators: (default), disableFileHeader: true, expandUnchanged: false, enableLineSelection: true, onLineSelected: pickLines, enableGutterUtility: true, onGutterUtilityClick: putLines, unsafeCSS: same card background }, pool)`
  - `codeDiff.render({ oldFile: old != null ? { name, contents: old } : null, newFile: cur != null ? { name, contents: cur } : null, containerWrapper })`
  - Line picks in a diff refer to the new file's line numbers. Deleted-side picks use the old numbers, labelled `(before)`.
- **`openFile`:** decide the mode with `pv.mode = gitByPath.has(path) && firstTime ? 'changes' : pv.mode`. On `changed` (fs event), re-render whichever mode is showing.
  - **A `missing` file with a D badge** goes to Changes with `newFile: null`.
- **index.html:**
  - **Header switch:** `#pvDiff` segmented (File / Changes), shown only when the file has a badge, plus `#pvSplit` (Side by side), shown only in Changes and when wide.
  - **Diff colours:** use Fork's `--plus` / `--minus` through Diffs' `--diffs-addition-color-override` / `--diffs-deletion-color-override` on `.pv-code`, so they match the tree badges and the workspace `+449 -126`.
- **Settings:** none for now. Unified or split is remembered in `localStorage` (per-viewer convenience, wrapped in try/catch).

**Edge cases:**
- **Not a git folder:** no badges, so no switch.
- **Binary or too big:** the existing `other` message, with no Changes.
- **A file outside the tree's root:** no badge, so plain File.
- **Huge diffs:** the worker pool already colours off the main thread. `FileDiff` folds unchanged context.
- **Renamed (R):** `git:show` of the new name returns null, so it shows as all-new. Acceptable for now; noted in the doc.

**Tests (check.mjs):** `git:show`'s parsing is trivial, so test the "is it in HEAD" path with a temp repo:
- `git init`, commit `a.txt`, edit it
- the main-side helper (extracted to git.mjs as a function taking an exec) returns the old text for `a.txt` and null for a new `b.txt`

---

## 4. Code theme from Fork's palette (code preview, and diffs)
**What the person sees:** code colours drawn from the same Figma palette as the rest of the redesign, in Light and Dark, instead of Pierre's pink, orange and purple.

**How:**
- **New `code-theme.mjs`** (build-time, run by `npm run vendor`): it reads Pierre's `pierre-dark.json` / `pierre-light.json` from `node_modules/@pierre/diffs/node_modules/@pierre/theme/themes/`. It keeps every scope rule (248), so languages stay just as accurate, and swaps the 18 foreground colours through a role table into `vendor/diffs/fork-dark.json` and `fork-light.json`.
- **Background, foreground and line numbers** = `--card` / `--text-1` / `--text-4` hex values.
- **renderer.js:** `registerCustomTheme('fork-dark', () => import('./vendor/diffs/fork-dark.json', { with: { type: 'json' } }))` (and light), exported via vendor.mjs. The pool's `highlighterOptions.theme` becomes `{ dark: 'fork-dark', light: 'fork-light' }`.
  - **Check first:** custom themes reach the workers. Diffs has a register-theme worker message. If not, fall back to main-thread highlighting for small files.
  - The `unsafeCSS` card-background override stays, as a safety net.
- **Role table:** a draft from the palette in colors.css. **The user picks or edits it before this ships.** I'll show a side-by-side screenshot with Pierre's first.

| Role (Pierre dark) | Used for | Fork dark (draft) | Fork light (draft) |
|---|---|---|---|
| #ff678d | keywords (`const`, `return`, `import`) | `--c-ff736a` #FF736A | `--c-eb5757` #EB5757 |
| #636363 | operators, punctuation | `--gray-600` #737371 | `--gray-500` #8B8B89 |
| #ff855e | magic/special vars | `--c-ea773d` #EA773D | `--c-ea773d` |
| #ffab16 / #ffa359 | constants, variables | `--c-ea883d` #EA883D | `--c-b6764d` #B6764D |
| #ffd452 | literal constants (`true`, `null`) | `--c-febc2e` #FEBC2E | `--c-f0bf00` #F0BF00 |
| #08c0ef / #68cdf2 / #64d1db / #61d5c0 | logic operators, numbers, regex, escapes | `--c-26b5ce` #26B5CE | `--c-26b5ce` |
| #9d6afb | functions | `--c-a6a6f8` #A6A6F8 | `--c-bf3dea` #BF3DEA |
| #d568ea | types | `--c-bf3dea` #BF3DEA | `--c-bf3dea` |
| #5ecc71 / #60d199 | strings, CSS classes | `--c-4cb782` #4CB782 | `--c-19c332` #19C332 |
| #69b1ff | decorators | `--c-3d9cea` #3D9CEA | `--c-0561e2` #0561E2 |
| #737373 | comments | `--gray-600` #737371 | `--gray-500` |
| #a3a3a3 | parameters | `--gray-500` #8B8B89 | `--gray-600` |
| #fafafa | default text | `--gray-25` #F8F8F7 | `--c-1d1d1f` |

- **Contrast check:** every role ≥ 4.5:1 against its background (WCAG AA), computed in `code-theme.mjs`. The build warns on failures, and check.mjs asserts it.

**Tests (check.mjs):**
- the generated themes have the same number of rules as Pierre's
- no Pierre hex is left in `tokenColors`
- every foreground passes 4.5:1 on its background

---

## Verification (each item, in the test copy over CDP, port 9341, Light and Dark)
1. A temp tree `a/b/c/d.txt` shows one `a/b/c` row, and opening it shows `d.txt`. Scrolling a long open folder (`node_modules` in a non-repo) keeps its row pinned. The dot shows on a folded row with a change inside.
2. Hover line 42 → the **+** appears. Click it → the terminal ends with `files.mjs:42 `. With 10–14 selected → `files.mjs:10-14 `.
3. Edit `files.mjs` (M):
   - clicking it opens Changes, with green/red lines and word highlights
   - File/Changes switches back and forth
   - Side by side works when wide
   - an edit from the terminal updates the diff in place
   - a new file (U) is all green
   - a deleted tracked file shows all red
4. The theme screenshot next to Pierre's for the user's call. After approval, the contrast check passes and the colours match the palette.
- Each step: `npm run check` passes, commit only my files.
- What's cooking entries on fork-website when the redesign ships, not per branch commit.
