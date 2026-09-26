import { app, BrowserWindow, ipcMain, dialog, nativeTheme, Menu, shell } from 'electron';
import { execFile, execFileSync, spawn } from 'node:child_process';
import { readFileSync, watch, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pty from 'node-pty';
import { marked } from 'marked';
import { suggest, PALETTE } from './suggest.mjs';
import { list, readPreview, findEditor } from './files.mjs';
import { createAnalytics, POSTHOG_KEY, POSTHOG_HOST } from './analytics.mjs';
import { newer } from './version.mjs';

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
    env: { ...process.env, ZDOTDIR: SHELL_DIR, TERM_PROGRAM: 'Fork' },
  });
  p.onData((d) => !wc.isDestroyed() && wc.send('pty:data', id, d));
  p.onExit(() => { ptys.delete(id); if (!wc.isDestroyed()) wc.send('pty:exit', id); }); // `exit` closes the pane
  ptys.set(id, { pty: p, wc });
  return id;
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1200, height: 760, minWidth: 760, minHeight: 480,
    titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 13, y: 15 }, // centred in the 44px top row
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
  win.on('closed', () => {
    for (const [id, t] of ptys) if (t.wc === wc) { t.pty.kill(); ptys.delete(id); }
  });
  win.loadFile(join(HERE, 'index.html'));
  return win;
}

// Shortcuts live in the real menu bar, so every one is discoverable by browsing menus.
const toRenderer = (cmd) => () => BrowserWindow.getFocusedWindow()?.webContents.send('cmd', cmd);
function buildMenu() {
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: app.name, submenu: [
      { role: 'about' },
      { type: 'separator' },
      { label: 'Settings…', accelerator: 'Cmd+,', click: toRenderer('settings') },
      { type: 'separator' },
      { role: 'services' },
      { type: 'separator' },
      { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' },
      { type: 'separator' },
      { role: 'quit' },
    ] },
    { label: 'File', submenu: [
      { id: 'new-window', label: 'New Window', accelerator: 'Cmd+N', click: () => createWindow() },
      { label: 'New Tab', accelerator: 'Cmd+T', click: toRenderer('new-tab') },
      { type: 'separator' },
      { label: 'Close', accelerator: 'Cmd+W', click: toRenderer('close') },
    ] },
    { role: 'editMenu' },
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
      { role: 'reload' }, { role: 'toggleDevTools' },
    ] },
    { role: 'windowMenu' },
    { role: 'help', submenu: [
      { label: 'Show the Welcome Tour', click: toRenderer('tour') },
    ] },
  ]));
}

// ponytail: shells out to Claude Code so designers reuse their existing login (~6s).
// Swap for a direct Haiku API call (~1s) if the wait hurts in testing.
function askClaude(system, prompt) {
  return new Promise((resolve) => {
    execFile('claude', ['-p', '--model', 'haiku', '--tools', '', '--no-session-persistence',
      '--setting-sources', '', '--system-prompt', system, prompt],
    { cwd: tmpdir(), timeout: 60_000 }, (err, out) =>
      resolve(err ? null : out.replace(/```\w*/g, '').trim().split('\n').map((l) => l.trim()).filter(Boolean)));
  });
}

ipcMain.handle('pty:create', (e, cwd) => createPty(e.sender, cwd));
ipcMain.on('pty:write', (_, id, d) => ptys.get(id)?.pty.write(d));
ipcMain.on('pty:resize', (_, id, cols, rows) => ptys.get(id)?.pty.resize(cols, rows));
ipcMain.on('pty:kill', (_, id) => { ptys.get(id)?.pty.kill(); ptys.delete(id); });

ipcMain.handle('dir', (_, dir) => ({ entries: list(dir), suggestions: suggest(dir), home: homedir() }));
ipcMain.handle('ls', (_, dir) => list(dir)); // an expanded folder in the sidebar tree

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
ipcMain.on('open-external', (_, url) => { if (/^https?:\/\//.test(url)) shell.openExternal(url); });

ipcMain.handle('palette', () => PALETTE);
// Settings → Appearance ('light', 'dark' or 'system'). The sidebar's frosted glass follows it, and with
// 'system' the page's prefers-color-scheme tracks macOS, which is how System swaps themes.
ipcMain.on('appearance', (_, mode) => { if (['light', 'dark', 'system'].includes(mode)) nativeTheme.themeSource = mode; });

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

ipcMain.handle('explain', async (_, output, cwd) => {
  const lines = await askClaude(
    'A designer new to the terminal ran a command and it failed. In at most 2 short, friendly sentences, ' +
    'explain what went wrong in plain English. Be direct: no jargon, no filler. Then a final line starting with "FIX: " followed by ' +
    'ONE command that fixes it, or "FIX: none". No code fences.',
    `Current folder: ${cwd}\nTerminal output:\n${output}`);
  if (!lines) return { text: "Couldn't reach Claude. Check you are logged in (run: claude).", fix: null };
  const fixLine = lines.findLast((l) => l.startsWith('FIX:'));
  const fix = fixLine?.slice(4).trim();
  return { text: lines.filter((l) => l !== fixLine).join(' '), fix: fix && fix !== 'none' ? fix : null };
});

// --- Updates: a pill when GitHub has a newer release; Update reruns install.sh ------------------
// ponytail: not electron-updater, because Squirrel.Mac won't update an ad-hoc signed app. Swap once notarized.
const REPO = 'harshii0509/Fork';
async function release(which) {
  try {
    const r = await fetch(`https://api.github.com/repos/${REPO}/releases/${which}`, { signal: AbortSignal.timeout(10_000) });
    if (!r.ok) return null;
    const j = await r.json();
    return { version: j.tag_name.replace(/^v/, ''), notes: marked.parse(j.body || '') };
  } catch { return null; } // offline: say nothing
}
let latest = { at: 0, p: null }; // one GitHub call an hour, however many windows ask
ipcMain.handle('update:check', async () => {
  if (!app.isPackaged) return null; // npm start
  if (Date.now() - latest.at > 3600_000) latest = { at: Date.now(), p: release('latest') };
  const r = await latest.p;
  if (!r) latest.at = 0; // failed: try again next time
  return r && newer(r.version, app.getVersion()) ? r : null;
});
ipcMain.handle('update:notes', () => release(`tags/v${app.getVersion()}`));
ipcMain.handle('version', () => app.getVersion());
// Once Fork has quit, install.sh swaps in the latest Fork.app and opens it. If the download fails, reopen this one.
ipcMain.on('update:install', () => {
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
let flushed = false;
app.on('before-quit', (e) => { // send what's left, but never hold up quitting for more than 2s
  if (flushed) return;
  flushed = true;
  e.preventDefault();
  usage.track('app_closed', { minutes_open: Math.round((Date.now() - openedAt) / 60_000) });
  Promise.race([usage.flush(), new Promise((r) => setTimeout(r, 2000))]).then(() => app.quit());
});

app.whenReady().then(() => {
  nativeTheme.themeSource = 'system'; // until the window applies its saved appearance
  buildMenu();
  createWindow();
  usage.track('app_opened', { first_launch: usage.firstLaunch });
});
// Links in the app view that open a new window (target=_blank) go to the real browser.
app.on('web-contents-created', (_, c) => {
  if (c.getType() !== 'webview') return;
  c.setWindowOpenHandler(({ url }) => { if (/^https?:\/\//.test(url)) shell.openExternal(url); return { action: 'deny' }; });
});
app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createWindow(); });
app.on('window-all-closed', () => app.quit());
