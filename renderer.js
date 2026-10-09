const $ = (id) => document.getElementById(id);
const q = (s) => `'${s.replace(/'/g, `'\\''`)}'`; // shell-quote a path
const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
// Icons in index.html are <i data-icon="name"> placeholders; draw them (icons.js, Lucide).
for (const el of document.querySelectorAll("[data-icon]")) el.outerHTML = icon(el.dataset.icon);
// The redesign's icons (Phosphor, exported from the Figma file into icons/ph) are <i class="ph" data-ph="name">.
// Central Icons replace them when drawn on this Mac (npm run icons; icons/central.json maps the same names).
const PH_DIR = window.CENTRAL ? 'icons/central' : 'icons/ph';
const ph = (name, cls = '') => `<i class="ph ${cls}" style="--ph:url(${PH_DIR}/${name}.svg)"></i>`;
for (const el of document.querySelectorAll("[data-ph]")) el.style.setProperty('--ph', `url(${PH_DIR}/${el.dataset.ph}.svg)`);

// --- Tabs and panes -------------------------------------------------------------
// Window -> tabs (listed in the sidebar) -> panes (split tree, see panes.js). Each pane is
// one xterm + one shell. The active pane drives the sidebar, breadcrumb, chips and banner.
const panes = new Map(); // id -> { id, term, fit, el, cwd, busy, failed, unseen, lastUsed }
let tabs = [], tabIx = 0, home = '', chips = [];
const tab = () => tabs[tabIx];
const active = () => panes.get(tab()?.activeId);
// A pane is a terminal, or the game (games.js), which sits in the split tree like one.
const isGame = (p) => p?.kind === 'game';
// The terminal you're working in: the active pane, or with the game active, the tab's last terminal.
const activeTerm = () => {
  const p = active();
  if (!isGame(p)) return p;
  return panes.get(tab().lastTerm) || Panes.leaves(tab().root).map((id) => panes.get(id)).find((q) => q && !isGame(q));
};
const focusActive = () => { const p = active(); if (p) isGame(p) ? Games.focus() : p.term.focus(); };
const tabOf = (id) => tabs.find((t) => Panes.leaves(t.root).includes(id));

// Draw a pane's text with the graphics chip (WebGL): smoother on busy output, lighter on battery.
// Font smoothing Off needs CSS on DOM text, so those panes stay DOM. If WebGL is missing, or the Mac
// takes the context back (it allows only so many at once), the pane quietly goes back to DOM text.
function useGpu(p, on) {
  if (on && !p.gl) {
    try {
      const gl = new WebglAddon.WebglAddon();
      gl.onContextLoss(() => { gl.dispose(); if (p.gl === gl) p.gl = null; });
      p.term.loadAddon(gl);
      p.gl = gl;
    } catch { p.gl = null; }
  } else if (!on && p.gl) { p.gl.dispose(); p.gl = null; }
}

// As many rows and columns as fit the pane, and tell the shell. Hidden tabs refit when shown (their ResizeObserver).
function refit(p) {
  if (!p.el.offsetParent) return;
  p.fit.fit();
  dt.resize(p.id, p.term.cols, p.term.rows);
}

// A row's height can change while the pane stays the same size: the window moves to a screen with another
// scale, or a font finishes loading. Without a refit the rows overflow and the bottom line (the prompt) is cut.
const refitAll = () => requestAnimationFrame(() => { for (const p of panes.values()) if (!isGame(p)) refit(p); });
(function watchScale() {
  matchMedia(`(resolution: ${devicePixelRatio}dppx)`).addEventListener('change', () => { refitAll(); watchScale(); }, { once: true });
})();
document.fonts.addEventListener('loadingdone', refitAll);

// screen/when: output saved from last time (session.mjs), shown above a quiet "Restored" line.
async function newPane(cwd, { screen, when } = {}) {
  const id = await dt.create(cwd);
  const el = document.createElement('div');
  el.className = 'pane';
  const inner = document.createElement('div'); // unpadded box so FitAddon measures exactly
  inner.className = 'pane-inner';
  const title = document.createElement('div'); // the terminal's name (see nameChip)
  title.className = 'pane-title';
  title.innerHTML = `<div class="pane-chip">${ph('terminal', 'pane-ico')}<span></span><button class="x" aria-label="Close this terminal" title="Close (⌘W)">${ph('x', 'small')}</button></div>`;
  el.append(title, inner);
  $('hidden').append(el);

  // 10,000 lines to scroll back through (xterm's default is 1,000, which one Claude session outgrows).
  const term = new Terminal({ ...xtermOpts(settings), lineHeight: 1.25, cursorBlink: true, scrollback: 10_000, allowProposedApi: true,
    // Links an app marks itself (OSC 8: OpenCode, `ls --hyperlink`, gh): ⌘-click, like the web addresses below.
    linkHandler: { allowNonHttpProtocols: true, activate: (e, uri) => { if (e.metaKey) openUri(uri); },
      hover: (_, uri) => { el.title = linkTip(uri); }, leave: () => { el.title = ''; } } });
  const fit = new FitAddon.FitAddon(), serial = new SerializeAddon.SerializeAddon(), search = new SearchAddon.SearchAddon();
  term.loadAddon(fit);
  term.loadAddon(serial);
  term.loadAddon(search);
  // Web addresses in the output: ⌘-click opens them (openLink); a plain click just focuses the pane.
  term.loadAddon(new WebLinksAddon.WebLinksAddon((e, uri) => { if (e.metaKey) openLink(uri); }, {
    hover: (_, uri) => { el.title = linkTip(uri); },
    leave: () => { el.title = ''; },
  }));
  term.open(inner);
  // Pictures apps draw in the terminal (Sixel and iTerm's inline images), e.g. OpenCode showing an image.
  term.loadAddon(new ImageAddon.ImageAddon({ storageLimit: 32, showPlaceholder: false }));
  if (screen) term.write(`${screen}\x1b[0m\r\n\x1b[2m── Restored · ${restoredAt(when)} ──\x1b[0m\r\n`);
  const pane = { id, term, fit, serial, search, gl: null, el, cwd: cwd || '', busy: false, failed: false, unseen: false, lastUsed: Date.now(), tail: '', hist: [], at: -1, nav: null, name: '', url: null };
  panes.set(id, pane);
  const chip = title.firstChild;
  chip.onclick = (e) => {
    if (e.target.closest('.x')) return closePane(id);
    if (!chip.querySelector('input')) { focusPane(id); term.focus(); }
  };
  chip.ondblclick = (e) => { if (!e.target.closest('.x')) renameTerminal(pane); };
  useGpu(pane, settings.smoothing === 'on');
  search.onDidChangeResults(({ resultIndex, resultCount }) => { if (pane === findPane) showCount(resultIndex, resultCount); });

  // Drop a file (from the sidebar or Finder) to type its path at the cursor, e.g. to show Claude a file.
  // Works while something runs, since that something is usually Claude.
  const dropping = (e) => [...e.dataTransfer.types].some((t) => t === 'text/x-dt-path' || t === 'Files');
  el.addEventListener('dragover', (e) => {
    if (!dropping(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    el.classList.add('drop');
  });
  el.addEventListener('dragleave', (e) => { if (!el.contains(e.relatedTarget)) el.classList.remove('drop'); });
  el.addEventListener('drop', (e) => {
    e.preventDefault();
    el.classList.remove('drop');
    const own = e.dataTransfer.getData('text/x-dt-path');
    const paths = own ? [own] : [...e.dataTransfer.files].map((f) => dt.pathOf(f)).filter(Boolean);
    if (!paths.length) return;
    dt.write(id, Preview.dropText(paths));
    focusPane(id);
    term.focus();
  });

  term.onData((d) => { dt.write(id, d); pane.lastUsed = Date.now(); if (d.includes('\r') && pane === active()) setHint(''); });
  term.attachCustomKeyEventHandler((e) => {
    if (e.metaKey) return false; // every ⌘ shortcut belongs to the app
    // Shift+Enter: a new line instead of "run/send". A terminal can't send Shift, so use ESC+Return,
    // the same thing Claude's /terminal-setup sets up in VS Code. (In zsh it also adds a line.)
    if (e.key === 'Enter' && e.shiftKey && !e.altKey && !e.ctrlKey && !e.isComposing) {
      if (e.type === 'keydown') { dt.write(id, '\x1b\r'); pane.lastUsed = Date.now(); }
      return false; // swallow keydown/keypress/keyup so xterm doesn't also send a plain Return
    }
    return true;
  });
  term.textarea.addEventListener('focus', () => focusPane(id)); // clicking a pane makes it active
  // Claude Code starts the title with a spinner (◐ ◓ ◑ ◒) while it works and ✳ while it waits for you.
  // OpenCode's title is "OpenCode" or "OC | <chat>". Either way the title says which tool is open.
  term.onTitleChange((title) => {
    if (!pane.busy) return;
    pane.seen ||= Protocols.agentFromTitle(title); // however it was started (`cd x && claude`)
    const task = agentOf(pane) && Protocols.taskFromTitle(title);
    if (task) { pane.task = task; pane.taskBy = agentOf(pane).key; } // the terminal takes the task's name
    syncChip(pane);
    const now = agentOf(pane)?.titled ? Protocols.claudeTitle(title) : null;
    if (now !== null) setThinking(pane, now);
  });
  new ResizeObserver(() => refit(pane)).observe(inner);

  // Shell integration (see shell/.zshrc): OSC 7 = current folder, OSC 133 C/D = command started/finished.
  term.parser.registerOscHandler(7, (data) => {
    const m = data.match(/^file:\/\/[^/]*(\/.*)$/);
    if (m) {
      let p = m[1];
      try { p = decodeURIComponent(p); } catch {}
      if (p !== pane.cwd) {
        // Folder history for ← →. A move we asked for keeps its place; any other cd drops what was ahead.
        if (pane.nav === p) pane.nav = null;
        else { pane.hist = [...pane.hist.slice(0, pane.at + 1), p]; pane.at = pane.hist.length - 1; }
      }
      pane.cwd = p;
      if (pane === active()) refresh();
      gitSoon(tabOf(pane.id));
      renderTabs();
    }
    return true;
  });
  term.parser.registerOscHandler(133, (data) => {
    if (data.startsWith('C')) {
      // Where this command's output starts, so "What went wrong?" reads only that. A marker follows the line as the buffer scrolls.
      pane.cmdMark?.dispose();
      pane.cmdMark = term.registerMarker(0);
      pane.busy = true; pane.failed = false; pane.lastUsed = pane.startedAt = Date.now(); if (pane === active()) hideOops();
      pane.tool = data.slice(2); // the command's first word; analytics.mjs keeps it only if it's a known tool
      dt.track('command_run', { tool: pane.tool, source: pane.suggested ? 'fork' : 'typed' });
      pane.suggested = false;
    }
    if (data.startsWith('D')) {
      pane.busy = false;
      const code = Number(data.split(';')[1]);
      pane.failed = !!code && code !== 130;
      if (pane.failed) dt.track('command_failed', { tool: pane.tool });
      if (tabOf(pane.id) !== tab()) pane.unseen = true; // finished while you were elsewhere
      pane.lastUsed = Date.now();
      if (code && code !== 130 && pane === active()) showOops(); // 130 = stopped with Ctrl+C
      if (pane.thinking) turnEnded(pane); // the agent quit mid-turn: what it changed still counts
      pane.thinking = false; pane.sawSignal = false; pane.seen = null;
      syncChip(pane); // a tool's name leaves with the tool; its last task stays
      pane.url = null; // whatever served the app it printed has stopped
      gitSoon(tabOf(pane.id)); // the command may have changed files or the branch
      workDone(pane);
      if (pane.failed) nudge(pane, `${pane.tool || 'Your command'} failed`, `in ${folderOf(pane)}`, 'failed');
      else if (pane.lastUsed - pane.startedAt >= 10e3) { // long enough that you may have gone to do something else
        nudge(pane, 'Your command finished', pane.tool ? `${pane.tool} · ${folderOf(pane)}` : `In ${folderOf(pane)}`);
        chime(pane);
      }
    }
    syncBusy();
    renderTabs();
    return true;
  });

  // What terminal apps ask of us (protocols.js). Notifications: "done" or "needs you" from the app itself.
  const kitty = Protocols.kitty99();
  term.parser.registerOscHandler(99, (data) => {
    const n = kitty(data);
    if (n?.query != null) dt.write(id, Protocols.kitty99Reply(n.query)); // "what do you support?"
    else if (n) toolNotified(pane, n);
    return true;
  });
  for (const code of [9, 777]) {
    term.parser.registerOscHandler(code, (data) => { const n = Protocols.notifyFrom(code, data); if (n) toolNotified(pane, n); return true; });
  }
  // An app copying to your clipboard (OpenCode, when you select its text). Writing only, never reading.
  term.parser.registerOscHandler(52, (data) => { const text = Protocols.clipFrom(data); if (text != null) dt.clipWrite(text); return true; });
  return pane;
}

dt.onData((id, d) => {
  const p = panes.get(id);
  if (!p) return;
  p.term.write(d);
  // OpenCode, Codex or Gemini open? They show "esc to interrupt" at the bottom only while they work.
  if (p.busy && !p.hintCheck && agentOf(p) && !agentOf(p).titled) p.hintCheck = setTimeout(() => checkHint(p), 250);
  // A dev server printed its address? Keep a short tail so one split across chunks is still caught.
  p.tail = (p.tail + d).slice(-400);
  const url = Preview.findLocalUrl(Preview.stripAnsi(p.tail));
  if (url) { p.tail = ''; appFound(url, p); }
});
dt.onExit((id) => closePane(id, { exited: true })); // typing `exit` closes the pane

// Draw the active tab's split tree; park every other pane in #hidden.
function render() {
  for (const p of panes.values()) { p.el.style.flex = ''; $('hidden').append(p.el); } // a lone pane must not keep a 0.3 grow
  const build = (node) => {
    if (!node.dir) return panes.get(node.id).el;
    const d = document.createElement('div'), bar = document.createElement('div');
    const a = build(node.a), b = build(node.b);
    const size = (r) => { a.style.flex = `${r} 1 0`; b.style.flex = `${1 - r} 1 0`; };
    d.className = `split ${node.dir}`;
    bar.className = 'divider';
    size(node.ratio ?? 0.5);
    // Drag the line between panes to resize; double-click to even them out.
    bar.onpointerdown = (e) => drag(e, (x, y) => {
      const r = d.getBoundingClientRect();
      node.ratio = clamp(node.dir === 'row' ? (x - r.left) / r.width : (y - r.top) / r.height, 0.15, 0.85);
      size(node.ratio);
      saveSoon();
    });
    bar.ondblclick = () => { node.ratio = 0.5; size(0.5); saveSoon(); };
    d.append(a, bar, b);
    return d;
  };
  $('term').replaceChildren(build(tab().root));
  $('term').classList.toggle('multi', Panes.leaves(tab().root).length > 1);
  for (const p of panes.values()) p.el.classList.toggle('active', p.id === tab().activeId);
  renderTabs();
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// Pointer capture keeps the drag alive while the cursor crosses an xterm.
function drag(e, fn) {
  const el = e.currentTarget;
  e.preventDefault();
  el.setPointerCapture(e.pointerId);
  el.classList.add('dragging');
  el.onpointermove = (m) => fn(m.clientX, m.clientY);
  el.onpointerup = () => { el.onpointermove = null; el.classList.remove('dragging'); };
}

$('sideGrip').onpointerdown = (e) => drag(e, (x) => { $('app').style.setProperty('--side', `${clamp(x, 180, 420)}px`); saveSoon(); });

function focusPane(id) {
  $('app').classList.remove('in-settings'); // ⌘N, ⌘T, ⌘1–9, splits: back to the terminal
  const t = tabOf(id);
  if (!t) return;
  if (t === tab() && t.activeId === id) return;
  tabIx = tabs.indexOf(t);
  t.activeId = id;
  if (!isGame(panes.get(id))) t.lastTerm = id;
  for (const pid of Panes.leaves(t.root)) panes.get(pid).unseen = false;
  render();
  gitSoon(t);
  if (findOpen()) find(); // find follows you to the pane you switched to
  hideOops();
  setHint('');
  syncBusy();
  refresh();
  focusActive();
}

// A workspace is a folder (dir): its name, info, files and search are that folder's, wherever its terminals
// go. Its first terminal starts there (or in start: a clone starts in the folder it downloads into).
async function newTab(dir, { start } = {}) {
  const p = await newPane(start ?? dir);
  nameTerminal(p, null);
  tabs.push({ root: { id: p.id }, activeId: null, color: nextColor(), dir });
  focusPane(p.id);
  return p;
}

async function split(dir) {
  const cur = active();
  if (!cur) return;
  const p = await newPane(tab().dir || cur.cwd); // a split opens in the workspace's folder
  dt.track('pane_split', { dir });
  nameTerminal(p, tab());
  tab().root = Panes.split(tab().root, cur.id, p.id, dir);
  focusPane(p.id);
}

// ⌘T: one more terminal in this workspace, side by side with the others.
async function addTerminal() {
  if (!tabs.length) return openPicker({ required: true });
  const p = await newPane(tab().dir || active()?.cwd);
  dt.track('pane_split', { dir: 'row' });
  nameTerminal(p, tab());
  tab().root = Panes.append(tab().root, p.id);
  focusPane(p.id);
}

function closePane(id, { exited = false, force = false } = {}) {
  const p = panes.get(id);
  if (!p) return;
  if (!exited && !force && p.busy && !confirm('Something is still running here. Close it anyway?')) return;
  const t = tabOf(id), cur = tab();
  if (isGame(p)) Games.close();
  else { if (!exited) dt.kill(id); p.term.dispose(); }
  if (p.turn?.before) dt.turnDrop(p.turn.dir, p.turn.before.path); // closed mid-turn: no after to go with it
  p.el.remove();
  panes.delete(id);
  t.root = Panes.remove(t.root, id);
  if (!t.root) {
    tabs.splice(tabs.indexOf(t), 1);
    if (!tabs.length) return noWorkspace(); // the last one closed: pick a folder to work in
    tabIx = t === cur ? Math.min(tabIx, tabs.length - 1) : tabs.indexOf(cur);
  } else if (t.activeId === id) {
    t.activeId = Panes.leaves(t.root)[0];
  }
  const next = tab().activeId;
  tab().activeId = null; // force a redraw
  focusPane(next);
}

function closeTab(i) {
  const ids = Panes.leaves(tabs[i].root);
  if (ids.some((id) => panes.get(id)?.busy) && !confirm('Something is still running in this tab. Close it anyway?')) return;
  for (const id of ids) closePane(id, { force: true });
}

function goTab(i) {
  if (!tabs.length) return;
  focusPane(tabs[(i + tabs.length) % tabs.length].activeId);
}

// The workspaces, one tab each along the top: a square in the workspace's colour and the folder's name.
// The square is the status: a rippling lattice while something works, yellow (needs you, or finished while
// you were away) or red (failed), pulsing until it's seen to, then its own colour again (index.html .ws-sq).
// Tabs are kept and updated in place (not redrawn), so a square's split, merge, wave and pulse carry on
// smoothly however often this runs.
const rowOf = new WeakMap(); // tab -> its tab in the strip
const CELLS = [0, 1, 2].flatMap((r) => [0, 1, 2].map((c) => `<i style="--c:${c};--r:${r}"></i>`)).join('');
const put = (el, prop, v) => { if (el[prop] !== v) el[prop] = v; };
const SQUARE = { done: 'Needs you', failed: 'Failed' }; // the states that recolour the square
let tabsDrawn = false, shownIx = -1;
function renderTabs() {
  const box = $('tabs');
  tabs.forEach((t, i) => {
    let row = rowOf.get(t);
    if (!row) {
      row = document.createElement('div');
      row.className = 'tab';
      row.setAttribute('role', 'tab');
      row.innerHTML = `<span class="ws-sq"><span class="ws-cubes">${CELLS}</span></span><span class="tname"></span>`
        + `<button class="tclose" aria-label="Close workspace" title="Close workspace">${ph('x', 'small')}</button>`;
      if (tabsDrawn) { // one you just opened pops in; the ones a window starts with are simply there
        row.classList.add('enter');
        row.addEventListener('animationend', () => row.classList.remove('enter'), { once: true });
      }
      rowOf.set(t, row);
    }
    if (box.children[i] !== row) box.insertBefore(row, box.children[i] || null);
    const ps = panesOf(t), key = tabKey(t);
    row.classList.toggle('active', i === tabIx);
    row.setAttribute('aria-selected', String(i === tabIx));
    row.dataset.i = i;
    if (i < 9) row.dataset.key = `⌘${i + 1}`; else delete row.dataset.key;
    put(row, 'title', LOOKS[key].label + (dirOfTab(t) ? ` · ${dirOfTab(t)}` : ''));
    row.style.setProperty('--tab-c', `var(--ws-${(t.color ?? 0) + 1})`);
    const tn = row.querySelector('.tname'); // gone while you're renaming it
    if (tn) put(tn, 'textContent', tabName(t));
    row.querySelector('.tclose').dataset.close = i;
    const box2 = row.querySelector('.ws-sq'), sq = row.querySelector('.ws-cubes'), run = key === 'running';
    if ((box2.dataset.s || '') !== (SQUARE[key] ? key : '')) { if (SQUARE[key]) box2.dataset.s = key; else delete box2.dataset.s; }
    // Working: the square separates into a lattice and ripples; it merges back when done.
    if (sq.classList.contains('working') !== run) {
      if (run) sq.style.setProperty('--phase', `-${Date.now() % 2100}ms`); // every working square ripples in step
      sq.classList.toggle('working', run);
    }
    const said = run ? 'Working' : SQUARE[key];
    box2.setAttribute('role', said ? 'img' : 'presentation');
    said ? box2.setAttribute('aria-label', said) : box2.removeAttribute('aria-label');
    for (const x of ps) syncChip(x);
  });
  for (const row of [...box.children].slice(tabs.length)) row.remove(); // closed workspaces
  tabsDrawn = true;
  if (tabIx !== shownIx) { shownIx = tabIx; box.children[tabIx]?.scrollIntoView({ block: 'nearest', inline: 'nearest' }); }
  renderInfo();
  syncNotch();
  saveSoon(); // tabs, splits, folders and busy states all pass through here
}

// The sidebar's Workspace info, for the open workspace: its branch (or, outside git, its folder), what's
// changed (gitSoon) and the app it's serving (appFound), each only when there is one.
function renderInfo() {
  const t = tab();
  if (!t) return put($('wsInfo'), 'innerHTML', '');
  const ps = panesOf(t), g = t.git, url = ps.find((x) => x.url)?.url, cwd = dirOfTab(t);
  const where = cwd === home ? '~' : cwd.startsWith(home + '/') ? '~' + cwd.slice(home.length) : cwd;
  put($('wsInfo'), 'innerHTML', [
    g?.branch ? `<div class="ws-line">${ph('git-branch')}<span>${esc(g.branch)}</span></div>`
      : where && `<div class="ws-line">${ph('folder')}<span>${esc(where)}</span></div>`,
    g?.files && `<div class="ws-line">${ph('plus-minus')}<span><span class="plus">+${g.add}</span> <span class="minus">-${g.del}</span></span>`
      + `<span>·</span><span>${g.files} ${g.files === 1 ? 'file' : 'files'} changed</span></div>`,
    url && `<button class="ws-line ws-link" data-url="${esc(url)}" title="${inFork() ? 'Show your app' : 'Open in your browser'}">`
      + `${ph('globe')}<span>${esc(url.replace(/^https?:\/\//, '').replace(/\/$/, ''))}</span></button>`,
  ].filter(Boolean).join(''));
}
$('wsInfo').onclick = (e) => { const b = e.target.closest('[data-url]'); if (b) openApp(b.dataset.url); };

// Each terminal's chip: its name (labelOf) and its icon, console-sparkle while an AI agent (Claude, Codex…)
// is open in it, a terminal otherwise. A change of icon pops the new one in (index.html .pane-ico).
function syncChip(p) {
  const label = p.el.querySelector('.pane-chip > span'), text = labelOf(p);
  if (label) { put(label, 'textContent', text); put(label, 'title', text); }
  const a = agentOf(p), ai = !!a;
  if (p.chipAi === ai) return;
  const first = p.chipAi === undefined;
  p.chipAi = ai;
  const ico = p.el.querySelector('.pane-ico');
  if (!ico) return;
  ico.style.setProperty('--ph', `url(${PH_DIR}/${ai ? 'console-sparkle' : 'terminal'}.svg)`);
  ico.setAttribute('role', 'img');
  ico.setAttribute('aria-label', ai ? `${a.name} is open` : 'Terminal');
  if (!first) { ico.classList.remove('enter'); void ico.offsetWidth; ico.classList.add('enter'); }
}

// Each workspace's square: the colour the fewest others have, so the first three always differ.
function nextColor() {
  const n = [0, 0, 0];
  for (const t of tabs) if (t.color >= 0 && t.color < 3) n[t.color]++;
  return n.indexOf(Math.min(...n));
}

// Each workspace's branch and what's changed (main.js git:info), for the folder its open terminal is in.
// Read again when a command finishes, the folder changes, files change on disk, or you switch terminals; never on a timer.
function gitSoon(t) {
  if (!t) return;
  clearTimeout(t.gitTimer);
  t.gitTimer = setTimeout(async () => {
    const cwd = dirOfTab(t);
    const g = cwd ? await dt.gitInfo(cwd) : null;
    if (!tabs.includes(t) || JSON.stringify(g) === JSON.stringify(t.git ?? null)) return;
    t.git = g;
    renderTabs();
  }, 300);
}

// Terminal names, on each pane's chip: "Terminal 1", "Terminal 2"… in a workspace, the lowest number not
// taken. While an AI tool works in it, the terminal shows what it's working on instead (p.task, from the
// tool's title), and keeps the last task after the tool quits. Tools that don't say (Codex, Gemini) show
// their own name while they're open. A name you type yourself (p.named) always wins. Saved with the session.
function labelOf(p) {
  if (p.named) return p.name;
  const a = agentOf(p);
  return a && a.key !== p.taskBy ? a.name : p.task || p.name;
}
function nameTerminal(p, t, name, named = !!name) {
  if (!name) {
    const taken = new Set(t ? panesOf(t).map((x) => x.name) : []);
    let n = 1;
    while (taken.has(`Terminal ${n}`)) n++;
    name = `Terminal ${n}`;
  }
  p.name = name;
  p.named = named;
  syncChip(p);
}
function renameTerminal(p) {
  const label = p.el.querySelector('.pane-chip > span');
  if (!label) return;
  // An empty name hands it back to the auto names.
  inlineRename(label, labelOf(p), 'Terminal name', (v) => {
    if (v !== null && v !== labelOf(p)) v ? nameTerminal(p, null, v) : nameTerminal(p, tabOf(p.id));
    else syncChip(p);
    saveSoon();
    p.term.focus();
  });
}

// Renaming in place: the label becomes a text field. Enter or clicking away keeps what you typed (trimmed;
// '' when empty), Esc keeps the old name (null).
function inlineRename(label, value, ariaLabel, done) {
  const input = document.createElement('input');
  input.value = value;
  input.spellcheck = false;
  input.setAttribute('aria-label', ariaLabel);
  label.replaceWith(input);
  input.focus();
  input.select();
  let over = false;
  const end = (keep) => {
    if (over) return;
    over = true;
    input.replaceWith(label);
    done(keep ? input.value.trim().slice(0, 60) : null);
  };
  input.onkeydown = (e) => { e.stopPropagation(); if (e.key === 'Enter') end(true); if (e.key === 'Escape') end(false); };
  input.onblur = () => end(true);
}

// A workspace is named after its folder until you name it (t.name): double-click its tab or ⌘R.
// An empty name goes back to the folder's.
function renameWorkspace(t) {
  const label = t && rowOf.get(t)?.querySelector('.tname');
  if (!label) return;
  closeSettings();
  inlineRename(label, tabName(t), 'Workspace name', (v) => {
    if (v !== null && v !== tabName(t)) t.name = v;
    renderTabs();
    if (t === tab()) active()?.term.focus();
  });
}

// Each tab's state, in words (the row's tooltip, the notch). With split panes, the most pressing pane wins.
const DOZE_AFTER = 5 * 60e3;
const LOOKS = {
  running: { label: 'Running' },
  failed: { label: 'Last command failed' },
  done: { label: 'Finished while you were away' },
  dozing: { label: 'Dozing' },
  ready: { label: 'Ready' },
};
const panesOf = (t) => Panes.leaves(t.root).map((id) => panes.get(id)).filter(Boolean);
function tabKey(t) {
  const ps = panesOf(t);
  return ps.some(working) ? 'running'
    : ps.some((p) => p.failed) ? 'failed'
    : ps.some((p) => p.unseen) ? 'done'
    : ps.length && ps.every((p) => Date.now() - p.lastUsed > DOZE_AFTER) ? 'dozing'
    : 'ready';
}
const tabState = (t) => LOOKS[tabKey(t)];
const dirOfTab = (t) => t?.dir || (panes.get(t?.activeId) || (t && panesOf(t)[0]))?.cwd || ''; // dir; cwd only for a game tab
function tabName(t) {
  if (t.name) return t.name;
  const ps = panesOf(t), p = panes.get(t.activeId) || ps[0], d = dirOfTab(t);
  return isGame(p) && ps.length === 1 ? 'Games' : !d ? 'New tab' : d === home ? 'Home' : d.split('/').pop() || '/';
}

// The notch (main.js, notch.js) mirrors every tab while you're in another app: what it's doing, which
// tool, since when, and the pane to jump to (the one working, failed or finished).
let notchTimer = 0;
function syncNotch() {
  if (notchTimer) return;
  notchTimer = setTimeout(() => {
    notchTimer = 0;
    dt.notchState(tabs.map((t) => {
      const state = tabKey(t), ps = panesOf(t);
      const p = { running: ps.find(working), failed: ps.find((x) => x.failed), done: ps.find((x) => x.unseen) }[state]
        || panes.get(t.activeId) || ps[0];
      const a = agentOf(p);
      return { name: tabName(t), state, label: LOOKS[state].label, tool: a?.name || p?.tool || '', agent: !!a,
        since: (a ? p.thinkingSince : p?.startedAt) || Date.now(), pane: p?.id };
    }));
  }, 250);
}
setInterval(syncNotch, 30e3); // so an untouched tab dozes off on its own

$('tabs').onclick = (e) => {
  const c = e.target.closest('.tclose');
  if (c) return closeTab(+c.dataset.close);
  const t = e.target.closest('.tab');
  if (t) { closeSettings(); goTab(+t.dataset.i); }
};
$('tabs').ondblclick = (e) => {
  const t = !e.target.closest('.tclose, input') && e.target.closest('.tab');
  if (t) renameWorkspace(tabs[+t.dataset.i]);
};
$('newTab').onclick = () => openPicker();
const toggleSide = () => { $('app').classList.toggle('no-side'); dt.track('sidebar_toggled'); saveSoon(); }; // panes refit via their ResizeObserver
$('sideToggle').onclick = $('sideShow').onclick = toggleSide;

// --- The sidebar's footer: What's new, Settings (below) and the welcome tour.
$('railHelp').onclick = () => replayTour();
// This version's release notes, any time (they also show once by themselves after an update).
$('railNew').onclick = async () => {
  const [v, r] = await Promise.all([dt.version(), dt.updateNotes()]);
  showUpdate(`What's new in Fork ${v}`, r?.notes || "<p>Couldn't load what's new. Check your internet connection and try again.</p>", false);
};
$('splitR').onclick = () => split('row');
$('splitD').onclick = () => split('col');

dt.onCmd((cmd) => ({
  'new-workspace': () => openPicker(),
  'new-terminal': () => addTerminal(),
  'rename-workspace': () => renameWorkspace(tab()),
  'rename-terminal': () => active() && renameTerminal(active()),
  close: () => (active() ? closePane(active().id) : !tabs.length && forgetAndClose()), // no workspace left: ⌘W closes the window
  'split-right': () => split('row'),
  'split-down': () => split('col'),
  'next-tab': () => goTab(tabIx + 1),
  'prev-tab': () => goTab(tabIx - 1),
  settings: () => (inSettings() ? closeSettings() : openSettings()),
  'toggle-sidebar': toggleSide,
  'toggle-preview': togglePv,
  find: openFind,
  'find-next': () => (findOpen() ? find('next') : openFind()),
  'find-prev': () => (findOpen() ? find('prev') : openFind()),
  back: () => go(-1),
  forward: () => go(1),
  tour: replayTour,
  'check-update': checkUpdateNow,
}[cmd]?.()));

// A program being open (busy) isn't the same as it working: an AI tool sits open at its prompt between
// requests. Claude's title says which (spinner = working, ✳ = waiting for you); the others show "esc to
// interrupt" only while they work. No sign of either yet? Assume working.
const agentOf = (p) => (p?.busy && (Protocols.AGENTS[p.tool] || Protocols.AGENTS[p.seen])) || null;
const isClaude = (p) => agentOf(p)?.key === 'claude';
const working = (p) => !!p?.busy && (!agentOf(p) || p.thinking || !p.sawSignal);
const busyMsg = (p) => (agentOf(p) ? `${agentOf(p).name} is open here. ${agentOf(p).leave}` : 'Something is running. Stop it first (Ctrl+C), then try again.');
const doneText = (p) => (agentOf(p) ? `${agentOf(p).name}’s done` : 'Your command finished');
const folderOf = (p) => tabOf(p.id)?.name || (p.cwd === home ? 'Home' : p.cwd.split('/').pop() || '/'); // the tab's name

// The tool went from working to waiting for you (or back). Waiting after working = it's done, or needs you.
function setThinking(pane, on) {
  const was = pane.thinking, saw = pane.sawSignal;
  pane.thinking = on; pane.sawSignal = true;
  if (was === on && saw) return;
  if (on) { pane.thinkingSince = Date.now(); turnStarted(pane); } // for the notch's "working · 2m"
  if (!on) {
    if (tabOf(pane.id) !== tab()) pane.unseen = true; // it finished while you were elsewhere
    pane.lastUsed = Date.now();
    turnEnded(pane);
    workDone(pane);
    if (was) { nudge(pane, doneText(pane), `In ${folderOf(pane)}`); chime(pane); }
  }
  syncBusy();
  renderTabs();
}
function checkHint(p) {
  p.hintCheck = null;
  if (!panes.has(p.id) || !agentOf(p) || agentOf(p).titled) return;
  const b = p.term.buffer.active, end = b.viewportY + p.term.rows;
  let text = '';
  for (let y = Math.max(0, end - 12); y < end; y++) text += `${b.getLine(y)?.translateToString(true) ?? ''}\n`;
  setThinking(p, Protocols.interruptHint(text));
}

// The app itself said it's done or needs you (OSC 9 / 777 / 99).
function toolNotified(pane, { title, body }) {
  if (tabOf(pane.id) !== tab()) { pane.unseen = true; renderTabs(); }
  nudge(pane, title || agentOf(pane)?.name || 'Fork', body || `In ${folderOf(pane)}`);
}
// Only while you're in another app: in the notch on a Mac that has one, otherwise a Mac notification,
// plus a dock badge (Settings → Notifications). kind: done or failed.
// The tool's own notification and Fork's noticing it's done arrive close together: show one.
// Something you were waiting on finished (an agent's turn, a command of 10s or more): a soft chime
// (sounds.js), in Fork or not. Settings → Notifications turns it off. One per pane at a time.
function chime(pane) {
  if (settings.sounds !== 'on' || Date.now() - (pane.chimedAt || 0) < 2000) return;
  pane.chimedAt = Date.now();
  Sounds.play(Sounds.done);
}
function nudge(pane, title, body, kind = 'done', url) {
  if (document.hasFocus()) return;
  if (Date.now() - (pane.nudgedAt || 0) < 2000) return;
  pane.nudgedAt = Date.now();
  dt.notify({ kind, title, body, pane: pane.id, url, alerts: settings.alerts !== 'off',
    silent: kind === 'done' && settings.sounds === 'on' }); // Fork's own chime plays instead of the Mac's ping
  dt.track('notification_shown', { tool: pane.tool, kind });
}
dt.onGoPane((id, action) => { // clicked a notification or the notch
  const t = tabOf(id);
  if (!t) return;
  goTab(tabs.indexOf(t));
  focusPane(id);
  panes.get(id)?.term?.focus();
  if (action === 'failed') showOops(); // "What went wrong?"
});

function syncBusy() {
  const p = activeTerm(), on = working(p);
  $('app').classList.toggle('busy', !!p?.busy); // chips and folders wait while anything is open
  $('app').classList.toggle('working', on); // the "running" bar only while it's really working
  const a = agentOf(p);
  $('runText').textContent = a ? `${a.name} is working.` : 'Something is running.';
  $('stop').textContent = a ? 'Stop it (Esc)' : 'Stop it (Ctrl+C)'; // Esc interrupts an AI tool; Ctrl+C would quit it
  $('stop').dataset.key = a ? 'esc' : '⌃C';
}

// --- Games (games.js): Snake, Stack and Space Run, in a pane of their own -----------------------
// The game splits the terminal you're in (right if it's wide, down if it's tall) and fills that half.
// No room left? It gets a tab of its own. One game pane at a time. While you're playing, it keeps an
// eye on the terminal you came from (and the one beside it): when Claude or a command there is done,
// the game pauses and says so.
let gameFrom = null, doneIn = null, gameSeq = 0; // the terminal the game came from; the one that just finished
function openGame(id) {
  $('app').classList.remove('in-settings');
  if ($('startOv').classList.contains('show')) closeStart(); // it would sit on top of the game
  const src = activeTerm();
  gameFrom = src?.id ?? null;
  let g = [...panes.values()].find(isGame);
  if (!g) {
    g = { id: -++gameSeq, kind: 'game', el: document.createElement('div'), cwd: src?.cwd || '', hist: [], at: -1,
      busy: false, failed: false, unseen: false, lastUsed: Date.now() };
    g.el.className = 'pane game-pane';
    g.el.append(Games.el);
    panes.set(g.id, g);
    const r = src?.el.getBoundingClientRect(), t = src && tabOf(src.id);
    const dir = !r ? null : r.width >= 640 && r.width >= r.height ? 'row' : r.height >= 400 ? 'col' : null;
    if (dir) t.root = Panes.split(t.root, src.id, g.id, dir); // the game half is at least 320 × 200
    else tabs.push({ root: { id: g.id }, activeId: null, color: nextColor(), dir: t?.dir || tab()?.dir });
  }
  focusPane(g.id);
  Games.open(id);
}
function workDone(pane) {
  if (readingBook() && tabOf(pane.id) === tab()) {
    doneIn = pane.id;
    return Reader.workDone(doneText(pane));
  }
  if (!Games.isOpen() || !isGame(active())) return; // looking at the terminal? Then you saw it finish
  if (pane.id !== gameFrom && pane.id !== tab().lastTerm) return;
  doneIn = pane.id;
  Games.workDone(doneText(pane));
}
const backToTerminal = (id) => { const p = panes.get(id) || activeTerm(); if (p) { focusPane(p.id); p.term.focus(); } }; // already active? still type there
Games.setup({
  track: dt.track,
  onEsc: () => backToTerminal(gameFrom),
  onBack: () => backToTerminal(doneIn ?? gameFrom),
});
$('playGame').onclick = () => openGame();

// The core mechanic: put the real command in the prompt. Moving around runs instantly;
// anything that changes things waits for Enter so the person stays in control and learns it.
function send(cmd, why, run) {
  const p = activeTerm();
  if (!p) return;
  if (cmd === '\x03') { dt.write(p.id, cmd); p.term.focus(); return; }
  if (p.busy) { setHint(busyMsg(p), true); return; }
  dt.write(p.id, '\x15' + cmd + (run ? '\r' : '')); // Ctrl+U clears anything half-typed first
  p.suggested = true;
  setHint(run ? '' : why);
  p.term.focus();
}

// ← → in the sidebar (and ⌘[ ⌘]): back and forward through the folders this pane has been in.
function go(step) {
  const p = activeTerm(), path = p?.hist[p.at + step];
  if (!path) return;
  if (p.busy) return setHint(busyMsg(p), true);
  p.at += step;
  p.nav = path;
  dt.track('folder_opened', { via: step < 0 ? 'back' : 'forward' });
  send(`cd ${q(path)}`, '', true);
}
function syncArrows() {
  const p = active();
  $('back').disabled = !(p?.at > 0);
  $('fwd').disabled = !(p && p.at < p.hist.length - 1);
}
$('back').onclick = () => go(-1);
$('fwd').onclick = () => go(1);

function setHint(text, warn) {
  const h = $('hint');
  h.classList.toggle('show', !!text);
  h.classList.toggle('warn', !!warn);
  h.innerHTML = !text ? '' : warn ? esc(text) : `<kbd>↵ Enter</kbd> to run · ${esc(text)}`;
}

// --- Where am I + what can I do here -------------------------------------------
const join = (dir, name) => (dir === '/' ? '' : dir) + '/' + name;
// The tree is @pierre/trees (vendor/trees.js: virtual rows, arrow keys, screen readers, git badges). It reads
// lazily like before: the folder you're in, plus each folder you open. Its paths are relative to that folder,
// a folder's ends in "/".
const expanded = new Set(); // open folders (full paths), remembered across cds
let treeDirs = [], refreshing = 0, treeRoot = '', treePaths = new Set();
// A file's type icon in the theme colour for its kind (icons.js): the preview's title.
const fileIconHtml = (name) => `<span class="fi">${icon(fileIcon(name).icon)}</span>`;
const loaded = new Map(); // folder read so far (full path) -> its entries (files.mjs list)
const noisy = new Set(); // node_modules, dist…: sorted last
const relOf = (path) => path.slice(treeRoot.length + 1);
const absOf = (id) => join(treeRoot, id.replace(/\/$/, ''));
const tree = new Trees.FileTree({
  // The tree's "complete" icons: a coloured icon per file type, with brand and framework logos (React, Tailwind…).
  paths: [], itemHeight: 28, icons: { set: 'complete', colored: true,
    // Folder arrows are Central's chevron when it's drawn on this Mac (the tree still turns it for closed folders).
    ...(window.CENTRAL_SPRITE && { spriteSheet: window.CENTRAL_SPRITE,
      remap: { 'file-tree-icon-chevron': { name: 'central-chevron-down', viewBox: '0 0 24 24' } } }) },
  sort: (a, b) => b.isDirectory - a.isDirectory || noisy.has(a.path) - noisy.has(b.path) || a.basename.localeCompare(b.basename),
  dragAndDrop: { canDrop: () => false }, // rows drag out to a terminal (below); nothing moves on disk
  unsafeCSS: '[data-file-tree-virtualized-scroll] { padding-bottom: 44px; }', // the last file scrolls clear of the sidebar's footer
});
tree.render({ fileTreeContainer: $('entries') });

// Every path the tree should hold: what's in each folder read so far, plus changed files deeper down
// (so a closed folder still shows it has changes inside).
function treeList(changed) {
  const out = new Set();
  noisy.clear();
  for (const [dir, entries] of loaded) {
    const pre = dir === treeRoot ? '' : relOf(dir) + '/';
    for (const e of entries) {
      const id = pre + e.name + (e.folder ? '/' : '');
      out.add(id);
      if (e.noise) noisy.add(pre + e.name);
    }
  }
  for (const c of changed) out.add(c.path);
  return out;
}
const readDir = async (dir) => loaded.set(dir, await dt.ls(dir));
// A folder you open that hasn't been read yet: read it, add what's in it.
tree.subscribe(() => {
  if (!treeRoot) return;
  const open = tree.getVisibleRows(0, tree.getVisibleCount() - 1).filter((r) => r.kind === 'directory' && r.isExpanded).map((r) => absOf(r.path));
  for (const p of [...expanded]) if (p.startsWith(treeRoot + '/') && !open.includes(p) && tree.getItem(relOf(p) + '/')) expanded.delete(p);
  const fresh = open.filter((p) => !expanded.has(p));
  for (const p of fresh) expanded.add(p);
  if (fresh.some((p) => !loaded.has(p))) refresh();
  else if (fresh.length) { treeDirs = [treeRoot, ...expanded].filter((d) => d === treeRoot || d.startsWith(treeRoot + '/')); syncWatch(); }
});

async function refresh() {
  syncArrows();
  const cwd = dirOfTab(tab()); // the workspace's folder, not wherever its terminal has gone
  if (!cwd) return;
  const run = ++refreshing, moved = cwd !== treeRoot;
  const inside = [...expanded].filter((p) => p.startsWith(cwd + '/'));
  const fresh = new Map();
  const [r, changed] = await Promise.all([dt.dir(cwd), dt.gitFiles(cwd),
    ...inside.map(async (p) => fresh.set(p, await dt.ls(p)))]);
  if (run !== refreshing || cwd !== dirOfTab(tab())) return; // switched workspaces, or a newer refresh, while reading
  const { suggestions } = r;
  home = r.home;
  if (moved) loaded.clear();
  treeRoot = cwd;
  loaded.set(cwd, r.entries);
  for (const [p, list] of fresh) loaded.set(p, list);
  const next = treeList(changed);
  if (moved) tree.resetPaths([...next], { initialExpandedPaths: inside.map((p) => relOf(p) + '/') });
  else {
    const ops = [...treePaths].filter((p) => !next.has(p)).map((path) => ({ type: 'remove', path, recursive: true }))
      .concat([...next].filter((p) => !treePaths.has(p)).map((path) => ({ type: 'add', path })));
    if (ops.length) tree.batch(ops);
  }
  treePaths = next;
  tree.setGitStatus(changed);
  const atHome = cwd === home; // your whole home folder isn't a project: offer a way into one instead
  $('entries').hidden = atHome || !r.entries.length;
  $('treeEmpty').hidden = atHome || !!r.entries.length;
  $('homeEmpty').hidden = !atHome;
  $('collapseAll').hidden = $('newFile').hidden = atHome;
  if (atHome) drawHomeRecent();
  treeDirs = [cwd, ...inside];
  syncWatch();
  markShown();

  const parts = [];
  let base = '/', rest = cwd;
  if (cwd === home || cwd.startsWith(home + '/')) { parts.push(['Home', home]); base = home; rest = cwd.slice(home.length); }
  else parts.push(['/', '/']);
  let acc = base;
  for (const seg of rest.split('/').filter(Boolean)) { acc = acc.replace(/\/$/, '') + '/' + seg; parts.push([seg, acc]); }
  $('crumbs').innerHTML = parts.map(([name, path], i) =>
    `${i ? '<span class="sep">›</span>' : ''}<button class="crumb" data-path="${esc(path)}">${esc(name)}</button>`).join('');

  chips = suggestions;
  $('chips').innerHTML = suggestions.map((s, i) => `<button class="chip" data-i="${i}" title="${esc(s.cmd)}">${esc(s.label)}</button>`).join('');
  renderTabs();
  if (moved) syncPvFolder();
}

// A Home workspace's Files: a few recent projects to move this workspace into (or Choose any folder).
async function drawHomeRecent() {
  const list = (await dt.recents()).filter((p) => p !== home && !tabs.some((t) => t.dir === p)).slice(0, 3);
  $('homeRecent').innerHTML = list.length ? '<h3>Recent</h3>' + list.map((p) => `<button class="he-row" data-path="${esc(p)}" title="${esc(tilde(p))}">`
    + `${ph('folder')}<span>${esc(p.split('/').pop() || '/')}</span></button>`).join('') : '';
}
// Point this workspace at a project folder: same tab, same terminals (the idle ones cd there), new name and files.
function moveWorkspace(dir) {
  const t = tab(), other = tabs.findIndex((x) => x !== t && x.dir === dir);
  if (!t || !dir) return;
  if (other >= 0) return goTab(other); // already open: go there
  t.dir = dir;
  dt.recents(dir);
  dt.track('start_choice', { choice: 'from_home' });
  for (const p of panesOf(t)) if (!p.busy && !isGame(p)) dt.write(p.id, `cd ${q(dir)}\r`);
  t.git = null;
  gitSoon(t);
  renderTabs();
  refresh();
}
$('homeChoose').onclick = async () => { const p = await dt.pickFolder(); if (p) moveWorkspace(p); };
$('homeRecent').onclick = (e) => { const b = e.target.closest('.he-row'); if (b) moveWorkspace(b.dataset.path); };

$('crumbs').onclick = (e) => {
  const b = e.target.closest('.crumb');
  if (b) { send(`cd ${q(b.dataset.path)}`, '', true); dt.track('folder_opened', { via: 'crumb' }); }
};
// A folder opens and closes in place; a file opens in the preview panel (or, with Settings → Links & files
// off, in whatever app the Mac uses for it). Going into a folder in the terminal is on the right-click menu.
const showFile = (path) => {
  if (inFork()) return openFile(path);
  dt.track('file_previewed', { kind: fileIcon(path.split('/').pop()).icon, where: 'app' }); // the type, never the name
  dt.openDefault(path);
};
// --- Search: file names in this workspace, then the lines inside files that have the words (main.js
// files:search). The results take the place of the info and files while there's something in the box; Esc or
// an empty box brings them back. A result opens in the preview; a line opens there, highlighted.
const searchIn = $('search');
let found = null, foundIx = -1, searchTimer = 0, searchRun = 0;
function focusSearch() {
  closeSettings();
  $('app').classList.remove('no-side');
  searchIn.focus();
  searchIn.select();
}
function endSearch() {
  clearTimeout(searchTimer); searchRun++;
  found = null; foundIx = -1;
  $('findList').hidden = true; $('findList').innerHTML = '';
  $('sideBody').hidden = false;
}
searchIn.oninput = () => {
  clearTimeout(searchTimer);
  const q = searchIn.value.trim();
  if (!q) return endSearch();
  searchTimer = setTimeout(() => runSearch(q), 120);
};
async function runSearch(q) {
  const run = ++searchRun, root = dirOfTab(tab()) || treeRoot;
  if (!root) return;
  const r = await dt.searchFiles(root, q);
  if (!r || run !== searchRun) return; // a newer search took over
  found = { ...r, root, q }; foundIx = -1;
  drawFound();
}
const baseOf = (p) => p.slice(p.lastIndexOf('/') + 1);
const folderPart = (p) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');
function marked(text, q) {
  const i = text.toLowerCase().indexOf(q.toLowerCase());
  return i < 0 ? esc(text) : esc(text.slice(0, i)) + `<mark>${esc(text.slice(i, i + q.length))}</mark>` + esc(text.slice(i + q.length));
}
function drawFound() {
  const { names, hits, q } = found, box = $('findList');
  let n = 0;
  const row = (path, line, top, snip) => `<div class="fl-row" role="option" id="fl${n}" data-n="${n++}" data-path="${esc(path)}"${line ? ` data-line="${line}"` : ''}>`
    + `<div class="fl-top">${fileIconHtml(baseOf(path))}${top}<small>${esc(folderPart(path))}</small></div>${snip || ''}</div>`;
  const html = (names.length ? '<h3>Files</h3>' + names.map((p) => row(p, 0, `<b>${marked(baseOf(p), q)}</b>`)).join('') : '')
    + (hits.length ? '<h3>In files</h3>' + hits.map((h) => row(h.path, h.line, `<b>${esc(baseOf(h.path))}<span>:${h.line}</span></b>`,
      `<div class="fl-snip">${marked(h.text, q)}</div>`)).join('') : '');
  box.innerHTML = html || `<div class="fl-empty">Nothing matches “${esc(q)}” in this folder.</div>`;
  $('sideBody').hidden = true;
  box.hidden = false;
  box.scrollTop = 0;
}
function pickFound(i) {
  const rows = $('findList').querySelectorAll('.fl-row');
  if (!rows.length) return;
  foundIx = (i + rows.length) % rows.length;
  rows.forEach((r, k) => r.classList.toggle('on', k === foundIx));
  rows[foundIx].scrollIntoView({ block: 'nearest' });
  searchIn.setAttribute('aria-activedescendant', rows[foundIx].id);
}
async function openFound(row) {
  if (!row || !found) return;
  const path = join(found.root, row.dataset.path), line = +row.dataset.line || 0;
  await showFile(path);
  if (line) showLine(path, line);
}
// The preview's code view: select line n and bring it into view (its rows live in @pierre/diffs' shadow root).
function showLine(path, n, tries = 20) {
  if (pv.file !== path || !codeFile) return;
  const host = [...$('pvFile').querySelectorAll('*')].find((el) => el.shadowRoot);
  const el = host?.shadowRoot.querySelector(`[data-line="${n}"]`);
  if (!el) return tries && setTimeout(() => showLine(path, n, tries - 1), 50);
  codeFile.setSelectedLines({ start: n, end: n });
  const view = $('pvFile'); // straight down to it, never sideways (scrollIntoView also scrolled the code left)
  view.scrollTop += el.getBoundingClientRect().top - view.getBoundingClientRect().top - view.clientHeight / 2;
}
searchIn.onkeydown = (e) => {
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); pickFound(foundIx + (e.key === 'ArrowDown' ? 1 : -1)); }
  else if (e.key === 'Enter') { e.preventDefault(); openFound($('findList').querySelectorAll('.fl-row')[Math.max(0, foundIx)]); }
  else if (e.key === 'Escape') { e.preventDefault(); searchIn.value = ''; endSearch(); searchIn.blur(); focusActive(); }
};
$('findList').onclick = (e) => openFound(e.target.closest('.fl-row'));

const cdTo = (path) => {
  const cwd = active()?.cwd || '';
  send(`cd ${q(path.startsWith(cwd + '/') ? path.slice(cwd.length + 1) : path)}`, '', true); // relative reads better
  dt.track('folder_opened', { via: 'sidebar' });
};
// The row under a mouse event: Trees draws its rows in a shadow root, each with data-item-path.
const rowAt = (e) => e.composedPath().find((n) => n.dataset?.itemPath != null);
$('entries').addEventListener('click', (e) => { // a folder opens and closes by itself (Trees)
  const row = rowAt(e);
  if (row?.dataset.itemType === 'file') showFile(absOf(row.dataset.itemPath));
});
$('entries').addEventListener('keydown', (e) => { // Return on a file previews it, like a click
  const id = tree.getFocusedPath();
  if (e.key === 'Enter' && id && !id.endsWith('/')) showFile(absOf(id));
});
// Right-click: everything else you can do with it (main.js entry:menu draws the Mac menu).
$('entries').oncontextmenu = async (e) => {
  const row = rowAt(e); if (!row) return;
  e.preventDefault();
  const path = absOf(row.dataset.itemPath), folder = row.dataset.itemType === 'folder', ed = await dt.editor();
  const pick = await dt.entryMenu({ folder, editor: ed?.label });
  ({
    cd: () => cdTo(path),
    preview: () => showFile(path),
    default: () => dt.openDefault(path),
    editor: () => dt.openIn(path),
    reveal: () => dt.reveal(path),
    copy: () => dt.clipWrite(path),
    type: () => { const p = activeTerm(); if (p) { dt.write(p.id, Preview.dropText([path])); p.term.focus(); } },
  })[pick]?.();
};
$('collapseAll').onclick = () => { for (const p of expanded) tree.getItem(relOf(p) + '/')?.collapse(); expanded.clear(); };
// + : name a new file, and Fork types `touch` for it in the folder you're in (so you see how it's done).
$('newFile').onclick = () => {
  if (!active()?.cwd || $('newEntry').firstChild) return;
  const row = document.createElement('div');
  row.className = 'entry new';
  row.innerHTML = `${ph('file')}<input placeholder="New file name" aria-label="New file name" spellcheck="false">`;
  $('newEntry').append(row);
  const input = row.querySelector('input');
  input.focus();
  let over = false;
  const done = (make) => {
    if (over) return;
    over = true;
    const name = input.value.trim();
    row.remove();
    if (make && name && !name.includes('/')) send(`touch ${q(name)}`, '', true);
    refresh();
  };
  input.onkeydown = (e) => { e.stopPropagation(); if (e.key === 'Enter') done(true); if (e.key === 'Escape') done(false); };
  input.onblur = () => done(false);
};
// Drag a row onto a terminal to type its path (Trees starts the drag; it never moves anything, canDrop above).
$('entries').addEventListener('dragstart', (e) => {
  const row = rowAt(e); if (!row) return;
  e.dataTransfer.setData('text/x-dt-path', absOf(row.dataset.itemPath));
  e.dataTransfer.effectAllowed = 'copy';
});
// Something changed on disk (usually Claude at work): update the tree, and the file being previewed.
dt.onFsChanged((paths) => {
  refresh();
  gitSoon(tab());
  if (pv.file && paths.includes(pv.file)) openFile(pv.file, true);
});
// A file dropped anywhere but a pane does nothing (instead of Chromium trying to open it).
document.addEventListener('dragover', (e) => { if (!e.defaultPrevented) { e.preventDefault(); e.dataTransfer.dropEffect = 'none'; } });
document.addEventListener('drop', (e) => e.preventDefault());
$('chips').onclick = (e) => { const b = e.target.closest('.chip'); if (b) { const s = chips[b.dataset.i]; send(s.cmd, s.why, s.run); } };
$('stop').onclick = () => { const p = activeTerm(); if (agentOf(p)) { dt.write(p.id, '\x1b'); p.term.focus(); } else send('\x03'); };

// --- Preview panel: a file or the running app, next to the terminal ---------------------
// Read-only on purpose: this isn't a code editor. Real edits go to the person's editor.
const pv = { mode: 'file', file: null, url: null };
const pvOpen = () => $('app').classList.contains('has-pv');
const shownFile = () => (pvOpen() ? pv.file : null);
const dirOf = (p) => p.slice(0, p.lastIndexOf('/')) || '/';
const fileUrl = (p) => 'file://' + p.split('/').map(encodeURIComponent).join('/');
const bytes = (n) => (n < 1024 ? `${n} B` : n < 1048576 ? `${Math.round(n / 1024)} KB` : `${(n / 1048576).toFixed(1)} MB`);
const web = $('pvApp');

function showPv(mode) {
  if (mode) pv.mode = mode;
  $('pv').dataset.mode = pv.mode;
  for (const b of $('pvSeg').children) b.classList.toggle('on', b.dataset.v === pv.mode);
  $('app').classList.add('has-pv');
  markShown();
  syncPvFolder();
}
function hidePv() { $('app').classList.remove('has-pv'); markShown(); syncPvFolder(); focusActive(); }
// Changes and Design are the open workspace's: follow it while they're on screen. Design reads only then.
function syncPvFolder() {
  const on = pvOpen() && !$('app').classList.contains('in-settings'), dir = tab() && dirOfTab(tab()) !== home ? dirOfTab(tab()) : null;
  if (on && pv.mode === 'changes') {
    Changes.show(dir);
    $('pvSeg').querySelector('[data-v="changes"]').classList.remove('new');
    $('pvToggle').classList.remove('new');
  }
  if (on && pv.mode === 'design') Design.start(dir); else Design.stop();
}
function togglePv() { pvOpen() ? hidePv() : showPv(); dt.track('preview_toggled'); }
function markShown() { // the previewed file is the tree's selected row
  const f = shownFile(), id = f?.startsWith(treeRoot + '/') ? relOf(f) : null;
  for (const p of tree.getSelectedPaths()) if (p !== id) tree.getItem(p)?.deselect();
  if (id) tree.getItem(id)?.select();
}
function syncWatch() { dt.watch([...new Set([...treeDirs, ...(pv.file ? [dirOf(pv.file)] : [])])]); }

// Code: @pierre/diffs (vendor/diffs, loaded the first time a file needs it). Shiki's VS Code grammars, Pierre's
// themes, its own line numbers. Click a line number (shift-click for a range) and "Put in terminal" types
// file:line, so "line 42" is easy to tell Claude.
let diffsLib, codeFile, picked = null;
const codeTheme = () => (document.documentElement.dataset.mode === 'light' ? 'light' : 'dark');
async function showCode(view, path, r) {
  const D = await (diffsLib ??= import('./vendor/diffs/diffs.js'));
  if (pv.file !== path) return false; // another file was clicked while it loaded
  codeFile?.cleanUp();
  view.innerHTML = '<div class="pv-code"></div>';
  pickLines(null);
  // Colouring happens in workers (vendor/diffs/worker.js): the plain text shows at once, colours follow.
  const pool = D.getOrCreateWorkerPoolSingleton({
    poolOptions: { workerFactory: () => new Worker('vendor/diffs/worker.js', { type: 'module' }), poolSize: 2 },
    highlighterOptions: { theme: { dark: 'pierre-dark', light: 'pierre-light' } } });
  codeFile = new D.File({ themeType: codeTheme(), disableFileHeader: true, tokenizeMaxLength: 1024 * 1024, // files.mjs MAX
    enableLineSelection: true, onLineSelected: pickLines,
    unsafeCSS: ':host { --diffs-dark-bg: var(--card); --diffs-light-bg: var(--card); }' }, pool); // the panel's colour, not Pierre's black
  codeFile.render({ file: { name: path.split('/').pop(), contents: r.text, lang: r.lang }, containerWrapper: view.firstChild });
  return true;
}
function pickLines(range) {
  picked = range && pv.file ? { path: pv.file, a: Math.min(range.start, range.end), b: Math.max(range.start, range.end) } : null;
  $('pvLine').hidden = !picked;
  if (picked) $('pvLine').textContent = `Put ${pv.file.split('/').pop()}:${picked.a}${picked.b > picked.a ? '-' + picked.b : ''} in terminal`;
}
$('pvLine').onclick = () => {
  const p = activeTerm(); if (!p || !picked) return;
  const rel = picked.path.startsWith(p.cwd + '/') ? picked.path.slice(p.cwd.length + 1) : picked.path; // relative reads better
  dt.write(p.id, Preview.dropText([rel]).trimEnd() + `:${picked.a}${picked.b > picked.a ? '-' + picked.b : ''} `);
  p.term.focus();
};

async function openFile(path, changed) {
  if (Reader.kindOf(path)) return openBook(path, 'tree'); // a PDF or EPUB opens in Read
  const view = $('pvFile'), top = changed ? view.scrollTop : 0; // a file Claude just edited keeps its scroll
  const firstTime = pv.file !== path;
  if (firstTime) dt.track('file_previewed', { kind: fileIcon(path.split('/').pop()).icon, where: 'fork' }); // the type, never the name
  pv.file = path;
  showPv('file');
  if (firstTime) syncWatch();
  const r = await dt.preview(path);
  if (pv.file !== path) return; // another file was clicked meanwhile
  $('pvName').innerHTML = `${fileIconHtml(path.split('/').pop())}${esc(path.split('/').pop())}<small id="pvMeta">${r.size != null ? bytes(r.size) : ''}</small>`;
  $('pvName').title = path;
  $('pvPage').style.display = r.kind === 'html' ? '' : 'none';
  const src = fileUrl(path) + (changed ? `?v=${Date.now()}` : ''); // skip the image cache after an edit
  if (r.kind === 'code' || r.kind === 'html') {
    if (await showCode(view, path, r)) view.scrollTop = top;
    return;
  }
  codeFile?.cleanUp(); codeFile = null; pickLines(null);
  view.innerHTML = {
    image: () => `<div class="pv-media"><img src="${src}" alt=""></div>`,
    video: () => `<div class="pv-media"><video src="${src}" controls loop></video></div>`,
    markdown: () => `<article class="pv-md">${DOMPurify.sanitize(r.html)}</article>`,
    other: () => `<div class="pv-msg"><b>${r.why === 'big' ? 'Too big to preview' : "Can't preview this kind of file"}</b>Open it with the button above.</div>`,
    missing: () => '<div class="pv-msg"><b>This file is gone</b>It was moved, renamed or deleted.</div>',
  }[r.kind]();
  const img = view.querySelector('.pv-media img');
  if (img) img.onload = () => { $('pvMeta').textContent = `${img.naturalWidth} × ${img.naturalHeight} · ${bytes(r.size)}`; };
  for (const i of view.querySelectorAll('.pv-md img')) { // README images are relative to the README
    const s = i.getAttribute('src');
    if (s && !/^(https?|data|file):/.test(s)) i.src = new URL(s, fileUrl(path)).href;
  }
  view.scrollTop = top;
}

// Links in a Markdown preview: websites open in the browser, other files open here. Never navigate the app.
$('pvFile').onclick = (e) => {
  const a = e.target.closest('a[href]'); if (!a) return;
  e.preventDefault();
  const href = a.getAttribute('href');
  if (/^https?:/.test(href)) return dt.openExternal(href);
  if (/^[a-z]+:|^#/i.test(href)) return; // mailto:, in-page anchors
  openFile(decodeURIComponent(new URL(href, fileUrl(pv.file)).pathname));
};

dt.editor().then((ed) => { $('pvOpen').textContent = ed ? `Open in ${ed.label}` : 'Open'; });
$('pvOpen').onclick = () => pv.file && dt.openIn(pv.file);
$('pvReveal').onclick = () => pv.file && dt.reveal(pv.file);
$('pvPage').onclick = () => pv.file && loadApp(fileUrl(pv.file));
$('pvClose').onclick = hidePv;
$('pvToggle').onclick = togglePv;
$('pvSeg').onclick = (e) => {
  const b = e.target.closest('button'); if (!b) return;
  showPv(b.dataset.v);
  if (b.dataset.v === 'read' && !Reader.current() && books.recent[0]) openBook(books.recent[0].path, 'recent', true); // back where you left off
};
$('pvGrip').onpointerdown = (e) => drag(e, (x) => $('app').style.setProperty('--pv', `${innerWidth - x}px`));

// The running app. A <webview> is plain DOM, so ⌘K and the start screen still sit above it.
function appMsg(html) { $('pvAppMsg').innerHTML = html; $('pvAppMsg').classList.toggle('show', !!html); }
appMsg('<div><b style="color:var(--text)">No app yet</b><br>Start your app in the terminal (like <code>npm run dev</code>).<br>Its address shows in Workspace info: click it to see it here.<br>Or type an address above.</div>');

function loadApp(url) {
  pv.url = url;
  showPv('app');
  appMsg('');
  web.classList.remove('blank');
  web.src = url;
  $('pvUrl').value = url;
}
function syncNav(url) {
  pv.url = url;
  if (document.activeElement !== $('pvUrl')) $('pvUrl').value = url;
  try { $('pvBack').disabled = !web.canGoBack(); $('pvFwd').disabled = !web.canGoForward(); } catch {} // not attached yet
}
web.addEventListener('did-navigate', (e) => syncNav(e.url));
web.addEventListener('did-navigate-in-page', (e) => e.isMainFrame && syncNav(e.url));
web.addEventListener('did-start-loading', () => appMsg(''));
web.addEventListener('did-fail-load', (e) => {
  if (!e.isMainFrame || e.errorCode === -3) return; // -3: replaced by a newer navigation
  appMsg(`<div><b style="color:var(--text)">Nothing is showing at ${esc(e.validatedURL.replace(/^https?:\/\//, ''))}</b><br>
    Is the app still running? Start it in the terminal, then<br><br><button class="go" id="pvRetry">Try again</button></div>`);
});
$('pvAppMsg').onclick = (e) => { if (e.target.id === 'pvRetry') loadApp(pv.url); };
$('pvBack').onclick = () => web.goBack();
$('pvFwd').onclick = () => web.goForward();
$('pvReload').onclick = () => (pv.url ? loadApp(pv.url) : null);
$('pvBrowser').onclick = () => pv.url && dt.openExternal(pv.url);
$('pvUrl').onkeydown = (e) => {
  if (e.key !== 'Enter') return;
  let u = $('pvUrl').value.trim();
  if (!u) return;
  if (!/^[a-z]+:\/\//i.test(u)) u = (/^\d+$/.test(u) ? 'http://localhost:' : 'http://') + u; // "3000" is enough
  loadApp(u);
};

// A dev server printed its address: its workspace shows it in Workspace info (click to see it), until the
// command stops. Already looking at the app? Just follow it, once per address.
const offered = new Set();
function appFound(url, pane) {
  if (pane && pane.url !== url) { pane.url = url; renderTabs(); }
  if (offered.has(url) || url === pv.url) return;
  offered.add(url);
  if (inFork() && pvOpen() && pv.mode === 'app') loadApp(url);
}
// Your app: in the side panel, or in the browser when Settings → Links & files says so.
function openApp(url) {
  inFork() ? loadApp(url) : dt.openExternal(url);
  dt.track('app_preview_shown', { where: inFork() ? 'fork' : 'browser' });
}
// Settings → Links & files. On: your app, localhost links and files open in Fork's side panel.
// Off: they open in the browser and in the Mac's own apps. Outside websites always go to the browser.
function inFork() { return settings.inFork !== 'off'; }
// Where a link from the terminal goes: your own app to the side panel (when that's on), the web to the browser.
function openLink(uri) {
  const local = Preview.findLocalUrl(uri);
  if (local && inFork()) return loadApp(local);
  dt.openExternal(uri);
}
// A link an app marked itself (OSC 8): a web page, or a file on this Mac (file://…).
function openUri(uri) {
  if (/^https?:\/\//i.test(uri)) return openLink(uri);
  const m = uri.match(/^file:\/\/[^/]*(\/[^?#]*)/);
  if (!m) return;
  let path = m[1];
  try { path = decodeURIComponent(path); } catch {}
  inFork() ? openFile(path) : dt.openDefault(path);
}
const linkTip = (uri) => (/^file:/i.test(uri) ? (inFork() ? '⌘-click to show it next to the terminal' : '⌘-click to open it')
  : Preview.findLocalUrl(uri) && inFork() ? '⌘-click to show it next to the terminal' : '⌘-click to open in your browser');

// --- Read: a book next to the terminal, for while Claude works (reader.js) -----------------
// Your place in every book, and Pages or Scroll. Saved in localStorage like the settings.
const books = (() => {
  let b; try { b = JSON.parse(localStorage.getItem('dt-books')); } catch {}
  return { mode: b?.mode === 'scroll' ? 'scroll' : 'pages', recent: Array.isArray(b?.recent) ? b.recent.filter((x) => typeof x?.path === 'string') : [] };
})();
let booksTimer;
const saveBooks = () => { clearTimeout(booksTimer); booksTimer = setTimeout(() => { try { localStorage.setItem('dt-books', JSON.stringify(books)); } catch {} }, 300); };
const bookName = (path) => path.split('/').pop().replace(/\.(pdf|epub)$/i, '');

function readHead(title, label) {
  $('rdName').innerHTML = title ? `<span>${esc(title)}</span><small>${esc(label || '')}</small>` : ''; // the title shortens, never the page
  $('rdName').title = Reader.current()?.path || '';
}
function shelf(note = '') {
  $('rdNote').textContent = note;
  $('rdList').innerHTML = books.recent.length ? '<small>Recent</small>' + books.recent.slice(0, 5).map((b, i) =>
    `<button data-i="${i}" title="${esc(b.path)}">${icon(b.kind === 'epub' ? 'book-open' : 'file-text')}<span>${esc(b.title || bookName(b.path))}</span>` +
    `<em>${Reader.logic.percent(b.progress)}</em></button>`).join('') : '';
  readHead('', '');
}
function syncReadMode() { for (const b of $('rdMode').children) b.classList.toggle('on', b.dataset.v === books.mode); }

// via: tree | picker | recent | drop. quiet: reopening the last book by itself, so a missing one just shows the shelf.
async function openBook(path, via, quiet) {
  showPv('read');
  $('pvRead').focus();
  if (Reader.current()?.path === path) return;
  const saved = books.recent.find((b) => b.path === path);
  const r = await dt.readBook(path);
  if (r.error) {
    Reader.close();
    return shelf(quiet ? '' : { missing: `Couldn't find “${bookName(path)}”. It was moved or deleted.`, big: 'That book is too big to open here.' }[r.error] || '');
  }
  const kind = Reader.kindOf(path);
  readHead(saved?.title || bookName(path), 'Opening…');
  try {
    const shown = await Reader.open({ path, kind, bytes: r.bytes, where: saved?.where, progress: saved?.progress });
    if (!shown) return; // another book was opened meanwhile
    const title = shown.title || bookName(path);
    const now = books.recent.find((b) => b.path === path); // its place, as the first page showed it
    books.recent = Reader.logic.remember(books.recent, { path, kind, title, where: now?.where ?? saved?.where, progress: now?.progress ?? saved?.progress, at: Date.now() });
    saveBooks();
    readHead(title, $('rdName').querySelector('small')?.textContent.replace('Opening…', ''));
    dt.track('book_opened', { kind, via, mode: books.mode });
  } catch {
    shelf(`Couldn't open “${bookName(path)}”. It may be damaged, or locked to another app (DRM).`);
  }
}

Reader.setup({
  openExternal: dt.openExternal,
  onBack: () => backToTerminal(doneIn),
  onMove: (book, at) => { // a page turned: remember it
    const b = books.recent.find((x) => x.path === book.path);
    if (b) { b.where = at.where; b.progress = at.progress; saveBooks(); }
    readHead(b?.title || bookName(book.path), at.label);
  },
});
Reader.setMode(books.mode);
syncReadMode();
shelf();
$('rdMode').onclick = (e) => {
  const b = e.target.closest('button'); if (!b || b.dataset.v === books.mode) return;
  books.mode = b.dataset.v; saveBooks(); syncReadMode();
  Reader.setMode(books.mode);
  $('pvRead').focus();
};
$('rdPick').onclick = async () => { const path = await dt.pickBook(); if (path) openBook(path, 'picker'); };
$('rdShelf').onclick = () => { Reader.close(); shelf(); };
$('rdList').onclick = (e) => { const b = e.target.closest('button[data-i]'); if (b) openBook(books.recent[b.dataset.i].path, 'recent'); };
// Drop a book from Finder (or the sidebar) onto the panel.
const droppedBook = (e) => {
  const tree = e.dataTransfer.getData('text/x-dt-path');
  if (tree) return Reader.kindOf(tree) ? tree : null;
  const f = [...e.dataTransfer.files].find((x) => Reader.kindOf(x.name));
  return f ? dt.pathOf(f) : null;
};
$('pv').addEventListener('dragover', (e) => {
  const t = e.dataTransfer.types;
  if (t.includes('Files') || t.includes('text/x-dt-path')) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; }
});
$('pv').addEventListener('drop', (e) => { const path = droppedBook(e); if (path) { e.preventDefault(); openBook(path, 'drop'); } });
// Reading when Claude finishes? Say so above the book. Back in the terminal, the note goes.
const readingBook = () => pvOpen() && pv.mode === 'read' && !!Reader.current() && $('pv').contains(document.activeElement);
document.addEventListener('focusin', (e) => { if (!$('pv').contains(e.target)) Reader.clearDone(); });

// --- Before and after: each agent turn as pictures of your app (main.js turn:start/finish, changes.js) -----
// When an agent starts working, Fork pictures the app this workspace is serving (or the page the App view shows,
// if it's that app, or the only app there is); when it stops, it waits a moment for the change to land and
// pictures it again. main.js keeps the pair only if a frontend file changed and the page looks different.
// No app running, or Settings → General turned it off: no pictures.
function appUrlOf(t) {
  const own = panesOf(t).find((x) => x.url)?.url, shown = pv.url && Preview.findLocalUrl(pv.url) ? pv.url : null;
  const origin = (u) => { try { return new URL(u).origin; } catch { return null; } };
  return shown && (!own || origin(shown) === origin(own)) ? shown : own || null;
}
async function turnStarted(pane) {
  const t = tabOf(pane.id), dir = dirOfTab(t), url = t && appUrlOf(t);
  if (settings.shots === 'off' || !url || !dir || dir === home || pane.turn) return;
  const turn = pane.turn = { dir, url, at: Date.now(), agent: agentOf(pane)?.name || '' };
  const r = await dt.turnStart(dir, url);
  if (!r) { if (pane.turn === turn) pane.turn = null; return; } // the app didn't load
  Object.assign(turn, r);
  if (turn.ended) turnEnded(pane, turn); // it finished while the before was being taken
}
function turnEnded(pane, turn = pane.turn) {
  if (!turn) return;
  if (pane.turn === turn) pane.turn = null;
  if (!turn.before) { turn.ended = true; return; }
  setTimeout(async () => { // hot reload and any build step get a moment to catch up
    const r = await dt.turnFinish(turn.dir, { before: turn.before, snap: turn.snap, url: turn.url, at: turn.at, agent: turn.agent });
    if (!r) return;
    dt.track('changes_captured', { files: r.turn.files.length });
    const shown = Changes.added(turn.dir, r) && pvOpen() && pv.mode === 'changes';
    if (!shown && turn.dir === dirOfTab(tab())) {
      $('pvSeg').querySelector('[data-v="changes"]').classList.add('new');
      $('pvToggle').classList.add('new');
    }
  }, 1500);
}
Changes.setup({
  openIcon: icon('external-link'),
  fileIcon: (name) => fileIconHtml(name.split('/').pop()),
  openFile: (rel) => showFile(join(Changes.folder(), rel)),
  openApp,
});
Design.setup({
  copy: (text) => dt.clipWrite(text),
  type: (text) => { const p = activeTerm(); if (p) { dt.write(p.id, text + ' '); p.term.focus(); } },
  openAt: async (file, line) => { const path = join(Design.folder(), file); await openFile(path); if (line) showLine(path, line); },
});

// --- When something fails ------------------------------------------------------
let fix = null;
function showOops() {
  $('oopsText').textContent = "That didn't work.";
  $('explainBtn').style.display = ''; $('fixBtn').style.display = 'none'; $('askAiBtn').style.display = 'none';
  $('oops').classList.add('show');
}
function hideOops() { $('oops').classList.remove('show'); }
// The failed command and what it printed: from its prompt line (at most 80 lines), or the last 40 lines.
function lastLines() {
  const p = activeTerm(), b = p.term.buffer.active, end = b.baseY + b.cursorY, out = [];
  const from = p.cmdMark && !p.cmdMark.isDisposed && p.cmdMark.line > 0 ? Math.max(p.cmdMark.line - 1, end - 80) : end - 40;
  for (let i = Math.max(0, from); i <= end; i++) out.push(b.getLine(i)?.translateToString(true) ?? '');
  return out.join('\n').trim();
}
// "What went wrong?": Fork's own library first (errors.mjs), instantly. Anything it doesn't know, Claude can look at.
let failed = null; // { output, cwd } of the command being explained
function explained({ text, fix: f }, ask) {
  $('oopsText').textContent = text;
  fix = f;
  $('fixBtn').style.display = fix ? '' : 'none';
  $('askAiBtn').textContent = ask === 'maybe' ? 'Not it? Ask AI' : 'Ask AI';
  $('askAiBtn').classList.toggle('quiet', ask === 'maybe');
  $('askAiBtn').style.display = ask ? '' : 'none';
}
$('explainBtn').onclick = async () => {
  $('explainBtn').style.display = 'none';
  dt.aiWarm(); // in case it comes to Ask AI
  failed = { output: lastLines(), cwd: active()?.cwd };
  // Fork's library first; if it doesn't know the error and Smarter matching is on, Jev picks the closest one Fork does know.
  const r = await dt.explain(failed.output, failed.cwd, settings.smart !== 'off');
  if (r) explained(r, 'maybe');
  else explained({ text: "This one's unusual. Want AI to take a look?", fix: null }, 'yes');
  dt.track('error_explained', r ? { source: r.source, id: r.id } : { source: 'unknown' }); // id is from Fork's list, never the error
};
$('askAiBtn').onclick = async () => {
  $('askAiBtn').style.display = 'none'; $('fixBtn').style.display = 'none';
  $('oopsText').textContent = 'Reading the error…';
  const r = await dt.explainAI(failed.output, failed.cwd);
  explained(r, null);
  dt.track('error_explained', { source: 'ai', ok: !r.failed });
};
$('fixBtn').onclick = () => { hideOops(); send(fix, 'Suggested fix. Read it, then press Enter.', false); dt.track('fix_used'); };
$('oopsClose').onclick = hideOops;

// --- ⌘F: find in the active pane (SearchAddon) -----------------------------------------------
// Every match is tinted with the theme's accent; the current one is also outlined in the text colour.
let findPane = null;
const findOpen = () => $('find').classList.contains('show');
const hex6 = (c) => (/^#[0-9a-f]{6}$/i.test(c) ? c : '#f8f8f7');
const mix = (a, b, t) => '#' + [1, 3, 5].map((i) => Math.round(parseInt(hex6(a).slice(i, i + 2), 16) * (1 - t)
  + parseInt(hex6(b).slice(i, i + 2), 16) * t).toString(16).padStart(2, '0')).join('');
function findLooks() {
  const t = currentTheme(settings);
  return { matchBackground: mix(t.background, t.accent, 0.35), activeMatchBackground: mix(t.background, t.accent, 0.35),
    activeMatchBorder: hex6(t.foreground),
    matchOverviewRuler: mix(t.background, t.accent, 0.6), activeMatchColorOverviewRuler: hex6(t.accent) };
}
function showCount(i, n) {
  $('find').classList.toggle('none', !n);
  $('findCount').textContent = !$('findIn').value ? '' : !n ? 'No results' : i < 0 ? `${n} found` : `${i + 1} of ${n}`;
}
// how: 'type' keeps the current match while it still fits, 'next' / 'prev' move along.
function find(how = 'type') {
  const p = activeTerm(), text = $('findIn').value;
  if (findPane && findPane !== p) findPane.search.clearDecorations();
  findPane = p;
  if (!p) return;
  if (!text) { p.search.clearDecorations(); p.term.clearSelection(); showCount(-1, 0); return; }
  const opts = { decorations: findLooks(), incremental: how === 'type' };
  how === 'prev' ? p.search.findPrevious(text, opts) : p.search.findNext(text, opts);
}
function openFind() {
  if (inSettings()) return;
  $('find').classList.add('show');
  $('findIn').focus();
  $('findIn').select();
  if ($('findIn').value) find();
  dt.track('find_opened');
}
function closeFind() {
  $('find').classList.remove('show');
  findPane?.search.clearDecorations();
  findPane?.term.clearSelection();
  findPane = null;
  focusActive();
}
$('findIn').oninput = () => find();
$('findIn').onkeydown = (e) => {
  if (e.key === 'Enter') { e.preventDefault(); find(e.shiftKey ? 'prev' : 'next'); }
  if (e.key === 'Escape') { e.stopPropagation(); closeFind(); }
};
$('findNext').onclick = () => find('next');
$('findPrev').onclick = () => find('prev');
$('findClose').onclick = closeFind;

// --- Reopen the way you left it (session.mjs, main.js) ----------------------------------------
// This window's tabs, splits and folders go to main about a second after they change. At quit main
// asks for everything, including what's on screen. Closing the last tab forgets the window instead.
let saveTimer, restoring = false, forgotten = false;
function snapshot(full) {
  const node = (n) => {
    if (n.dir) return { dir: n.dir, ratio: n.ratio ?? 0.5, a: node(n.a), b: node(n.b) };
    const p = panes.get(n.id), s = { cwd: p?.cwd || '' };
    if (p?.name) s.name = p.name;
    if (p?.named) s.named = true;
    if (p?.task) s.task = p.task;
    if (isClaude(p)) s.claude = true;
    if (full && p) try { s.screen = p.serial.serialize({ scrollback: 1000 }); } catch {}
    return s;
  };
  const width = parseInt($('app').style.getPropertyValue('--side'), 10);
  // The game pane isn't saved: next time it's just your terminals (a tab that only held the game is left out).
  const kept = tabs.map((t) => ({ t, root: Panes.leaves(t.root).filter((id) => isGame(panes.get(id))).reduce((r, id) => r && Panes.remove(r, id), t.root) }))
    .filter(({ root }) => root);
  return {
    tabIx: Math.max(0, kept.findIndex(({ t }) => t === tab())),
    side: { hidden: $('app').classList.contains('no-side'), ...(width ? { width } : {}) },
    tabs: kept.map(({ t, root }) => ({ root: node(root), active: Math.max(0, Panes.leaves(root).indexOf(t.activeId)), color: t.color, dir: t.dir, ...(t.name ? { name: t.name } : {}) })),
  };
}
function saveSoon() {
  if (restoring || forgotten || !tabs.length) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => dt.sessionSave(snapshot(false)), 1000);
}
dt.onSessionCollect(() => { clearTimeout(saveTimer); return forgotten ? null : snapshot(true); });
async function forgetAndClose() {
  forgotten = true;
  clearTimeout(saveTimer);
  await dt.sessionForget();
  window.close();
}
const restoredAt = (t) => {
  const d = new Date(t || Date.now()), time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return d.toDateString() === new Date().toDateString() ? time
    : `${d.toLocaleDateString([], { month: 'short', day: 'numeric' })}, ${time}`;
};
// Rebuild each tab's split tree with fresh shells in the saved folders. Claude picks up where it was.
async function restore(saved) {
  restoring = true;
  for (const t of saved.tabs) {
    const ids = [];
    const build = async (n) => {
      if (n.dir) return { dir: n.dir, ratio: n.ratio, a: await build(n.a), b: await build(n.b) };
      const p = await newPane(n.cwd, { screen: n.screen, when: saved.savedAt });
      if (n.claude) { dt.write(p.id, 'claude --continue\r'); p.suggested = true; } // zsh holds it until the prompt is up
      if (n.task) p.task = n.task;
      // saved before terminals had auto names: a name that isn't "Terminal N" is one you typed
      if (n.name) nameTerminal(p, null, n.name, n.named ?? !/^Terminal \d+$/.test(n.name));
      ids.push(p.id);
      return { id: p.id };
    };
    const root = await build(t.root);
    const tb = { root, activeId: ids[t.active] ?? ids[0], color: t.color ?? nextColor(),
      dir: t.dir || panes.get(ids[t.active] ?? ids[0])?.cwd }; // saved before workspaces had a folder: where its terminal was
    if (t.name) tb.name = t.name;
    tabs.push(tb);
    for (const id of ids) if (!panes.get(id).name) nameTerminal(panes.get(id), tb); // saved before terminals had names
  }
  if (saved.side.hidden) $('app').classList.add('no-side');
  if (saved.side.width) $('app').style.setProperty('--side', `${saved.side.width}px`);
  restoring = false;
  const t = tabs[saved.tabIx] || tabs[0], id = t.activeId;
  t.activeId = null; // force a redraw
  focusPane(id);
  dt.track('session_restored', { tabs: tabs.length, panes: panes.size });
}

// --- The workspace picker: every workspace is a folder ------------------------------------
// A recent one, your home folder, a new folder (made right here), any folder on your Mac, or a project from
// GitHub. With no workspace open it can't be closed: a window always has a folder to work in.
let pickRequired = false, newParent = '';
const tilde = (p) => (home && (p === home || p.startsWith(home + '/')) ? '~' + p.slice(home.length) : p);
const parentOf = (p) => p.slice(0, p.lastIndexOf('/')) || '/';
const whereLabel = (p) => `in ${p === home ? 'your home folder' : tilde(p)}`;
async function openPicker({ required = !tabs.length } = {}) {
  pickRequired = required;
  home ||= await dt.home();
  const list = (await dt.recents()).slice(0, 5);
  const row = (path, label, choice) => `<button class="opt" data-path="${esc(path)}" data-choice="${choice}"><span class="ico">${icon('folder')}</span>`
    + `<span>${esc(label)}<small>${esc(tilde(path))}</small></span></button>`;
  $('recents').innerHTML = (list.length ? '<div class="label" style="margin-top:0">Recent</div>' : '')
    + list.map((p) => row(p, p === home ? 'Home' : p.split('/').pop() || '/', 'recent')).join('')
    + (list.includes(home) ? '' : row(home, 'Home', 'home'));
  try { newParent = localStorage.getItem('dt-new-parent') || ''; } catch {}
  newParent ||= list[0] && list[0] !== home ? parentOf(list[0]) : home;
  $('startTitle').textContent = tabs.length ? 'New workspace' : 'Where do you want to work?';
  $('skip').hidden = required;
  for (const id of ['newFolder', 'clone']) $(id).classList.remove('show');
  $('newFolderName').value = ''; $('cloneUrl').value = ''; $('newFolderErr').hidden = true;
  $('usageNote').hidden = !(await dt.analytics());
  $('startOv').classList.add('show');
}
const openStart = () => openPicker(); // after the welcome cards
function closeStart() {
  if (pickRequired && !tabs.length) return; // nothing to go back to
  pickRequired = false;
  $('startOv').classList.remove('show');
  focusActive();
  if (tourNext) { tourNext = false; setTimeout(runTour, 400); } // after the folder list and suggestions load
}
// The last workspace closed: an empty window that asks where to work next.
function noWorkspace() {
  tabIx = 0;
  $('term').replaceChildren();
  treeRoot = ''; treePaths = new Set(); tree.resetPaths([]);
  renderTabs();
  openPicker({ required: true });
}
// Open dir as a workspace (or switch to it, if it's one already), then close the picker.
async function openWorkspace(dir, { choice, start, run } = {}) {
  dt.track('start_choice', { choice });
  dt.recents(dir);
  const same = start ? -1 : tabs.findIndex((t) => t.dir === dir);
  if (same >= 0) goTab(same);
  else {
    if (tabs.length) dt.track('tab_opened');
    const p = await newTab(dir, { start });
    run?.(p);
  }
  closeStart();
}

$('recents').onclick = (e) => { const b = e.target.closest('.opt'); if (b) openWorkspace(b.dataset.path, { choice: b.dataset.choice }); };
$('pick').onclick = async () => { const p = await dt.pickFolder(); if (p) openWorkspace(p, { choice: 'pick' }); };
// New folder: a name, and where it goes (the last place you made one, or next to your latest workspace).
$('newFolderOpt').onclick = () => {
  $('clone').classList.remove('show');
  $('newFolder').classList.add('show');
  $('newFolderWhere').textContent = whereLabel(newParent);
  $('newFolderName').focus();
};
$('newFolderWhere').onclick = async () => {
  const p = await dt.pickFolder();
  if (p) { newParent = p; $('newFolderWhere').textContent = whereLabel(p); }
  $('newFolderName').focus();
};
const FOLDER_ERRORS = { name: 'Give it a name, without a / in it.', 'exists-file': 'There’s already a file with that name there.',
  failed: 'Couldn’t make a folder there. Try another place.' };
$('newFolderGo').onclick = async () => {
  const r = await dt.makeFolder(newParent, $('newFolderName').value);
  if (r.error) { $('newFolderErr').textContent = FOLDER_ERRORS[r.error]; $('newFolderErr').hidden = false; return; }
  try { localStorage.setItem('dt-new-parent', newParent); } catch {}
  openWorkspace(r.path, { choice: 'new_folder' });
};
$('newFolderName').onkeydown = (e) => { if (e.key === 'Enter') $('newFolderGo').click(); };
$('newFolderName').oninput = () => { $('newFolderErr').hidden = true; };
$('cloneOpt').onclick = () => { $('newFolder').classList.remove('show'); $('clone').classList.add('show'); $('cloneUrl').focus(); };
// A project from GitHub: the workspace is the folder it downloads into; its terminal fetches it there.
$('cloneGo').onclick = async () => {
  const url = $('cloneUrl').value.trim();
  if (!url) return;
  const dest = await dt.pickFolder(); // where should the project live?
  if (!dest) return;
  const name = url.replace(/\/+$/, '').split('/').pop().replace(/\.git$/, '');
  openWorkspace(`${dest === '/' ? '' : dest}/${name}`, { choice: 'clone', start: dest, run: () =>
    send(`git clone ${q(url)} && cd ${q(name)}`, `Downloads ${name} into ${dest.split('/').pop()}, then moves into it.`, false) });
};
$('cloneUrl').onkeydown = (e) => { if (e.key === 'Enter') $('cloneGo').click(); };
$('skip').onclick = () => closeStart();

// --- First run: welcome cards, then once they've picked where to work, the spotlight tour ---------
// (onboarding.js). Skipping the cards skips the tour too. Settings → Help and the Help menu replay it.
let tourNext = false;
const firstRun = (() => { try { return !localStorage.getItem('dt-onboarded'); } catch { return false; } })();
async function runWelcome() {
  try { localStorage.setItem('dt-onboarded', '1'); } catch {}
  const r = await Onboarding.welcome();
  dt.track(r.done ? 'welcome_done' : 'welcome_skipped', r.done ? {} : { card: r.card });
  tourNext = r.done;
  openStart();
}
async function runTour() {
  $('app').classList.remove('no-side'); // everything the tour points at must be on screen
  closeSettings(); closePal();
  const r = await Onboarding.tour();
  dt.track(r.done ? 'tour_done' : 'tour_skipped', { step: r.step, of: r.of });
  focusActive();
}
function replayTour() {
  if ($('welcomeOv').classList.contains('show') || document.querySelector('.tour')) return; // already running
  dt.track('tour_replayed');
  closeSettings(); closePal(); closeStart();
  runWelcome();
}
$('replayTour').onclick = replayTour;

// --- ⌘K: every command, by what it does -----------------------------------------------
let palette = [], shown = [], sel = 0;
const GAMES = [
  { label: 'Play a game', cmd: 'Snake, Stack, Space Run', game: '' },
  { label: 'Play Snake', cmd: 'Game', game: 'snake' },
  { label: 'Play Stack', cmd: 'Game · falling blocks', game: 'stack' },
  { label: 'Play Space Run', cmd: 'Game · shoot-em-up', game: 'space' },
];
dt.palette().then((p) => { palette = [...p, ...GAMES]; });

// The answer shows in ⌘K itself: what it does, the command, and Run. Commands that need a name get a field
// in the card first. Enter runs it for real (the card is the "are you sure?"), so nothing is left
// half-typed in the terminal. Fork's own list answers first; only when it has nothing does Ask AI appear.
let ver = 0, vals = [], opened = false; // ver: which typing an answer belongs to; opened: a row was clicked with nothing typed
const palText = () => $('palIn').value.trim();
function palSay(text) { $('palStatus').textContent = text; $('palStatus').classList.toggle('show', !!text); }
function openPal() { $('palIn').value = ''; renderPal(); $('palOv').classList.add('show'); $('palIn').focus(); dt.aiWarm(); dt.track('palette_opened'); }
function closePal() { ver++; $('palOv').classList.remove('show'); focusActive(); }
function renderPal() {
  ver++; opened = false;
  const text = palText().toLowerCase(), words = text.split(/\s+/).filter(Boolean);
  shown = palette.filter((p) => words.every((w) => (p.label + ' ' + p.cmd).toLowerCase().includes(w)));
  const byName = (p) => words.every((w) => p.label.toLowerCase().includes(w)); // "play snake": Play Snake before Play a game
  shown.sort((a, b) => byName(b) - byName(a));
  sel = 0; vals = [];
  palSay('');
  const smart = settings.smart !== 'off';
  if (text && !shown.length) smart ? palSay('Looking…') : (shown = [askRow()]);
  drawPal();
  if (text && smart && (words.length > 1 || !shown.length)) bestMatch(text, ver); // plain words, or nothing by name: ask Jev
}
const askRow = () => ({ ask: true, label: `Ask AI: “${palText()}”`, cmd: 'AI' });
const needs = (p) => p.fill?.length > 0;
// A typed name, shell-quoted. ~/ stays unquoted so it still means the home folder.
const arg = (v, wrap = '') => (v = wrap + v.trim() + wrap, v.startsWith('~/') ? '~/' + q(v.slice(2)) : q(v));
const filled = (p) => p.cmd.replace(/\{(\d)\}/g, (_, n) => (vals[n - 1]?.trim() ? arg(vals[n - 1], p.wrap) : `<${p.fill[n - 1]}>`));
const ready = (p) => !needs(p) || p.fill.every((_, i) => vals[i]?.trim());
const shownCmd = (p) => (p.cmd === '\x03' ? 'Ctrl+C' : p.game !== undefined || p.ask ? p.cmd : filled(p));
function drawPal() {
  const card = palText() || opened;
  $('palList').innerHTML = shown.map((p, i) => {
    if (!(card && i === sel) || p.ask) // a plain row
      return `<li data-i="${i}" class="${i === sel ? 'sel' : ''}"><span>${esc(p.label)}</span><code>${esc(shownCmd(p))}</code></li>`;
    const fields = (p.fill || []).map((f, j) =>
      `<label class="field"><span>${esc(f)}</span><input data-f="${j}" value="${esc(vals[j] || '')}" autocomplete="off" spellcheck="false"></label>`).join('');
    const game = p.game !== undefined; // a game says what it is, and has no command to show
    return `<li data-i="${i}" class="answer sel"><b>${esc(p.label)}</b><p>${esc(game ? p.cmd : p.why || '')}</p>${fields}
      <div class="run"><code id="palCmd">${game ? '' : esc(shownCmd(p))}</code><button class="go" id="palRun" ${ready(p) ? '' : 'disabled'}>${p.game !== undefined ? 'Play' : 'Run'} ⏎</button></div>
      ${p.ai ? '<small>Suggested by AI. Check it before running.</small>' : ''}</li>`;
  }).join('');
  $('palList').querySelector('.sel')?.scrollIntoView({ block: 'nearest' });
}
// Jev reads what you typed and picks the built-in command it means, e.g. "how to run a dev server" → Start the app.
// Its pick becomes the answer. Nothing fits (or no answer): Ask AI. Only with Smarter matching on.
let matchTimer;
function bestMatch(text, v) {
  clearTimeout(matchTimer);
  matchTimer = setTimeout(async () => {
    const label = await dt.paletteMatch(text);
    if (v !== ver || document.activeElement !== $('palIn')) return; // typed on, closed, or filling in a name meanwhile
    const p = label && palette.find((x) => x.label === label);
    if (p) shown = [{ ...p, jev: true }, ...shown.filter((x) => x.label !== label)];
    else if (!shown.length) shown = [askRow()];
    sel = 0; vals = [];
    palSay('');
    drawPal();
  }, 350);
}
function run(p) {
  if (p.game !== undefined) { closePal(); openGame(p.game); dt.track('palette_used', { kind: 'game' }); return; }
  if (!ready(p)) { // needs a name first: show the card (if it isn't yet) and go to the first empty field
    if (!$('palList').querySelector('.answer')) { opened = true; drawPal(); }
    return $('palList').querySelector(`[data-f="${p.fill.findIndex((_, i) => !vals[i]?.trim())}"]`)?.focus();
  }
  if (p.cmd !== '\x03' && activeTerm()?.busy) return palSay(busyMsg(activeTerm()));
  const cmd = p.cmd === '\x03' ? p.cmd : filled(p);
  closePal();
  send(cmd, '', true);
  if (!p.ai) dt.track('palette_used', { kind: p.jev ? 'jev' : 'preset' });
}
async function choose(i) {
  const p = shown[i]; if (!p) return;
  if (!p.ask) return run(p);
  const v = ++ver;
  shown = []; drawPal(); palSay('Thinking…');
  const r = await dt.ask(palText(), active()?.cwd);
  if (v !== ver) return; // typed on or closed meanwhile
  dt.track('palette_used', { kind: 'ask_claude', ok: !!r });
  if (!r) return palSay("AI couldn't turn that into a command. Try saying it differently.");
  palSay('');
  shown = [{ ai: true, label: r.why || 'Here’s a command for that', cmd: r.cmd }]; sel = 0; vals = [];
  drawPal();
}
function move(step) {
  if (!shown.length) return;
  sel = (sel + step + shown.length) % shown.length; vals = [];
  drawPal();
}
$('palIn').oninput = renderPal;
$('palIn').onkeydown = (e) => {
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); move(e.key === 'ArrowDown' ? 1 : -1); }
  if (e.key === 'Enter') choose(sel);
};
// The name fields in the card: the command below updates as you type; Enter goes to the next one, then runs.
$('palList').oninput = (e) => {
  if (!e.target.dataset.f) return;
  vals[+e.target.dataset.f] = e.target.value;
  const p = shown[sel];
  $('palCmd').textContent = shownCmd(p);
  $('palRun').disabled = !ready(p);
};
$('palList').onkeydown = (e) => {
  if (e.target.dataset.f === undefined) return;
  if (e.key === 'Enter') { e.preventDefault(); run(shown[sel]); }
  if (e.key === 'ArrowUp' || e.key === 'ArrowDown') { e.preventDefault(); $('palIn').focus(); move(e.key === 'ArrowDown' ? 1 : -1); }
};
$('palList').onclick = (e) => {
  if (e.target.closest('#palRun')) return run(shown[sel]);
  const li = e.target.closest('li');
  if (!li || li.classList.contains('answer')) return;
  const i = +li.dataset.i;
  if (shown[i].ask) return choose(i);
  sel = i; vals = []; opened = true; // show its answer card
  drawPal();
  $('palList').querySelector('[data-f]')?.focus();
};

// --- Updates: a quiet pill once a newer Fork is downloaded, and What's new once after updating -----
// ready: downloaded, Restart now swaps it in (or it installs when Fork quits). Not ready: the old way,
// where Update and restart downloads it with install.sh (main.js explains when).
let update = null;
function showUpdate(title, notes, isUpdate) {
  $('updTitle').textContent = title;
  $('updNotes').innerHTML = DOMPurify.sanitize(notes);
  for (const id of ['updLater', 'updGo', 'updWarn']) $(id).style.display = isUpdate ? '' : 'none';
  $('updOk').style.display = isUpdate ? 'none' : '';
  $('updGo').textContent = update?.ready ? 'Restart now' : 'Update and restart';
  if (isUpdate) dt.sessionEnabled().then((on) => {
    $('updWarn').textContent = (on ? 'Fork will close and reopen with your tabs as they were. Anything running will stop; Claude picks up where it left off.'
      : 'Fork will close and reopen. Anything running in your terminals will stop.')
      + (update?.ready ? ' Or keep working: it updates the next time you quit Fork.' : '');
  });
  $('updOv').classList.add('show');
}
function closeUpdate() { $('updOv').classList.remove('show'); focusActive(); }
async function checkUpdate() {
  update = await dt.updateCheck();
  $('updPill').hidden = !update;
  if (update) $('updPillV').textContent = update.ready ? `Fork ${update.version} · Restart` : `Fork ${update.version}`;
}
checkUpdate();
dt.onUpdateReady(checkUpdate);
// Hourly, and whenever Fork comes to the front. Cheap: main asks GitHub at most once an hour.
setInterval(checkUpdate, 3600_000);
window.addEventListener('focus', checkUpdate);
// Check for Updates… (Fork menu): the same card, saying what it found. Closing it while it checks cancels the answer.
async function checkUpdateNow() {
  showUpdate('Checking for updates…', '', false);
  const r = await dt.updateCheckNow();
  if (!$('updOv').classList.contains('show')) return;
  const say = (title, text) => showUpdate(title, `<p>${text}</p>`, false);
  if (r.state === 'ready' || r.state === 'out') {
    update = r;
    checkUpdate(); // the pill too
    return showUpdate(`Fork ${r.version} ${r.ready ? 'is ready' : 'is out'}`, r.notes, true);
  }
  if (r.state === 'downloading') return showUpdate(`Fork ${r.version} is downloading`,
    `<p>It downloads in the background. When it's ready, a Restart pill shows at the top.</p>${r.notes}`, false);
  if (r.state === 'current') return say("You're up to date", `Fork ${r.version} is the newest version.`);
  if (r.state === 'dev') return say('Updates only work in the installed Fork', 'This Fork is running from its code (npm start).');
  say("Couldn't check for updates", 'Check your internet connection and try again.');
}
$('updPill').onclick = () => showUpdate(`Fork ${update.version} ${update.ready ? 'is ready' : 'is out'}`, update.notes, true);
$('updLater').onclick = $('updOk').onclick = closeUpdate;
$('updGo').onclick = () => {
  $('updGo').textContent = update.ready ? 'Restarting…' : 'Closing…';
  try { localStorage.setItem('dt-notes-read', update.version); } catch {} // you just read them: no "What's new" after the restart
  dt.track('update_clicked');
  dt.updateInstall();
};
$('updNotes').onclick = (e) => { const a = e.target.closest('a[href]'); if (a) { e.preventDefault(); dt.openExternal(a.href); } };
// Once, on the first launch of a new version. A fresh install has nothing saved, so no changelog on day one,
// and updating from the pill showed these notes already (dt-notes-read), so they don't come back after it.
dt.version().then(async (v) => {
  let seen, read;
  try { seen = localStorage.getItem('dt-seen-version'); read = localStorage.getItem('dt-notes-read'); localStorage.setItem('dt-seen-version', v); } catch {}
  if (!seen || seen === v || firstRun || read === v) return; // the welcome cards come first
  const r = await dt.updateNotes();
  if (r) showUpdate(`What's new in Fork ${v}`, r.notes, false);
});

// --- Settings: theme, font, size, smoothing ----------------------------------------
// Saved in localStorage: shared by every window and kept across launches; the `storage` event
// makes other open windows follow along. A theme is an xterm palette; the UI mixes its colours from it.
const BUNDLED = ['JetBrains Mono', 'Geist Mono', 'IBM Plex Mono', 'Fira Code']; // shipped via @fontsource
const SYSTEM = ['SF Mono', 'Menlo', 'Monaco', 'Courier New', 'Cascadia Code', 'Source Code Pro', 'Hack', 'Iosevka',
  'Berkeley Mono', 'Commit Mono', 'Monaspace Neon', 'Input Mono'];
// document.fonts.check() says yes to any system font name, so compare rendered widths against fallbacks.
function installed(font) {
  const c = document.createElement('canvas').getContext('2d');
  const w = (f) => { c.font = `20px ${f}`; return c.measureText('mmmwwwiiil10O').width; };
  return w(`"${font}", monospace`) !== w('monospace') || w(`"${font}", serif`) !== w('serif');
}
// Appearance is Light, Dark or System (follows the Mac); each has one look while the UI is redesigned (themes.js).
// Theme picks saved before the redesign (darkTheme, lightTheme) are left alone, unused.
const DEFAULTS = { mode: 'system',
  font: 'IBM Plex Mono', size: 13, smoothing: 'on', translucent: 'on', inFork: 'on', shots: 'on', alerts: 'on', sounds: 'on', showNotch: 'off', smart: 'on' };
function load() {
  let s;
  try { s = JSON.parse(localStorage.getItem('dt-settings')) || {}; } catch { s = {}; }
  if (s.smoothing && s.smoothing !== 'off') s.smoothing = 'on'; // was Default / Thin / Off
  delete s.theme; delete s.frost; delete s.notch; // the notch was on for everyone before; now it's off until you turn it on
  return { ...DEFAULTS, ...s };
}
let settings = load();

const sysDark = matchMedia('(prefers-color-scheme: dark)'); // macOS's own, while themeSource is 'system'
const isDark = (s) => (s.mode === 'system' ? sysDark.matches : s.mode === 'dark');
const currentTheme = (s) => THEMES[isDark(s) ? 'dark' : 'light'];
const fontStack = (f) => `"${f}", Menlo, monospace`;
// Medium (500), as in the design; a font without a 500 uses its regular.
// Bold text keeps its colour (not the bright one), as in the design's prompt.
const xtermOpts = (s) => ({ theme: currentTheme(s), fontFamily: fontStack(s.font), fontSize: s.size, fontWeight: 500, fontWeightBold: 700,
  drawBoldTextInBrightColors: false });

let applying = 0;
async function applySettings(s) {
  const t = currentTheme(s), root = document.documentElement;
  const vars = { bg: t.background, text: t.foreground, accent: t.accent, 'on-accent': t.onAccent, ok: t.green, warn: t.yellow, bad: t.red,
    tree: t.dark ? '#e6e6e6' : t.foreground, // files and folders; #e6e6e6 would vanish on a light theme
    blue: t.blue, magenta: t.magenta, cyan: t.cyan, mono: fontStack(s.font), 'mono-size': `${s.size}px` }; // the last five: code previews
  for (const [k, v] of Object.entries(vars)) root.style.setProperty(`--${k}`, v);
  Games.setColors({ bg: t.background, ink: t.foreground, accent: t.accent, fontSize: s.size }); // its pixels follow the font
  root.style.colorScheme = root.dataset.mode = t.dark ? 'dark' : 'light'; // native bits match; CSS can say :root[data-mode=light]
  codeFile?.setThemeType(codeTheme()); // the code preview: Pierre Light or Dark
  root.dataset.smooth = s.smoothing;
  root.dataset.translucent = s.translucent;
  dt.appearance(s.mode); // the frosted frame follows too
  dt.notchSetting(s.showNotch === 'on').then((n) => { $('notchRow').hidden = !n?.has; }); // its switch only on a Mac with a notch
  const run = ++applying;
  await Promise.all([`500 ${s.size}px "${s.font}"`, `700 ${s.size}px "${s.font}"`, '450 13px "Inter Variable"']
    .map((f) => document.fonts.load(f).catch(() => {}))); // else xterm measures the fallback font
  if (run !== applying) return; // a newer change (e.g. hovering the next swatch) already won
  for (const p of panes.values()) {
    if (isGame(p)) continue;
    Object.assign(p.term.options, xtermOpts(s));
    useGpu(p, s.smoothing === 'on');
    refit(p);
  }
}

function save(patch) {
  settings = { ...settings, ...patch };
  try { localStorage.setItem('dt-settings', JSON.stringify(settings)); } catch {}
  applySettings(settings);
  renderSettings();
  for (const [setting, value] of Object.entries(patch)) dt.track('setting_changed', { setting, value });
}

// Settings is a mode: the sidebar lists sections, the main area shows the page (terminals keep running, hidden).
const inSettings = () => $('app').classList.contains('in-settings');
const opts = (list) => list.map((x) => `<option>${esc(x)}</option>`).join('');
let built = false;
const SEGS = [['setMode', 'mode']]; // segmented controls -> setting
const SWITCHES = [['setSmooth', 'smoothing'], ['setTranslucent', 'translucent'], ['setInFork', 'inFork'], ['setShots', 'shots'], ['setAlerts', 'alerts'], ['setSounds', 'sounds'], ['setNotch', 'showNotch'], ['setSmart', 'smart']]; // checkboxes -> 'on'/'off'
function renderSettings() {
  if (!built) {
    built = true;
    $('setFont').innerHTML = `<optgroup label="Included">${opts(BUNDLED)}</optgroup>
      <optgroup label="On your Mac">${opts(SYSTEM.filter(installed))}</optgroup>`;
  }
  $('setFont').value = settings.font;
  $('setSize').value = settings.size;
  for (const [id, key] of SWITCHES) $(id).checked = settings[key] === 'on';
  for (const [id, key] of SEGS) for (const b of $(id).children) b.classList.toggle('on', b.dataset.v === settings[key]);

  // The terminal is hidden here, so show what the choice looks like on a fake one.
  const t = currentTheme(settings), c = (k, s) => `<span style="color:${t[k]}">${s}</span>`;
  const p = $('preview');
  p.style.cssText = `background:${t.background};color:${t.foreground};font:${settings.size}px/1.25 ${fontStack(settings.font)}`;
  p.innerHTML = [
    `${c('green', '➜')} ${c('blue', 'design-team-repo')} ${c('magenta', 'git:(main)')} git status`,
    'Changes not staged for commit:',
    c('red', '        modified:   src/components/Button.tsx'),
    c('green', '        new file:   src/components/Card.tsx'),
    `${c('yellow', 'hint:')} run ${c('cyan', 'git add .')} to stage them`,
  ].join('\n') + `<div class="dots">${['black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white']
    .flatMap((k) => [k, 'bright' + k[0].toUpperCase() + k.slice(1)]).map((k) => `<i style="background:${t[k]}"></i>`).join('')}</div>`;
}
// Settings has a tab per category (index.html .set-nav / .set-sec); it reopens on the last one you used.
let settingsSec = 'appearance';
function showSettingsSec(sec) {
  settingsSec = sec;
  for (const el of document.querySelectorAll('.set-nav .nav-item, .set-sec')) el.classList.toggle('on', el.dataset.sec === sec);
  document.querySelector('.set-page').scrollTop = 0;
}
for (const b of document.querySelectorAll('.set-nav .nav-item')) b.onclick = () => showSettingsSec(b.dataset.sec);
function openSettings() {
  showSettingsSec(settingsSec);
  renderSettings();
  $('app').classList.add('in-settings');
  dt.analytics().then((on) => { $('setUsage').checked = on; });
  dt.sessionEnabled().then((on) => { $('setRestore').checked = on; });
}
function closeSettings() {
  if (!inSettings()) return;
  $('app').classList.remove('in-settings');
  focusActive();
}

const SIZE = [8, 32];
const setSize = (n) => save({ size: clamp(Math.round(n) || settings.size, ...SIZE) });
$('setFont').onchange = () => save({ font: $('setFont').value });
$('setSize').oninput = () => { const n = +$('setSize').value; if (Number.isInteger(n) && n >= SIZE[0] && n <= SIZE[1]) save({ size: n }); }; // "1" on the way to "14" waits
$('setSize').onchange = () => setSize(+$('setSize').value);
$('sizeUp').onclick = () => setSize(settings.size + 1);
$('sizeDown').onclick = () => setSize(settings.size - 1);
for (const [id, key] of SWITCHES) $(id).onchange = () => save({ [key]: $(id).checked ? 'on' : 'off' });
$('setSounds').addEventListener('change', () => { if ($('setSounds').checked) Sounds.play(Sounds.done); }); // hear what you turned on
// Anonymous usage lives in the main process (analytics.mjs), not in settings: main is what sends it.
$('setUsage').onchange = () => dt.analytics($('setUsage').checked);
// So does reopening your tabs: main needs to know before any window exists.
$('setRestore').onchange = () => { dt.sessionEnabled($('setRestore').checked); dt.track('setting_changed', { setting: 'restore', value: $('setRestore').checked ? 'on' : 'off' }); };
$('usageOff').onclick = () => { dt.analytics(false); $('usageNote').hidden = true; };
for (const [id, key] of SEGS) $(id).onclick = (e) => { const b = e.target.closest('button'); if (b) save({ [key]: b.dataset.v }); };
sysDark.addEventListener('change', () => {
  if (settings.mode !== 'system') return;
  applySettings(settings);
  if (inSettings()) renderSettings();
});
$('openSettings').onclick = () => (inSettings() ? closeSettings() : openSettings());
$('closeSettings').onclick = closeSettings;
window.addEventListener('storage', (e) => {
  if (e.key !== 'dt-settings') return;
  settings = load();
  applySettings(settings);
  if (inSettings()) renderSettings();
});

// --- Keyboard: ⌘K, ⌘1–9, ⌘⌥ arrows, and hold ⌘ to reveal every shortcut ------------------
// (⌘N workspace, ⌘T terminal, ⌘⇧N window, ⌘W/D and tab cycling live in the menu bar, see main.js.)
let keysTimer;
const hideKeys = () => { clearTimeout(keysTimer); document.body.classList.remove('show-keys'); };

document.addEventListener('keydown', (e) => {
  if (e.key === 'Meta') {
    clearTimeout(keysTimer);
    keysTimer = setTimeout(() => document.body.classList.add('show-keys'), 300);
    return;
  }
  hideKeys();
  if (e.metaKey && e.code === 'KeyK' && e.shiftKey) { e.preventDefault(); $('palOv').classList.contains('show') ? closePal() : openPal(); }
  else if (e.metaKey && e.code === 'KeyK') { e.preventDefault(); closePal(); focusSearch(); }
  if (e.metaKey && !e.altKey && /^[1-9]$/.test(e.key) && +e.key <= tabs.length) { e.preventDefault(); goTab(+e.key - 1); }
  if (e.metaKey && e.altKey && e.key.startsWith('Arrow') && active()) {
    e.preventDefault();
    const rects = {};
    for (const id of Panes.leaves(tab().root)) {
      const r = panes.get(id).el.getBoundingClientRect();
      rects[id] = { x: r.x, y: r.y, w: r.width, h: r.height };
    }
    const n = Panes.neighbor(rects, active().id, e.key);
    if (n) focusPane(+n);
  }
  if (e.key === 'Escape' && e.target.matches?.('.tab input, .pane-chip input')) return; // renaming: Esc cancels it (inlineRename)
  if (e.key === 'Escape') { if ($('updOv').classList.contains('show')) return closeUpdate(); closePal(); closeSettings(); if ($('startOv').classList.contains('show')) closeStart(); }
}, true);
document.addEventListener('keyup', (e) => { if (e.key === 'Meta') hideKeys(); });
window.addEventListener('blur', hideKeys);
for (const ov of ['palOv', 'startOv']) $(ov).onclick = (e) => { if (e.target.id === ov) ov === 'palOv' ? closePal() : closeStart(); };
$('updOv').onclick = (e) => { if (e.target.id === 'updOv') closeUpdate(); };

// A new window starts with one tab in the home folder, and the start screen on top
// (the very first time, the welcome cards before it).
// Fonts must be loaded before the first xterm measures its cells.
// Unless this window is reopening the way you left it: then it's straight back to work.
applySettings(settings).then(async () => {
  const saved = await dt.sessionStart();
  home = await dt.home();
  if (saved?.tabs?.length) return restore(saved);
  firstRun ? runWelcome() : openPicker({ required: true }); // a window always works in a folder: pick one first
});
