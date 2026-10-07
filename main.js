import { app, BrowserWindow, clipboard, ipcMain, dialog, nativeTheme, Menu, Notification, screen, shell, webContents } from 'electron';
import { execFile, execFileSync, spawn } from 'node:child_process';
import { chmodSync, existsSync, opendirSync, readFileSync, statSync, watch, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import pty from 'node-pty';
import updater from 'electron-updater';
import { marked } from 'marked';
import { suggest, PALETTE, shape, pm, scripts } from './suggest.mjs';
import { diagnose, explainEntry, looksLikeCommand, ERRORS } from './errors.mjs';
import { judge, commandQuestion, errorQuestion } from './jev.mjs';
import { list, readPreview, readBook, findEditor, searchFiles } from './files.mjs';
import { createAnalytics, POSTHOG_KEY, POSTHOG_HOST } from './analytics.mjs';
import { newer } from './version.mjs';
import { gitFiles, gitInfo } from './git.mjs';
import * as ai from './claude.mjs';
import { clean, VERSION as SESSION_VERSION } from './session.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
// zsh can't read inside app.asar; point at the unpacked copy when packaged (same path when run with npm start).
const SHELL_DIR = join(HERE, 'shell').replace('app.asar', 'app.asar.unpacked');
const RECENTS = () => join(app.getPath('userData'), 'recents.json');

// FORK_DATA_DIR=/some/empty/dir npm start → a clean first run (onboarding) without touching your real data.
if (process.env.FORK_DATA_DIR) app.setPath('userData', process.env.FORK_DATA_DIR);

// Launched from inside Claude Code? Don't leak its session markers into our shells.
for (const k of Object.keys(process.env)) if (/^(CLAUDECODE|CLAUDE_CODE_|CLAUDE_PID|CLAUDE_EFFORT)/.test(k)) delete process.env[k];

// Opened from Finder or the Dock, the app gets a bare PATH; borrow the login shell's so `claude` resolves.
// Interactive (-i) too, since ~/.zshrc is often where tools add themselves; markers skip anything it prints.
try {
  const out = execFileSync(process.env.SHELL || '/bin/zsh', ['-ilc', 'printf "<<PATH>>%s<<PATH>>" "$PATH"'],
    { encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] });
  const path = out.split('<<PATH>>')[1];
  if (path) process.env.PATH = path;
} catch {} // keep the default PATH

// Every terminal pane is one pty, owned by the window that asked for it.
const ptys = new Map(); // id -> { pty, wc }
let nextId = 1;

function createPty(wc, cwd) {
  const id = nextId++;
  const p = pty.spawn(process.env.SHELL || '/bin/zsh', ['-l'], {
    name: 'xterm-256color', cwd: cwd || homedir(), cols: 100, rows: 30,
    // Our shell/.zshrc loads the user's own config, then adds cwd reporting + safety nets.
    // COLORTERM: apps (OpenCode and anything built with OpenTUI) use full colour only when it says so.
    env: { ...process.env, ZDOTDIR: SHELL_DIR, TERM_PROGRAM: 'Fork', TERM_PROGRAM_VERSION: app.getVersion(), COLORTERM: 'truecolor' },
  });
  p.onData((d) => !wc.isDestroyed() && wc.send('pty:data', id, d));
  p.onExit(() => { ptys.delete(id); if (!wc.isDestroyed()) wc.send('pty:exit', id); }); // `exit` closes the pane
  ptys.set(id, { pty: p, wc });
  return id;
}

// restore: a saved window from session.json (see "Reopen the way you left it" below), or nothing for a fresh one.
function createWindow(restore) {
  const win = new BrowserWindow({
    width: 1200, height: 760, ...(restore?.bounds && onScreen(restore.bounds) ? restore.bounds : {}),
    minWidth: 760, minHeight: 480,
    titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 13, y: 15 }, // centred in the 44px top strip
    backgroundColor: '#00000000', vibrancy: 'sidebar', visualEffectState: 'active',
    webPreferences: { preload: join(HERE, 'preload.cjs'), webviewTag: true }, // <webview> = the preview panel's app view
  });
  const wc = win.webContents;
  // A dropped file or a link in a Markdown preview must never navigate the app itself away.
  wc.on('will-navigate', (e) => e.preventDefault());
  // The app view shows whatever is on localhost: give it no preload and no Node, and only web or file pages.
  wc.on('will-attach-webview', (e, prefs, params) => {
    delete prefs.preload;
    Object.assign(prefs, { nodeIntegration: false, contextIsolation: true, sandbox: true });
    if (params.src && !/^(https?|file|about):/.test(params.src)) e.preventDefault();
  });
  const wcId = wc.id; // wc can't be read once the window is gone
  if (restore) startWith.set(wcId, restore);
  // The last window closing is quitting, so it comes back next time: grab its screens first.
  win.on('close', (e) => {
    if (quitting || gone.has(wcId) || closingLast.has(wcId) || forkWindows().length > 1) return;
    e.preventDefault();
    closingLast.add(wcId);
    collect([wc]).then(() => win.close());
  });
  win.on('closed', () => {
    killPtys(wc);
    // One of several windows closed: that one's done. The last one is kept (see 'close' above), even
    // when it closes some other way, since closing the last window quits Fork.
    const others = forkWindows().some((w) => w !== win && !w.isDestroyed());
    if (!quitting && others) { sessions.delete(wcId); saveSoon(); }
    notchTabs.delete(wcId); sendNotchState();
    if (!others) notchWin?.destroy(); // the notch alone mustn't keep Fork open
  });
  win.loadFile(join(HERE, 'index.html'));
  return win;
}

const killPtys = (wc) => { for (const [id, t] of ptys) if (t.wc === wc) { t.pty.kill(); ptys.delete(id); } };
// Reload Fork (⌘⇧R): save the window's tabs, splits and screens, end its shells, reload, and hand the page
// that state back, like quitting and reopening. Claude resumes; anything still running stops. Restores even
// with "Reopen your tabs" off: that's about launching Fork, not this.
async function reloadWindow(win) {
  if (!win || win.isDestroyed() || win === notchWin) return;
  const wc = win.webContents;
  await collect([wc]);
  killPtys(wc);
  const saved = sessions.get(wc.id);
  if (saved) startWith.set(wc.id, saved);
  wc.reload();
}

// Shortcuts live in the real menu bar, so every one is discoverable by browsing menus.
const toRenderer = (cmd) => () => BrowserWindow.getFocusedWindow()?.webContents.send('cmd', cmd);
function buildMenu() {
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: app.name, submenu: [
      { role: 'about', label: 'About Fork' }, // app.name is still the old package name; renaming it would move everyone's settings
      { label: 'Check for Updates…', click: () => (BrowserWindow.getFocusedWindow() || forkWindows()[0])?.webContents.send('cmd', 'check-update') },
      { type: 'separator' },
      { label: 'Settings…', accelerator: 'Cmd+,', click: toRenderer('settings') },
      { type: 'separator' },
      { role: 'services' },
      { type: 'separator' },
      { role: 'hide', label: 'Hide Fork' }, { role: 'hideOthers' }, { role: 'unhide' },
      { type: 'separator' },
      { role: 'quit', label: 'Quit Fork' },
    ] },
    { label: 'File', submenu: [
      { id: 'new-window', label: 'New Window', accelerator: 'Cmd+N', click: () => createWindow() },
      { label: 'New Tab', accelerator: 'Cmd+T', click: toRenderer('new-tab') },
      { type: 'separator' },
      { label: 'Close', accelerator: 'Cmd+W', click: toRenderer('close') },
    ] },
    { label: 'Edit', submenu: [
      { role: 'undo' }, { role: 'redo' },
      { type: 'separator' },
      { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' },
      { type: 'separator' },
      { label: 'Find…', accelerator: 'Cmd+F', click: toRenderer('find') },
      { label: 'Find Next', accelerator: 'Cmd+G', click: toRenderer('find-next') },
      { label: 'Find Previous', accelerator: 'Cmd+Shift+G', click: toRenderer('find-prev') },
    ] },
    { label: 'Go', submenu: [
      { label: 'Back', accelerator: 'Cmd+[', click: toRenderer('back') },
      { label: 'Forward', accelerator: 'Cmd+]', click: toRenderer('forward') },
    ] },
    { label: 'Panes', submenu: [
      { label: 'Split Right', accelerator: 'Cmd+D', click: toRenderer('split-right') },
      { label: 'Split Down', accelerator: 'Cmd+Shift+D', click: toRenderer('split-down') },
    ] },
    { label: 'Tabs', submenu: [
      { label: 'Next Tab', accelerator: 'Cmd+Shift+]', click: toRenderer('next-tab') },
      { label: 'Previous Tab', accelerator: 'Cmd+Shift+[', click: toRenderer('prev-tab') },
    ] },
    { label: 'View', submenu: [
      { label: 'Toggle Sidebar', accelerator: 'Cmd+B', click: toRenderer('toggle-sidebar') },
      { label: 'Toggle Preview', accelerator: 'Cmd+P', click: toRenderer('toggle-preview') },
      { type: 'separator' },
      { id: 'reload-fork', label: 'Reload Fork', accelerator: 'Cmd+Shift+R', click: () => reloadWindow(BrowserWindow.getFocusedWindow() || forkWindows()[0]) },
      { role: 'toggleDevTools' },
    ] },
    { role: 'windowMenu' },
    { role: 'help', submenu: [
      { label: 'Show the Welcome Tour', click: toRenderer('tour') },
    ] },
  ]));
}

// Ask AI goes through the person's own Claude Code login, kept warm while it's likely to be used (claude.mjs).
const askClaude = ai.ask;
ipcMain.on('ai:warm', () => ai.warm());

ipcMain.handle('pty:create', (e, cwd) => createPty(e.sender, cwd));
ipcMain.on('pty:write', (_, id, d) => ptys.get(id)?.pty.write(d));
ipcMain.on('pty:resize', (_, id, cols, rows) => ptys.get(id)?.pty.resize(cols, rows));
ipcMain.on('pty:kill', (_, id) => { ptys.get(id)?.pty.kill(); ptys.delete(id); });

ipcMain.handle('dir', (_, dir) => ({ entries: list(dir), suggestions: suggest(dir), home: homedir() }));
ipcMain.handle('ls', (_, dir) => list(dir)); // an expanded folder in the sidebar tree
// A workspace's branch and what's changed (git.mjs). null: not a git folder, or no git on this Mac.
// --no-optional-locks: reading status never gets in the way of your own git commands.
const git = (cwd, args) => new Promise((res) =>
  execFile('git', ['--no-optional-locks', '-C', cwd, ...args], { timeout: 2000, maxBuffer: 8 << 20 }, (err, out) => res(err ? null : out)));
// The sidebar's search box (files.mjs searchFiles). A new search stops the one before it.
let finding = null;
ipcMain.handle('files:search', async (_, root, query) => {
  finding?.abort();
  const ac = finding = new AbortController();
  const r = await searchFiles(root, query, { signal: ac.signal }).catch(() => null);
  return ac.signal.aborted ? null : r;
});
ipcMain.handle('git:info', async (_, cwd) => {
  if (typeof cwd !== 'string' || !cwd.startsWith('/')) return null;
  const status = await git(cwd, ['status', '--porcelain', '--branch']);
  return status == null ? null : gitInfo(status, await git(cwd, ['diff', 'HEAD', '--shortstat']));
});
// The Files tree's badges (git.mjs gitFiles): each changed file under cwd, or [] outside a repo.
ipcMain.handle('git:files', async (_, cwd) => {
  if (typeof cwd !== 'string' || !cwd.startsWith('/')) return [];
  const [status, prefix] = await Promise.all([git(cwd, ['status', '--porcelain', '-z', '--untracked-files=all']),
    git(cwd, ['rev-parse', '--show-prefix'])]);
  return status == null ? [] : gitFiles(status, (prefix || '').trim());
});

// The sidebar and preview follow changes Claude makes, without waiting for a `cd`. Each window watches
// the folders it shows. Never recursive: the folder can be ~, and node_modules churns during installs.
const watched = new Map(); // webContents id -> { dirs: Map(dir -> FSWatcher), changed: Set, timer }
ipcMain.on('watch', (e, dirs) => {
  const wc = e.sender;
  let w = watched.get(wc.id);
  if (!w) {
    w = { dirs: new Map(), changed: new Set(), timer: null };
    watched.set(wc.id, w);
    wc.once('destroyed', () => { clearTimeout(w.timer); for (const f of w.dirs.values()) f.close(); watched.delete(wc.id); });
  }
  for (const [d, f] of w.dirs) if (!dirs.includes(d)) { f.close(); w.dirs.delete(d); }
  for (const d of dirs) {
    if (w.dirs.has(d)) continue;
    try {
      const f = watch(d, (_, name) => {
        w.changed.add(name ? join(d, name) : d);
        clearTimeout(w.timer);
        w.timer = setTimeout(() => { if (!wc.isDestroyed()) wc.send('fs:changed', [...w.changed]); w.changed.clear(); }, 150);
      });
      f.on('error', () => { f.close(); w.dirs.delete(d); }); // folder deleted
      w.dirs.set(d, f);
    } catch {} // unreadable or already gone
  }
});

ipcMain.handle('preview', (_, path) => readPreview(path));
let editor; // looked up once
ipcMain.handle('editor', () => (editor ??= findEditor()));
ipcMain.on('open-in', (_, path) => { const ed = editor ?? findEditor(); execFile('open', ed ? ['-a', ed.app, path] : [path]); });
ipcMain.on('reveal', (_, path) => shell.showItemInFolder(path));
// Right-click a file or folder in the sidebar. Resolves with the picked item's id (renderer.js acts on it), or null.
ipcMain.handle('entry:menu', (e, { folder, editor: ed } = {}) => new Promise((res) => {
  const item = (label, id) => ({ label, click: () => res(id) });
  Menu.buildFromTemplate([
    ...(folder ? [item('Open in terminal', 'cd')] : [item('Preview', 'preview'), item('Open with default app', 'default')]),
    ...(ed ? [item(`Open in ${ed}`, 'editor')] : []),
    item('Show in Finder', 'reveal'),
    { type: 'separator' },
    item('Copy path', 'copy'),
    item('Put path in terminal', 'type'),
  ]).popup({ window: BrowserWindow.fromWebContents(e.sender), callback: () => setTimeout(() => res(null), 200) }); // closed without a pick
}));
// FORK_NO_OPEN=1 npm start: print what would open instead of opening it (for testing without a browser popping up).
const opens = (fn) => (process.env.FORK_NO_OPEN ? (x) => console.log('[open]', x) : fn);
const openUrl = opens((url) => shell.openExternal(url)), openPath = opens((path) => shell.openPath(path));
ipcMain.on('open-external', (_, url) => { if (/^https?:\/\//.test(url)) openUrl(url); });
ipcMain.on('open-default', (_, path) => openPath(path)); // the Mac's own app for that kind of file

// An app in the terminal copying to your clipboard (OSC 52, see protocols.js). Text only.
ipcMain.on('clip:write', (_, text) => { if (typeof text === 'string' && text.length <= 1024 * 1024) clipboard.writeText(text); });

// "Done", "needs you", "failed" or "your app is ready", while you're in another app. On a Mac with a notch
// it shows there (see The notch below); otherwise as a Mac notification. Either way the dock icon counts
// them until you come back, and clicking brings you to that terminal (action: what to open there).
let unread = 0;
const shown = new Set(); // a notification that's garbage-collected forgets its click
const KINDS = ['done', 'failed', 'app'];
ipcMain.on('notify', (e, { kind, title, body, pane, url, alerts = true, silent = false } = {}) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  if (!win || win.isFocused()) return;
  const m = { kind: KINDS.includes(kind) ? kind : 'done', title: String(title || 'Fork').slice(0, 120), body: String(body || '').slice(0, 300),
    pane, url: typeof url === 'string' ? url.slice(0, 300) : undefined, win: e.sender.id };
  if (notchShowing()) notchWin.webContents.send('notch:moment', m);
  else if (alerts && Notification.isSupported()) {
    const n = new Notification({ title: m.title, body: m.body, silent: !!silent }); // silent: Fork chimed itself
    shown.add(n);
    n.on('click', () => { shown.delete(n); goTo(m); });
    n.on('close', () => shown.delete(n));
    n.show();
  }
  if (alerts) app.dock?.setBadge(String(++unread));
});
// Bring that window forward, on that pane. action 'failed' opens "What went wrong?", 'app' shows the app.
function goTo({ win, pane, kind }) {
  const wc = webContents.fromId(win), w = wc && BrowserWindow.fromWebContents(wc);
  if (!w || w.isDestroyed()) return;
  w.show(); w.focus(); app.focus({ steal: true });
  wc.send('go-pane', pane, kind === 'failed' || kind === 'app' ? kind : null);
}
app.on('browser-window-focus', () => { unread = 0; app.dock?.setBadge(''); });

// --- The notch: what your terminals are doing, while you're in another app (notch.html) -------------
// Only on a Mac with a notch, only while Fork isn't in front. A see-through window sits over the notch
// and grows a black shape out of it. Each Fork window sends its tabs (notch:state); moments come from
// `notify` above. Settings → Notifications turns it off (notch:setting).
const NOTCH_W = 185; // Electron can't read the notch's width; it's about this on every MacBook that has one
const NOTCH_BOX = { width: 420, height: 380 }; // room for the biggest shape: the list of tabs
let notchWin = null, notchOn = false, forkActive = true; // off until the window says you turned it on
const notchTabs = new Map(); // webContents id -> that window's tabs
const forkWindows = () => BrowserWindow.getAllWindows().filter((w) => w !== notchWin);
// The built-in screen, if it has a notch: the menu bar there is taller (about 32pt, against 24).
function notchScreen() {
  const d = screen.getAllDisplays().find((x) => x.internal);
  const bar = d ? d.workArea.y - d.bounds.y : 0;
  return d && bar >= 30 ? { d, bar } : null;
}
// Screens report changes often (the Dock hiding, the menu bar, app switching): rebuild only when the
// notch itself moved or went, since every rebuild costs a new window.
let notchKey = null;
function makeNotch() {
  const n = notchScreen();
  const bounds = n && { ...NOTCH_BOX, x: Math.round(n.d.bounds.x + (n.d.bounds.width - NOTCH_BOX.width) / 2), y: n.d.bounds.y };
  const key = n && `${n.d.id}:${bounds.x}:${bounds.y}:${n.bar}`;
  if (notchWin && key === notchKey) return;
  notchWin?.destroy();
  notchWin = null;
  notchKey = key;
  if (!n) return;
  const w = new BrowserWindow({
    ...bounds, type: 'panel', frame: false, transparent: true, backgroundColor: '#00000000', hasShadow: false,
    resizable: false, movable: false, minimizable: false, maximizable: false, fullscreenable: false,
    focusable: false, skipTaskbar: true, show: false, enableLargerThanScreen: true, // allowed over the menu bar
    webPreferences: { preload: join(HERE, 'notch-preload.cjs') },
  });
  w.setAlwaysOnTop(true, 'screen-saver');
  // skipTransformProcessType: without it, Electron briefly turns Fork into a background app on every
  // call, hiding all its windows and its Dock icon. A panel floats over full-screen apps without that.
  w.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true });
  w.setHiddenInMissionControl(true); // it's part of the notch, not a window: Mission Control and App Exposé leave it out
  w.setIgnoreMouseEvents(true, { forward: true }); // clicks go through, except over the shape (notch:mouse)
  w.setBounds(bounds); // macOS may have nudged it below the menu bar
  w.webContents.on('will-navigate', (e) => e.preventDefault());
  w.webContents.once('did-finish-load', sendNotchState);
  w.on('closed', () => { if (notchWin === w) notchWin = null; });
  w.loadFile(join(HERE, 'notch.html'), { query: { w: String(NOTCH_W), h: String(n.bar) } });
  notchWin = w;
  syncNotch();
}
const notchShowing = () => !!notchWin && notchOn && !forkActive;
function syncNotch() {
  if (!notchWin) return;
  if (notchShowing()) notchWin.showInactive();
  else notchWin.hide();
}
function sendNotchState() {
  if (!notchWin) return;
  const tabs = [...notchTabs].flatMap(([win, ts]) => ts.map((t) => ({ ...t, win })));
  notchWin.webContents.send('notch:state', tabs);
}
app.on('did-become-active', () => { forkActive = true; syncNotch(); });
app.on('did-resign-active', () => { forkActive = false; syncNotch(); });
ipcMain.on('notch:state', (e, tabs) => { notchTabs.set(e.sender.id, Array.isArray(tabs) ? tabs.slice(0, 40) : []); sendNotchState(); });
ipcMain.on('notch:mouse', (_, over) => notchWin?.setIgnoreMouseEvents(!over, { forward: true }));
ipcMain.on('notch:go', (_, t) => { if (t) { goTo(t); usage.track('notch_clicked', { kind: String(t.kind || '') }); } });
// No argument: is there a notch, and is it on? Settings shows its switch only when there's a notch.
ipcMain.handle('notch:setting', (_, on) => {
  if (typeof on === 'boolean') { notchOn = on; syncNotch(); }
  return { has: !!notchScreen(), on: notchOn };
});

ipcMain.handle('palette', () => PALETTE);
// Settings → Appearance ('light', 'dark' or 'system'). The sidebar's frosted glass follows it, and with
// 'system' the page's prefers-color-scheme tracks macOS, which is how System swaps themes.
ipcMain.on('appearance', (_, mode) => { if (['light', 'dark', 'system'].includes(mode)) nativeTheme.themeSource = mode; });

ipcMain.handle('book:read', (_, path) => readBook(path));
ipcMain.handle('book:pick', async (e) => {
  const r = await dialog.showOpenDialog(BrowserWindow.fromWebContents(e.sender), {
    title: 'Open a book', buttonLabel: 'Read', properties: ['openFile'], filters: [{ name: 'Books', extensions: ['pdf', 'epub'] }] });
  return r.canceled ? null : r.filePaths[0];
});
ipcMain.handle('pick-folder', async (e) => {
  const r = await dialog.showOpenDialog(BrowserWindow.fromWebContents(e.sender), { properties: ['openDirectory', 'createDirectory'] });
  return r.canceled ? null : r.filePaths[0];
});

ipcMain.handle('recents', (_, add) => {
  let list = [];
  try { list = JSON.parse(readFileSync(RECENTS(), 'utf8')); } catch {}
  if (add) {
    list = [add, ...list.filter((p) => p !== add)].slice(0, 6);
    writeFileSync(RECENTS(), JSON.stringify(list));
  }
  return list;
});

ipcMain.handle('ask', async (_, request, cwd) => {
  const lines = await askClaude(
    "You turn a designer's request into ONE macOS zsh command. They are new to the terminal. " +
    'Reply with exactly two lines, no code fences. Line 1: the command. ' +
    'Line 2: what it does in plain English, under 15 words. If it is not a terminal task, line 1 is NONE.',
    `Current folder: ${cwd}\nRequest: ${request}`);
  if (!lines || !lines[0] || lines[0] === 'NONE') return null;
  return { cmd: lines[0], why: lines[1] || '' };
});

// "What went wrong?": Fork's own library of common errors first (errors.mjs), instant and offline.
// null = not one Fork knows; the person can then ask Claude (explain:ai).
const onPath = (bin) => (process.env.PATH || '').split(':').some((d) => d && existsSync(join(d, bin)));
function errorContext(cwd) {
  const dir = cwd && isDir(cwd) ? cwd : homedir();
  return { pm: pm(dir), scripts: Object.keys(scripts(dir)), hasNodeModules: existsSync(join(dir, 'node_modules')),
    nvmrc: existsSync(join(dir, '.nvmrc')), hasBrew: onPath('brew'), hasGh: onPath('gh') };
}
// Jev (jev.mjs) only when the person acts and Smarter matching is on (smart, from the page's settings).
const jevLog = app.isPackaged ? () => {} : console.log;
const COMMAND_Q = commandQuestion(PALETTE.map((p) => ({ ...p, cmd: shape(p) }))), ERROR_Q = errorQuestion(ERRORS, (id) => explainEntry(id).text);
// 1. Fork's library (instant). 2. Jev picks the closest known error, shown in Fork's own words. 3. null: "unusual".
ipcMain.handle('explain', async (_, output, cwd, smart) => {
  const ctx = errorContext(cwd);
  // macOS keeping Fork out of this folder (Downloads, Desktop…) makes tools fail in vague ways
  // ("An unknown error occurred"), so check the folder itself before reading the output.
  const hit = (cwd && blockedByMac(cwd) && explainEntry('mac-privacy', ctx)) || diagnose(output, ctx);
  if (hit) return { ...hit, source: 'fork' };
  if (!smart) return null;
  const a = await judge({ terminal_output: String(output).slice(-4000) }, ERROR_Q, jevLog);
  const r = a && a.choice !== 'none' && a.confidence >= 0.6 ? explainEntry(a.choice, ctx) : null;
  return r && { ...r, source: 'jev' };
});
// ⌘K: which built-in command does this plain-English request mean? A label from PALETTE, or null.
ipcMain.handle('palette:match', async (_, text) => {
  const a = await judge({ request: String(text).slice(0, 300) }, COMMAND_Q, jevLog);
  return a && a.choice !== 'none' && a.confidence >= 0.45 ? a.choice : null;
});
ipcMain.handle('explain:ai', async (_, output, cwd) => {
  const lines = await askClaude(
    'A designer new to the terminal ran a command and it failed. In at most 2 short, friendly sentences, ' +
    'explain what went wrong in plain English. Be direct: no jargon, no filler. Then a final line starting with "FIX: " followed by ' +
    'ONE command that fixes it, or "FIX: none". No code fences.',
    `Current folder: ${cwd}\nTerminal output:\n${output}`);
  if (!lines) return { text: "Couldn't reach Claude. To log in, open a new tab and type claude.", fix: null, failed: true };
  const fixLine = lines.findLast((l) => l.startsWith('FIX:'));
  const fix = fixLine?.slice(4).trim();
  return { text: lines.filter((l) => l !== fixLine).join(' '), fix: fix !== 'none' && looksLikeCommand(fix) ? fix : null }; // never type a sentence
});

// --- Reopen the way you left it (session.mjs) ------------------------------------------------------
// Each window sends its tabs, splits and folders about a second after they change; main writes
// session.json (on this Mac only) shortly after, so even a crash loses little. Quitting, or closing the
// last window, also collects every pane's screen. Closing the last tab is "I'm done": that window is forgotten.
const SESSION = () => join(app.getPath('userData'), 'session.json');
const sessions = new Map(); // webContents id -> that window's latest state
const startWith = new Map(); // webContents id -> saved state it restores, handed over once
const gone = new Set(), closingLast = new Set();
let sessionOn = true, quitting = false, writeTimer;
const isDir = (p) => { try { return statSync(p).isDirectory(); } catch { return false; } };
// macOS's privacy protection (Downloads, Desktop, Documents…) says EPERM; a missing folder says ENOENT.
const blockedByMac = (p) => { try { opendirSync(p).closeSync(); return false; } catch (e) { return e.code === 'EPERM'; } };
// The saved folders are checked off the main thread: the first look inside Downloads, Desktop or
// Documents waits for macOS's "allow access" prompt, and a sync check froze Fork until it was answered.
async function readSession() {
  let raw = null;
  try { raw = JSON.parse(readFileSync(SESSION(), 'utf8')); } catch {} // none yet, or damaged: start fresh
  const dirs = new Set();
  clean(raw, { exists: (p) => dirs.add(p), home: homedir() }); // collect them first
  const ok = new Set();
  await Promise.all([...dirs].map((d) => stat(d).then((s) => s.isDirectory() && ok.add(d), () => {})));
  return clean(raw, { exists: (p) => ok.has(p), home: homedir() });
}
function writeSession() {
  clearTimeout(writeTimer);
  const data = { v: SESSION_VERSION, enabled: sessionOn, savedAt: Date.now(), windows: [...sessions.values()] };
  try { writeFileSync(SESSION(), JSON.stringify(data)); chmodSync(SESSION(), 0o600); } catch {} // it can hold terminal output: yours only
}
const saveSoon = () => { clearTimeout(writeTimer); writeTimer = setTimeout(writeSession, 2000); };
// Saved bounds from a screen that's since been unplugged would open the window out of sight.
const onScreen = (b) => screen.getAllDisplays().some(({ workArea: a }) =>
  b.x < a.x + a.width - 100 && b.x + b.width > a.x + 100 && b.y < a.y + a.height - 50 && b.y + b.height > a.y);
function store(wc, state) {
  if (gone.has(wc.id) || !state) return;
  const win = BrowserWindow.fromWebContents(wc);
  sessions.set(wc.id, { ...state, bounds: win && !win.isDestroyed() ? win.getNormalBounds() : sessions.get(wc.id)?.bounds });
}
ipcMain.handle('session:start', (e) => { const s = startWith.get(e.sender.id); startWith.delete(e.sender.id); return s || null; });
ipcMain.on('session:save', (e, state) => { if (quitting) return; store(e.sender, state); saveSoon(); });
ipcMain.handle('session:forget', (e) => { gone.add(e.sender.id); sessions.delete(e.sender.id); saveSoon(); });
ipcMain.handle('session:enabled', (_, on) => {
  if (typeof on === 'boolean') { sessionOn = on; writeSession(); }
  return sessionOn;
});
// Ask windows for everything, screens included; give each at most a second.
const waiting = new Map();
ipcMain.on('session:full', (e, state) => { store(e.sender, state); waiting.get(e.sender.id)?.(); });
const collect = (wcs) => Promise.all(wcs.filter((wc) => !gone.has(wc.id)).map((wc) => new Promise((done) => {
  const t = setTimeout(done, 1000);
  waiting.set(wc.id, () => { clearTimeout(t); waiting.delete(wc.id); done(); });
  wc.send('session:collect');
}))).then(writeSession);

// --- Updates: downloaded quietly, installed on quit or from the pill's Restart now ----------------
// electron-updater reads latest-mac.yml on the latest GitHub release, downloads the zip in the background,
// and Squirrel.Mac checks it's signed by the same team and swaps it in. It can only do that to a Fork in
// Applications, so anywhere else (opened from the DMG, say), or if the updater fails, it's the
// old way: the pill offers the newest release and install.sh replaces the app.
// FORK_UPDATE_URL=http://localhost:8000 serves updates from a local folder instead, from wherever Fork is: for testing.
const REPO = 'harshii0509/Fork';
async function release(which) {
  try {
    const r = await fetch(`https://api.github.com/repos/${REPO}/releases/${which}`, { signal: AbortSignal.timeout(10_000) });
    if (!r.ok) return null;
    const j = await r.json();
    return { version: j.tag_name.replace(/^v/, ''), notes: marked.parse(j.body || '') };
  } catch { return null; } // offline: say nothing
}
// npm run app builds have no app-update.yml (electron-builder only writes it for the DMG/zip), so they use the old way.
const inPlace = app.isPackaged && existsSync(join(process.resourcesPath, 'app-update.yml'))
  && (app.isInApplicationsFolder() || !!process.env.FORK_UPDATE_URL);
const autoUpdater = inPlace ? updater.autoUpdater : null; // only touched in an installed Fork
let ready = null, failed = false, lastCheck = 0; // ready: the downloaded update, waiting for a restart
if (inPlace) {
  Object.assign(autoUpdater, { autoDownload: true, autoInstallOnAppQuit: true, allowPrerelease: false, channel: 'latest', logger: null });
  if (process.env.FORK_UPDATE_URL) autoUpdater.setFeedURL({ provider: 'generic', url: process.env.FORK_UPDATE_URL });
  autoUpdater.on('update-available', () => { failed = false; });
  autoUpdater.on('update-not-available', () => { failed = false; });
  autoUpdater.on('error', () => { failed = true; }); // offline, or something worse: the pill falls back to install.sh
  autoUpdater.on('update-downloaded', async ({ version }) => {
    ready = { version, notes: (await release(`tags/v${version}`))?.notes || '', ready: true };
    for (const w of forkWindows()) w.webContents.send('update:ready');
  });
}
let latest = { at: 0, p: null }; // one check an hour, however many windows ask
ipcMain.handle('update:check', async () => {
  if (!app.isPackaged) return null; // npm start
  if (ready) return ready;
  if (inPlace && Date.now() - lastCheck > 3600_000) { lastCheck = Date.now(); autoUpdater.checkForUpdates().catch(() => {}); }
  if (inPlace && !failed) return null; // the pill shows once it's downloaded (update:ready)
  if (Date.now() - latest.at > 3600_000) latest = { at: Date.now(), p: release('latest') };
  const r = await latest.p;
  if (!r) latest.at = 0; // failed: try again next time
  return r && newer(r.version, app.getVersion()) ? { ...r, ready: false } : null;
});
// Check for Updates… in the Fork menu: ask now, not at the next hourly check, and say what was found.
// state: ready (downloaded), downloading, out (the old way's Update and restart), current, offline, dev.
ipcMain.handle('update:check-now', async () => {
  if (!app.isPackaged) return { state: 'dev' };
  if (ready) return { state: 'ready', ...ready };
  const notes = async (v) => (await release(`tags/v${v}`))?.notes || '';
  if (inPlace) {
    lastCheck = Date.now();
    try {
      const r = await autoUpdater.checkForUpdates();
      failed = false;
      if (ready) return { state: 'ready', ...ready }; // it was quick
      const v = r?.updateInfo?.version;
      return r?.isUpdateAvailable && v ? { state: 'downloading', version: v, notes: await notes(v) } : { state: 'current', version: app.getVersion() };
    } catch { failed = true; } // offline, or the updater broke: try the old way below
  }
  latest = { at: Date.now(), p: release('latest') };
  const r = await latest.p;
  if (!r) { latest.at = 0; return { state: 'offline' }; }
  return newer(r.version, app.getVersion()) ? { state: 'out', ...r, ready: false } : { state: 'current', version: app.getVersion() };
});
ipcMain.handle('update:notes', () => release(`tags/v${app.getVersion()}`));
ipcMain.handle('version', () => app.getVersion());
// Restart now: save the tabs first (Squirrel closes the windows before Fork's usual before-quit), then swap and reopen.
// The old way: once Fork has quit, install.sh swaps in the latest Fork.app and opens it. If the download fails, reopen this one.
ipcMain.on('update:install', () => {
  if (ready) return void wrapUp().then(() => autoUpdater.quitAndInstall());
  spawn('/bin/bash', ['-c', `while kill -0 ${process.pid} 2>/dev/null; do sleep 0.2; done
    s=$(curl -fsSL https://raw.githubusercontent.com/${REPO}/main/install.sh) && bash -c "$s" || open -b com.forkterminal.app`],
  { detached: true, stdio: 'ignore' }).unref();
  app.quit();
});

// --- Anonymous usage (analytics.mjs): what gets used, never what's in it ------------------------
// npm start prints each event and never sends (FORK_ANALYTICS=1 to send for real while testing).
const SEND = (app.isPackaged || process.env.FORK_ANALYTICS === '1') && !!POSTHOG_KEY;
const usage = createAnalytics({
  dir: app.getPath('userData'),
  props: { app_version: app.getVersion(), os_version: process.getSystemVersion(), arch: process.arch, $lib: 'fork' },
  async send(batch) {
    if (!app.isPackaged) for (const e of batch) console.log('[usage]', e.event, JSON.stringify(e.properties));
    if (!SEND) return;
    const r = await fetch(`${POSTHOG_HOST}/batch/`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ api_key: POSTHOG_KEY, batch }), signal: AbortSignal.timeout(10_000) });
    if (!app.isPackaged) console.log('[usage] sent to PostHog:', r.status);
  },
});
ipcMain.on('track', (_, event, props) => usage.track(event, props));
ipcMain.handle('analytics', (_, on) => (typeof on === 'boolean' ? usage.setOn(on) : usage.isOn()));
setInterval(() => usage.flush(), app.isPackaged ? 30_000 : 2_000);
const openedAt = Date.now();
let wrapping = null, wrapped = false;
function wrapUp() { // save the session and send what's left, never holding up quitting for long. Runs once.
  quitting = true;
  return wrapping ??= (usage.track('app_closed', { minutes_open: Math.round((Date.now() - openedAt) / 60_000) }),
    collect(forkWindows().map((w) => w.webContents))
      .then(() => Promise.race([usage.flush(), new Promise((r) => setTimeout(r, 2000))]))
      .then(() => { wrapped = true; }));
}
app.on('before-quit', (e) => {
  if (wrapped) return;
  e.preventDefault();
  wrapUp().then(() => app.quit());
});

app.on('will-quit', ai.stop); // never leave a Claude running after Fork quits

app.whenReady().then(async () => {
  app.setAboutPanelOptions({ applicationName: 'Fork', applicationVersion: app.getVersion(), version: '' });
  nativeTheme.themeSource = 'system'; // until the window applies its saved appearance
  buildMenu();
  const saved = await readSession();
  sessionOn = saved.enabled;
  if (sessionOn && saved.windows.length) for (const w of saved.windows) createWindow({ ...w, savedAt: saved.savedAt });
  else createWindow();
  makeNotch();
  // A screen plugged in, the lid closed, the resolution changed: find the notch again.
  let screenTimer;
  const screenChanged = () => { clearTimeout(screenTimer); screenTimer = setTimeout(makeNotch, 300); };
  for (const ev of ['display-added', 'display-removed', 'display-metrics-changed']) screen.on(ev, screenChanged);
  usage.track('app_opened', { first_launch: usage.firstLaunch });
});
// Links in the app view that open a new window (target=_blank) go to the real browser.
app.on('web-contents-created', (_, c) => {
  if (c.getType() !== 'webview') return;
  c.setWindowOpenHandler(({ url }) => { if (/^https?:\/\//.test(url)) shell.openExternal(url); return { action: 'deny' }; });
});
app.on('activate', () => { if (!forkWindows().length) createWindow(); });
app.on('window-all-closed', () => app.quit());
