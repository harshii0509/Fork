const $ = (id) => document.getElementById(id);
const q = (s) => `'${s.replace(/'/g, `'\\''`)}'`; // shell-quote a path
const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
// Icons in index.html are <i data-icon="name"> placeholders; draw them (icons.js, Lucide).
for (const el of document.querySelectorAll("[data-icon]")) el.outerHTML = icon(el.dataset.icon);

// --- Tabs and panes -------------------------------------------------------------
// Window -> tabs (listed in the sidebar) -> panes (split tree, see panes.js). Each pane is
// one xterm + one shell. The active pane drives the sidebar, breadcrumb, chips and banner.
const panes = new Map(); // id -> { id, term, fit, el, cwd, busy, failed, unseen, lastUsed }
let tabs = [], tabIx = 0, home = '', chips = [];
const tab = () => tabs[tabIx];
const active = () => panes.get(tab()?.activeId);
const tabOf = (id) => tabs.find((t) => Panes.leaves(t.root).includes(id));

// screen/when: output saved from last time (session.mjs), shown above a quiet "Restored" line.
async function newPane(cwd, { screen, when } = {}) {
  const id = await dt.create(cwd);
  const el = document.createElement('div');
  el.className = 'pane';
  const inner = document.createElement('div'); // unpadded box so FitAddon measures exactly
  inner.className = 'pane-inner';
  el.append(inner);
  $('hidden').append(el);

  const term = new Terminal({ ...xtermOpts(settings), lineHeight: 1.25, cursorBlink: true });
  const fit = new FitAddon.FitAddon(), serial = new SerializeAddon.SerializeAddon();
  term.loadAddon(fit);
  term.loadAddon(serial);
  term.open(inner);
  if (screen) term.write(`${screen}\x1b[0m\r\n\x1b[2m── Restored · ${restoredAt(when)} ──\x1b[0m\r\n`);
  const pane = { id, term, fit, serial, el, cwd: cwd || '', busy: false, failed: false, unseen: false, lastUsed: Date.now(), tail: '', hist: [], at: -1, nav: null };
  panes.set(id, pane);

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
  new ResizeObserver(() => {
    if (!el.offsetParent) return; // hidden tab
    fit.fit();
    dt.resize(id, term.cols, term.rows);
  }).observe(inner);

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
      renderTabs();
    }
    return true;
  });
  term.parser.registerOscHandler(133, (data) => {
    if (data.startsWith('C')) {
      pane.busy = true; pane.failed = false; pane.lastUsed = Date.now(); if (pane === active()) hideOops();
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
    }
    syncBusy();
    renderTabs();
    return true;
  });
  return pane;
}

dt.onData((id, d) => {
  const p = panes.get(id);
  if (!p) return;
  p.term.write(d);
  // A dev server printed its address? Keep a short tail so one split across chunks is still caught.
  p.tail = (p.tail + d).slice(-400);
  const url = Preview.findLocalUrl(Preview.stripAnsi(p.tail));
  if (url) { p.tail = ''; appFound(url); }
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
  $('app').classList.remove('in-settings'); // ⌘T, ⌘1–9, splits: back to the terminal
  const t = tabOf(id);
  if (!t) return;
  if (t === tab() && t.activeId === id) return;
  tabIx = tabs.indexOf(t);
  t.activeId = id;
  for (const pid of Panes.leaves(t.root)) panes.get(pid).unseen = false;
  render();
  hideOops();
  setHint('');
  syncBusy();
  refresh();
  panes.get(id).term.focus();
}

async function newTab(cwd) {
  const p = await newPane(cwd);
  tabs.push({ root: { id: p.id }, activeId: null });
  focusPane(p.id);
}

async function split(dir) {
  const cur = active();
  if (!cur) return;
  const p = await newPane(cur.cwd); // a split opens in the same folder
  dt.track('pane_split', { dir });
  tab().root = Panes.split(tab().root, cur.id, p.id, dir);
  focusPane(p.id);
}

function closePane(id, { exited = false, force = false } = {}) {
  const p = panes.get(id);
  if (!p) return;
  if (!exited && !force && p.busy && !confirm('Something is still running here. Close it anyway?')) return;
  const t = tabOf(id), cur = tab();
  if (!exited) dt.kill(id);
  p.term.dispose();
  p.el.remove();
  panes.delete(id);
  t.root = Panes.remove(t.root, id);
  if (!t.root) {
    t.blob?.destroy();
    tabs.splice(tabs.indexOf(t), 1);
    if (!tabs.length) return forgetAndClose(); // last tab closes the window, and it won't come back
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

function renderTabs() {
  $('tabs').innerHTML = tabs.map((t, i) => {
    const ps = Panes.leaves(t.root).map((id) => panes.get(id)).filter(Boolean);
    const p = panes.get(t.activeId) || ps[0];
    const name = !p?.cwd ? 'New tab' : p.cwd === home ? 'Home' : p.cwd.split('/').pop() || '/';
    const where = p?.cwd ? ` · ${p.cwd}` : '';
    return `<div class="tab ${i === tabIx ? 'active' : ''}" data-i="${i}" ${i < 9 ? `data-key="⌘${i + 1}"` : ''} title="${esc(tabState(t).label + where)}">
      <span class="tblob"></span>
      <span class="tname">${esc(name)}</span>
      ${ps.length > 1 ? `<span class="tcount">${ps.length} panes</span>` : ''}
      <button class="tclose" data-close="${i}" aria-label="Close tab">${icon("x")}</button></div>`;
  }).join('');
  // The rows were just rebuilt; move each tab's own blob back in so its animation carries on.
  $('tabs').querySelectorAll('.tblob').forEach((slot, i) => {
    const t = tabs[i];
    t.blob ||= Blobs.status(22);
    t.blob.el.className = 'tblob';
    slot.replaceWith(t.blob.el);
  });
  syncTabBlobs();
  saveSoon(); // tabs, splits, folders and busy states all pass through here
}

// What each tab's blob shows. With split panes, the most pressing pane wins.
const DOZE_AFTER = 5 * 60e3;
const LOOKS = {
  running: { label: 'Running', state: 'thinking' },
  failed: { label: 'Last command failed', state: 'idle', expression: 'sad', tint: 'bad' },
  done: { label: 'Finished while you were away', state: 'notify' },
  dozing: { label: 'Dozing', state: 'sleep' },
  ready: { label: 'Ready', state: 'idle' },
};
function tabState(t) {
  const ps = Panes.leaves(t.root).map((id) => panes.get(id)).filter(Boolean);
  const key = ps.some((p) => p.busy) ? 'running'
    : ps.some((p) => p.failed) ? 'failed'
    : ps.some((p) => p.unseen) ? 'done'
    : ps.length && ps.every((p) => Date.now() - p.lastUsed > DOZE_AFTER) ? 'dozing'
    : 'ready';
  return LOOKS[key];
}
function syncTabBlobs() {
  for (const t of tabs) {
    if (!t.blob) continue;
    const look = tabState(t);
    t.blob.set(look.state, look.expression, look.tint);
    t.blob.el.setAttribute('aria-label', look.label);
    t.blob.el.setAttribute('role', 'img');
  }
}
setInterval(syncTabBlobs, 30e3); // so an untouched tab dozes off on its own

$('tabs').onclick = (e) => {
  const c = e.target.closest('.tclose');
  if (c) return closeTab(+c.dataset.close);
  const t = e.target.closest('.tab');
  if (t) goTab(+t.dataset.i);
};
$('newTab').onclick = () => { newTab(active()?.cwd); dt.track('tab_opened'); };
const toggleSide = () => { $('app').classList.toggle('no-side'); dt.track('sidebar_toggled'); saveSoon(); }; // panes refit via their ResizeObserver
$('sideToggle').onclick = $('sideShow').onclick = toggleSide;
$('splitR').onclick = () => split('row');
$('splitD').onclick = () => split('col');

dt.onCmd((cmd) => ({
  'new-tab': () => { newTab(active()?.cwd); dt.track('tab_opened'); },
  close: () => active() && closePane(active().id),
  'split-right': () => split('row'),
  'split-down': () => split('col'),
  'next-tab': () => goTab(tabIx + 1),
  'prev-tab': () => goTab(tabIx - 1),
  settings: () => (inSettings() ? closeSettings() : openSettings()),
  'toggle-sidebar': toggleSide,
  'toggle-preview': togglePv,
  back: () => go(-1),
  forward: () => go(1),
  tour: replayTour,
}[cmd]?.()));

const runBlob = Blobs.mount($('runBlob'), { size: 34 });
function syncBusy() {
  const busy = !!active()?.busy;
  $('app').classList.toggle('busy', busy);
  busy ? runBlob.start() : runBlob.stop();
}

// The core mechanic: put the real command in the prompt. Moving around runs instantly;
// anything that changes things waits for Enter so the person stays in control and learns it.
function send(cmd, why, run) {
  const p = active();
  if (!p) return;
  if (cmd === '\x03') { dt.write(p.id, cmd); p.term.focus(); return; }
  if (p.busy) { setHint('Something is running. Stop it first (Ctrl+C), then try again.', true); return; }
  dt.write(p.id, '\x15' + cmd + (run ? '\r' : '')); // Ctrl+U clears anything half-typed first
  p.suggested = true;
  setHint(run ? '' : why);
  p.term.focus();
}

// ← → in the sidebar (and ⌘[ ⌘]): back and forward through the folders this pane has been in.
function go(step) {
  const p = active(), path = p?.hist[p.at + step];
  if (!path) return;
  if (p.busy) return setHint('Something is running. Stop it first (Ctrl+C), then try again.', true);
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
const expanded = new Set(); // folders opened with ▸ (full paths), remembered across cds
let treeDirs = [], refreshing = 0;

// A file's type icon in the theme colour for its kind (icons.js).
const fileIconHtml = (name) => `<span class="fi">${icon(fileIcon(name).icon)}</span>`;

// One row per file or folder; open folders list their contents underneath, indented.
async function rows(dir, entries, depth, dirs) {
  return (await Promise.all(entries.map(async (e) => {
    const path = join(dir, e.name), open = e.folder && expanded.has(path);
    let kids = '';
    if (open) {
      dirs.push(path);
      const list = await dt.ls(path);
      kids = list.length ? await rows(path, list, depth + 1, dirs) : `<div class="entries-empty" style="--depth:${depth + 1}">Empty</div>`;
    }
    return `<div class="entry${e.noise ? ' noise' : ''}${path === shownFile() ? ' on' : ''}" draggable="true" style="--depth:${depth}"
        data-path="${esc(path)}" data-folder="${e.folder}" title="${esc(e.name)}">
      ${e.folder ? `<button class="twisty${open ? ' open' : ''}" aria-label="${open ? 'Collapse' : 'Expand'}">${icon("chevron-right")}</button>` : '<span class="twisty"></span>'}
      ${e.folder ? `<span class="fi">${icon(open ? "folder-open" : "folder")}</span>` : fileIconHtml(e.name)}<span>${esc(e.name)}</span></div>${kids}`;
  }))).join('');
}

async function refresh() {
  syncArrows();
  const cwd = active()?.cwd;
  if (!cwd) return;
  const run = ++refreshing;
  const r = await dt.dir(cwd);
  const dirs = [cwd];
  const tree = r.entries.length ? await rows(cwd, r.entries, 0, dirs) : '<div class="empty">This folder is empty.</div>';
  if (run !== refreshing || cwd !== active()?.cwd) return; // switched panes, or a newer refresh, while reading
  const { suggestions } = r;
  home = r.home;
  treeDirs = dirs;
  syncWatch();

  const parts = [];
  let base = '/', rest = cwd;
  if (cwd === home || cwd.startsWith(home + '/')) { parts.push(['Home', home]); base = home; rest = cwd.slice(home.length); }
  else parts.push(['/', '/']);
  let acc = base;
  for (const seg of rest.split('/').filter(Boolean)) { acc = acc.replace(/\/$/, '') + '/' + seg; parts.push([seg, acc]); }
  $('crumbs').innerHTML = parts.map(([name, path], i) =>
    `${i ? '<span class="sep">›</span>' : ''}<button class="crumb" data-path="${esc(path)}">${esc(name)}</button>`).join('');

  $('entries').innerHTML = tree;

  chips = suggestions;
  $('chips').innerHTML = suggestions.map((s, i) => `<button class="chip" data-i="${i}" title="${esc(s.cmd)}">${esc(s.label)}</button>`).join('');
  renderTabs();
}

$('crumbs').onclick = (e) => {
  const b = e.target.closest('.crumb');
  if (b) { send(`cd ${q(b.dataset.path)}`, '', true); dt.track('folder_opened', { via: 'crumb' }); }
};
// ▸ opens a folder in place; its name moves there; a file opens in the preview panel.
$('entries').onclick = (e) => {
  const row = e.target.closest('.entry'); if (!row) return;
  const { path } = row.dataset;
  if (row.dataset.folder !== 'true') return openFile(path);
  if (e.target.closest('.twisty')) { expanded.has(path) ? expanded.delete(path) : expanded.add(path); return refresh(); }
  const cwd = active()?.cwd || '';
  send(`cd ${q(path.startsWith(cwd + '/') ? path.slice(cwd.length + 1) : path)}`, '', true); // relative reads better
  dt.track('folder_opened', { via: 'sidebar' });
};
$('entries').ondragstart = (e) => {
  const row = e.target.closest('.entry'); if (!row) return;
  e.dataTransfer.setData('text/x-dt-path', row.dataset.path);
  e.dataTransfer.effectAllowed = 'copy';
};
// Something changed on disk (usually Claude at work): update the tree, and the file being previewed.
dt.onFsChanged((paths) => {
  refresh();
  if (pv.file && paths.includes(pv.file)) openFile(pv.file, true);
});
// A file dropped anywhere but a pane does nothing (instead of Chromium trying to open it).
document.addEventListener('dragover', (e) => { if (!e.defaultPrevented) { e.preventDefault(); e.dataTransfer.dropEffect = 'none'; } });
document.addEventListener('drop', (e) => e.preventDefault());
$('chips').onclick = (e) => { const b = e.target.closest('.chip'); if (b) { const s = chips[b.dataset.i]; send(s.cmd, s.why, s.run); } };
$('stop').onclick = () => send('\x03');

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
}
function hidePv() { $('app').classList.remove('has-pv'); markShown(); active()?.term.focus(); }
function togglePv() { pvOpen() ? hidePv() : showPv(); dt.track('preview_toggled'); }
function markShown() { for (const r of $('entries').querySelectorAll('.entry')) r.classList.toggle('on', r.dataset.path === shownFile()); }
function syncWatch() { dt.watch([...new Set([...treeDirs, ...(pv.file ? [dirOf(pv.file)] : [])])]); }

// Line numbers in their own column, so "line 42" is easy to tell Claude.
const codeView = (r) => `<div class="pv-code"><pre class="gutter">${Array.from({ length: r.lines }, (_, i) => i + 1).join('\n')}</pre>` +
  `<pre class="src"><code>${r.html}</code></pre></div>`;

async function openFile(path, changed) {
  const view = $('pvFile'), top = changed ? view.scrollTop : 0; // a file Claude just edited keeps its scroll
  const firstTime = pv.file !== path;
  if (firstTime) dt.track('file_previewed', { kind: fileIcon(path.split('/').pop()).icon }); // the type, never the name
  pv.file = path;
  showPv('file');
  if (firstTime) syncWatch();
  const r = await dt.preview(path);
  if (pv.file !== path) return; // another file was clicked meanwhile
  $('pvName').innerHTML = `${fileIconHtml(path.split('/').pop())}${esc(path.split('/').pop())}<small id="pvMeta">${r.size != null ? bytes(r.size) : ''}</small>`;
  $('pvName').title = path;
  $('pvPage').style.display = r.kind === 'html' ? '' : 'none';
  const src = fileUrl(path) + (changed ? `?v=${Date.now()}` : ''); // skip the image cache after an edit
  view.innerHTML = {
    image: () => `<div class="pv-media"><img src="${src}" alt=""></div>`,
    video: () => `<div class="pv-media"><video src="${src}" controls loop></video></div>`,
    markdown: () => `<article class="pv-md">${DOMPurify.sanitize(r.html)}</article>`,
    code: () => codeView(r),
    html: () => codeView(r),
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
$('pvSeg').onclick = (e) => { const b = e.target.closest('button'); if (b) showPv(b.dataset.v); };
$('pvGrip').onpointerdown = (e) => drag(e, (x) => $('app').style.setProperty('--pv', `${innerWidth - x}px`));

// The running app. A <webview> is plain DOM, so ⌘K and the start screen still sit above it.
function appMsg(html) { $('pvAppMsg').innerHTML = html; $('pvAppMsg').classList.toggle('show', !!html); }
appMsg('<div><b style="color:var(--text)">No app yet</b><br>Start your app in the terminal (like <code>npm run dev</code>)<br>and it will offer to show up here. Or type an address above.</div>');

function loadApp(url) {
  pv.url = url;
  $('ready').classList.remove('show');
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

// A dev server printed its address: offer it once. Already looking at the app? Just follow it.
const offered = new Set();
let readyUrl = null;
function appFound(url) {
  if (offered.has(url) || url === pv.url) return;
  offered.add(url);
  if (pvOpen() && pv.mode === 'app') return loadApp(url);
  readyUrl = url;
  $('readyUrl').textContent = url.replace(/^https?:\/\//, '').replace(/\/$/, '');
  $('ready').classList.add('show');
}
$('readyShow').onclick = () => { loadApp(readyUrl); dt.track('app_preview_shown'); };
$('readyClose').onclick = () => $('ready').classList.remove('show');

// --- When something fails ------------------------------------------------------
let fix = null;
function showOops() {
  $('oopsText').textContent = "That didn't work.";
  $('explainBtn').style.display = ''; $('fixBtn').style.display = 'none';
  $('oops').classList.add('show');
}
const oopsBlob = Blobs.mount($('oopsBlob'), { size: 40, expression: 'curious' });
function reading(on) { $('oopsBlob').hidden = !on; on ? oopsBlob.start() : oopsBlob.stop(); }
function hideOops() { $('oops').classList.remove('show'); reading(false); }
function lastLines(n = 40) {
  const b = active().term.buffer.active, end = b.baseY + b.cursorY, out = [];
  for (let i = Math.max(0, end - n); i <= end; i++) out.push(b.getLine(i)?.translateToString(true) ?? '');
  return out.join('\n').trim();
}
$('explainBtn').onclick = async () => {
  dt.track('error_explained');
  $('explainBtn').style.display = 'none';
  $('oopsText').textContent = 'Reading the error…';
  reading(true);
  const r = await dt.explain(lastLines(), active()?.cwd);
  reading(false);
  $('oopsText').textContent = r.text;
  fix = r.fix;
  $('fixBtn').style.display = fix ? '' : 'none';
};
$('fixBtn').onclick = () => { hideOops(); send(fix, 'Suggested fix. Read it, then press Enter.', false); dt.track('fix_used'); };
$('oopsClose').onclick = hideOops;

// --- Reopen the way you left it (session.mjs, main.js) ----------------------------------------
// This window's tabs, splits and folders go to main about a second after they change. At quit main
// asks for everything, including what's on screen. Closing the last tab forgets the window instead.
let saveTimer, restoring = false, forgotten = false;
function snapshot(full) {
  const node = (n) => {
    if (n.dir) return { dir: n.dir, ratio: n.ratio ?? 0.5, a: node(n.a), b: node(n.b) };
    const p = panes.get(n.id), s = { cwd: p?.cwd || '' };
    if (p?.busy && p.tool === 'claude') s.claude = true;
    if (full && p) try { s.screen = p.serial.serialize({ scrollback: 1000 }); } catch {}
    return s;
  };
  const width = parseInt($('app').style.getPropertyValue('--side'), 10);
  return {
    tabIx,
    side: { hidden: $('app').classList.contains('no-side'), ...(width ? { width } : {}) },
    tabs: tabs.map((t) => ({ root: node(t.root), active: Math.max(0, Panes.leaves(t.root).indexOf(t.activeId)) })),
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
      ids.push(p.id);
      return { id: p.id };
    };
    const root = await build(t.root);
    tabs.push({ root, activeId: ids[t.active] ?? ids[0] });
  }
  if (saved.side.hidden) $('app').classList.add('no-side');
  if (saved.side.width) $('app').style.setProperty('--side', `${saved.side.width}px`);
  restoring = false;
  const t = tabs[saved.tabIx] || tabs[0], id = t.activeId;
  t.activeId = null; // force a redraw
  focusPane(id);
  dt.track('session_restored', { tabs: tabs.length, panes: panes.size });
}

// --- Start screen: never a blank prompt ------------------------------------------
async function openStart() {
  const list = await dt.recents();
  $('recents').innerHTML = list.length ? '<div class="label" style="margin-top:0">Recent</div>' + list.map((p) =>
    `<button class="opt" data-path="${esc(p)}"><span class="ico">${icon("folder")}</span>
      <span>${esc(p.split('/').pop())}<small>${esc(p)}</small></span></button>`).join('') : '';
  $('usageNote').hidden = !(await dt.analytics());
  $('startOv').classList.add('show');
}
function closeStart() {
  $('startOv').classList.remove('show');
  active()?.term.focus();
  if (tourNext) { tourNext = false; setTimeout(runTour, 400); } // after the folder list and suggestions load
}
async function workIn(path) { await dt.recents(path); send(`cd ${q(path)}`, '', true); closeStart(); }

$('recents').onclick = (e) => { const b = e.target.closest('.opt'); if (b) { workIn(b.dataset.path); dt.track('start_choice', { choice: 'recent' }); } };
$('pick').onclick = async () => { const p = await dt.pickFolder(); if (p) { workIn(p); dt.track('start_choice', { choice: 'pick' }); } };
$('cloneOpt').onclick = () => { $('clone').classList.add('show'); $('cloneUrl').focus(); };
$('cloneGo').onclick = async () => {
  const url = $('cloneUrl').value.trim();
  if (!url) return;
  const dest = await dt.pickFolder(); // where should the project live?
  if (!dest) return;
  dt.track('start_choice', { choice: 'clone' });
  const name = url.replace(/\/+$/, '').split('/').pop().replace(/\.git$/, '');
  closeStart();
  send(`cd ${q(dest)} && git clone ${q(url)} && cd ${q(name)}`,
    `Downloads ${name} into ${dest.split('/').pop()}, then moves into it.`, false);
};
$('cloneUrl').onkeydown = (e) => { if (e.key === 'Enter') $('cloneGo').click(); };
$('skip').onclick = () => { closeStart(); dt.track('start_choice', { choice: 'skip' }); };

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
  active()?.term.focus();
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
dt.palette().then((p) => { palette = p; });

function openPal() { $('palIn').value = ''; renderPal(); $('palOv').classList.add('show'); $('palIn').focus(); dt.track('palette_opened'); }
function closePal() { $('palOv').classList.remove('show'); active()?.term.focus(); }
function renderPal() {
  const text = $('palIn').value.trim().toLowerCase();
  const words = text.split(/\s+/).filter(Boolean);
  shown = palette.filter((p) => words.every((w) => (p.label + ' ' + p.cmd).toLowerCase().includes(w)));
  if (text) shown.push({ ask: true, label: `Ask Claude: “${$('palIn').value.trim()}”`, cmd: 'AI' });
  sel = 0;
  $('palStatus').classList.remove('show');
  $('palList').innerHTML = shown.map((p, i) =>
    `<li data-i="${i}" class="${i === sel ? 'sel' : ''}"><span>${esc(p.label)}</span><code>${esc(p.cmd === '\x03' ? 'Ctrl+C' : p.cmd)}</code></li>`).join('');
}
async function choose(i) {
  const p = shown[i]; if (!p) return;
  if (!p.ask) { closePal(); send(p.cmd, p.why, p.run); dt.track('palette_used', { kind: 'preset' }); return; }
  $('palList').innerHTML = '';
  $('palStatus').textContent = 'Thinking…'; $('palStatus').classList.add('show');
  const r = await dt.ask($('palIn').value.trim(), active()?.cwd);
  dt.track('palette_used', { kind: 'ask_claude', ok: !!r });
  if (!r) { $('palStatus').textContent = "Claude couldn't turn that into a command. Try saying it differently."; return; }
  closePal();
  send(r.cmd, r.why, false); // AI suggestions are never run automatically
}
$('palIn').oninput = renderPal;
$('palIn').onkeydown = (e) => {
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    sel = (sel + (e.key === 'ArrowDown' ? 1 : -1) + shown.length) % shown.length;
    [...$('palList').children].forEach((li, i) => li.classList.toggle('sel', i === sel));
    $('palList').children[sel]?.scrollIntoView({ block: 'nearest' });
  }
  if (e.key === 'Enter') choose(sel);
};
$('palList').onclick = (e) => { const li = e.target.closest('li'); if (li) choose(+li.dataset.i); };
$('openPal').onclick = openPal;

// --- Updates: a quiet pill when a newer Fork is out, and What's new once after updating ----------
let update = null;
function showUpdate(title, notes, isUpdate) {
  $('updTitle').textContent = title;
  $('updNotes').innerHTML = DOMPurify.sanitize(notes);
  for (const id of ['updLater', 'updGo', 'updWarn']) $(id).style.display = isUpdate ? '' : 'none';
  $('updOk').style.display = isUpdate ? 'none' : '';
  if (isUpdate) dt.sessionEnabled().then((on) => {
    $('updWarn').textContent = on ? 'Fork will close and reopen with your tabs as they were. Anything running will stop; Claude picks up where it left off.'
      : 'Fork will close and reopen. Anything running in your terminals will stop.';
  });
  $('updOv').classList.add('show');
}
function closeUpdate() { $('updOv').classList.remove('show'); active()?.term.focus(); }
async function checkUpdate() {
  update = await dt.updateCheck();
  $('updPill').hidden = !update;
  if (update) $('updPillV').textContent = `Fork ${update.version}`;
}
checkUpdate();
// Hourly, and whenever Fork comes to the front. Cheap: main asks GitHub at most once an hour.
setInterval(checkUpdate, 3600_000);
window.addEventListener('focus', checkUpdate);
$('updPill').onclick = () => showUpdate(`Fork ${update.version} is out`, update.notes, true);
$('updLater').onclick = $('updOk').onclick = closeUpdate;
$('updGo').onclick = () => { $('updGo').textContent = 'Closing…'; dt.track('update_clicked'); dt.updateInstall(); };
$('updNotes').onclick = (e) => { const a = e.target.closest('a[href]'); if (a) { e.preventDefault(); dt.openExternal(a.href); } };
// Once, on the first launch of a new version. A fresh install has nothing saved, so no changelog on day one.
dt.version().then(async (v) => {
  let seen;
  try { seen = localStorage.getItem('dt-seen-version'); localStorage.setItem('dt-seen-version', v); } catch {}
  if (!seen || seen === v || firstRun) return; // the welcome cards come first
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
// Appearance is Light, Dark or System; each side keeps its own theme, and System swaps them with macOS.
const DEFAULTS = { mode: 'system', darkTheme: 'Designer', lightTheme: 'Catppuccin Latte',
  font: installed('SF Mono') ? 'SF Mono' : 'Menlo', size: 13, smoothing: 'on', translucent: 'on' };
function load() {
  let s;
  try { s = JSON.parse(localStorage.getItem('dt-settings')) || {}; } catch { s = {}; }
  // Settings saved before Light/Dark/System had one `theme`: keep it, on its own side.
  if (s.theme && !s.mode) {
    const dark = THEMES.find((t) => t.name === s.theme)?.dark ?? true;
    s.mode = dark ? 'dark' : 'light';
    s[dark ? 'darkTheme' : 'lightTheme'] = s.theme;
  }
  if (s.smoothing && s.smoothing !== 'off') s.smoothing = 'on'; // was Default / Thin / Off
  delete s.theme; delete s.frost;
  return { ...DEFAULTS, ...s };
}
let settings = load();

const sysDark = matchMedia('(prefers-color-scheme: dark)'); // macOS's own, while themeSource is 'system'
const isDark = (s) => (s.mode === 'system' ? sysDark.matches : s.mode === 'dark');
const themeOf = (name, dark) => THEMES.find((t) => t.name === name && t.dark === dark)
  || themeOf(dark ? DEFAULTS.darkTheme : DEFAULTS.lightTheme, dark);
const currentTheme = (s) => (isDark(s) ? themeOf(s.darkTheme, true) : themeOf(s.lightTheme, false));
const fontStack = (f) => `"${f}", Menlo, monospace`;
const xtermOpts = (s) => ({ theme: currentTheme(s), fontFamily: fontStack(s.font), fontSize: s.size });

let applying = 0;
async function applySettings(s) {
  const t = currentTheme(s), root = document.documentElement;
  const vars = { bg: t.background, text: t.foreground, accent: t.accent, 'on-accent': t.onAccent, ok: t.green, warn: t.yellow, bad: t.red,
    tree: t.dark ? '#e6e6e6' : t.foreground, // files and folders; #e6e6e6 would vanish on a light theme
    blue: t.blue, magenta: t.magenta, cyan: t.cyan, mono: fontStack(s.font), 'mono-size': `${s.size}px` }; // the last five: code previews
  for (const [k, v] of Object.entries(vars)) root.style.setProperty(`--${k}`, v);
  Blobs.setColor(t.accent, t.red);
  root.style.colorScheme = t.dark ? 'dark' : 'light'; // native bits (dropdowns, spinners) match the theme
  root.dataset.smooth = s.smoothing;
  root.dataset.translucent = s.translucent;
  dt.appearance(s.mode); // the frosted sidebar follows too
  const run = ++applying;
  await document.fonts.load(`${s.size}px "${s.font}"`).catch(() => {}); // else xterm measures the fallback font
  if (run !== applying) return; // a newer change (e.g. hovering the next swatch) already won
  for (const p of panes.values()) {
    Object.assign(p.term.options, xtermOpts(s));
    if (p.el.offsetParent) { p.fit.fit(); dt.resize(p.id, p.term.cols, p.term.rows); } // hidden tabs refit when shown
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
const SWITCHES = [['setSmooth', 'smoothing'], ['setTranslucent', 'translucent']]; // checkboxes -> 'on'/'off'
function renderSettings() {
  if (!built) {
    built = true;
    $('setLight').innerHTML = opts(THEMES.filter((t) => !t.dark).map((t) => t.name));
    $('setDark').innerHTML = opts(THEMES.filter((t) => t.dark).map((t) => t.name));
    $('setFont').innerHTML = `<optgroup label="Included">${opts(BUNDLED)}</optgroup>
      <optgroup label="On your Mac">${opts(SYSTEM.filter(installed))}</optgroup>`;
  }
  // Light or Dark: one "Theme" picker for that side. System: both, since macOS decides which shows.
  const both = settings.mode === 'system';
  $('lightRow').hidden = settings.mode === 'dark';
  $('darkRow').hidden = settings.mode === 'light';
  for (const [row, name] of [['lightRow', 'Light theme'], ['darkRow', 'Dark theme']])
    $(row).querySelector('.theme-label').textContent = both ? name : 'Theme';
  $('setLight').value = themeOf(settings.lightTheme, false).name;
  $('setDark').value = themeOf(settings.darkTheme, true).name;
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
function openSettings() {
  renderSettings();
  $('app').classList.add('in-settings');
  dt.analytics().then((on) => { $('setUsage').checked = on; });
  dt.sessionEnabled().then((on) => { $('setRestore').checked = on; });
}
function closeSettings() {
  if (!inSettings()) return;
  $('app').classList.remove('in-settings');
  active()?.term.focus();
}

const SIZE = [8, 32];
const setSize = (n) => save({ size: clamp(Math.round(n) || settings.size, ...SIZE) });
$('setLight').onchange = () => save({ lightTheme: $('setLight').value });
$('setDark').onchange = () => save({ darkTheme: $('setDark').value });
$('setFont').onchange = () => save({ font: $('setFont').value });
$('setSize').oninput = () => { const n = +$('setSize').value; if (Number.isInteger(n) && n >= SIZE[0] && n <= SIZE[1]) save({ size: n }); }; // "1" on the way to "14" waits
$('setSize').onchange = () => setSize(+$('setSize').value);
$('sizeUp').onclick = () => setSize(settings.size + 1);
$('sizeDown').onclick = () => setSize(settings.size - 1);
for (const [id, key] of SWITCHES) $(id).onchange = () => save({ [key]: $(id).checked ? 'on' : 'off' });
// Anonymous usage lives in the main process (analytics.mjs), not in settings: main is what sends it.
$('setUsage').onchange = () => dt.analytics($('setUsage').checked);
// So does reopening your tabs: main needs to know before any window exists.
$('setRestore').onchange = () => { dt.sessionEnabled($('setRestore').checked); dt.track('setting_changed', { setting: 'restore', value: $('setRestore').checked ? 'on' : 'off' }); };
$('usageOff').onclick = () => { dt.analytics(false); $('usageNote').hidden = true; };
for (const [id, key] of SEGS) $(id).onclick = (e) => { const b = e.target.closest('button'); if (b) save({ [key]: b.dataset.v }); };
$('openSettings').onclick = () => (inSettings() ? closeSettings() : openSettings());
$('closeSettings').onclick = closeSettings;
sysDark.addEventListener('change', () => {
  if (settings.mode !== 'system') return;
  applySettings(settings);
  if (inSettings()) renderSettings();
});
window.addEventListener('storage', (e) => {
  if (e.key !== 'dt-settings') return;
  settings = load();
  applySettings(settings);
  if (inSettings()) renderSettings();
});

// --- Keyboard: ⌘K, ⌘1–9, ⌘⌥ arrows, and hold ⌘ to reveal every shortcut ------------------
// (⌘N/T/W/D and tab cycling live in the menu bar, see main.js.)
let keysTimer;
const hideKeys = () => { clearTimeout(keysTimer); document.body.classList.remove('show-keys'); };

document.addEventListener('keydown', (e) => {
  if (e.key === 'Meta') {
    clearTimeout(keysTimer);
    keysTimer = setTimeout(() => document.body.classList.add('show-keys'), 300);
    return;
  }
  hideKeys();
  if (e.metaKey && e.key === 'k') { e.preventDefault(); $('palOv').classList.contains('show') ? closePal() : openPal(); }
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
  if (saved) return restore(saved);
  await newTab();
  firstRun ? runWelcome() : openStart();
});
