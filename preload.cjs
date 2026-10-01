const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('dt', {
  create: (cwd) => ipcRenderer.invoke('pty:create', cwd),
  write: (id, d) => ipcRenderer.send('pty:write', id, d),
  resize: (id, cols, rows) => ipcRenderer.send('pty:resize', id, cols, rows),
  kill: (id) => ipcRenderer.send('pty:kill', id),
  onData: (fn) => ipcRenderer.on('pty:data', (_, id, d) => fn(id, d)),
  onExit: (fn) => ipcRenderer.on('pty:exit', (_, id) => fn(id)),
  onCmd: (fn) => ipcRenderer.on('cmd', (_, cmd) => fn(cmd)),
  dir: (path) => ipcRenderer.invoke('dir', path),
  ls: (path) => ipcRenderer.invoke('ls', path),
  watch: (dirs) => ipcRenderer.send('watch', dirs),
  onFsChanged: (fn) => ipcRenderer.on('fs:changed', (_, paths) => fn(paths)),
  preview: (path) => ipcRenderer.invoke('preview', path),
  editor: () => ipcRenderer.invoke('editor'),
  openIn: (path) => ipcRenderer.send('open-in', path),
  reveal: (path) => ipcRenderer.send('reveal', path),
  openExternal: (url) => ipcRenderer.send('open-external', url),
  openDefault: (path) => ipcRenderer.send('open-default', path), // in whatever app the Mac uses for that file
  clipWrite: (text) => ipcRenderer.send('clip:write', text), // an app copying to your clipboard (OSC 52)
  notify: (n) => ipcRenderer.send('notify', n), // { title, body, pane }: shown only while Fork isn't in front
  onGoPane: (fn) => ipcRenderer.on('go-pane', (_, id, action) => fn(id, action)), // a notification or the notch was clicked
  notchState: (tabs) => ipcRenderer.send('notch:state', tabs), // every tab's state, for the notch (main.js)
  notchSetting: (on) => ipcRenderer.invoke('notch:setting', on), // no argument: { has, on }
  pathOf: (file) => webUtils.getPathForFile(file), // a file dropped from Finder
  readBook: (path) => ipcRenderer.invoke('book:read', path), // { bytes } or { error: kind | missing | big }
  pickBook: () => ipcRenderer.invoke('book:pick'), // a .pdf or .epub path, or null

  palette: () => ipcRenderer.invoke('palette'),
  pickFolder: () => ipcRenderer.invoke('pick-folder'),
  recents: (add) => ipcRenderer.invoke('recents', add),
  ask: (request, cwd) => ipcRenderer.invoke('ask', request, cwd),
  aiWarm: () => ipcRenderer.send('ai:warm'), // get Claude ready for Ask AI (nothing is sent)
  appearance: (dark) => ipcRenderer.send('appearance', dark),
  explain: (output, cwd, smart) => ipcRenderer.invoke('explain', output, cwd, smart), // Fork's library (errors.mjs), then Jev if smart; or null
  paletteMatch: (text) => ipcRenderer.invoke('palette:match', text), // Jev: the ⌘K preset this request means, or null
  explainAI: (output, cwd) => ipcRenderer.invoke('explain:ai', output, cwd), // ask Claude

  version: () => ipcRenderer.invoke('version'),
  updateCheck: () => ipcRenderer.invoke('update:check'),
  updateNotes: () => ipcRenderer.invoke('update:notes'), // this version's release notes
  updateInstall: () => ipcRenderer.send('update:install'),

  // Reopen the way you left it (session.mjs, main.js)
  sessionStart: () => ipcRenderer.invoke('session:start'), // this window's saved state, or null
  sessionSave: (state) => ipcRenderer.send('session:save', state),
  sessionForget: () => ipcRenderer.invoke('session:forget'), // closed every tab: start fresh next time
  sessionEnabled: (on) => ipcRenderer.invoke('session:enabled', on), // no argument: is it on?
  onSessionCollect: (fn) => ipcRenderer.on('session:collect', () => ipcRenderer.send('session:full', fn())),

  track: (event, props) => ipcRenderer.send('track', event, props), // anonymous usage, see analytics.mjs
  analytics: (on) => ipcRenderer.invoke('analytics', on), // no argument: is it on?
});
