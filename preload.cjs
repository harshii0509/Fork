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
  pathOf: (file) => webUtils.getPathForFile(file), // a file dropped from Finder

  palette: () => ipcRenderer.invoke('palette'),
  pickFolder: () => ipcRenderer.invoke('pick-folder'),
  recents: (add) => ipcRenderer.invoke('recents', add),
  ask: (request, cwd) => ipcRenderer.invoke('ask', request, cwd),
  appearance: (dark) => ipcRenderer.send('appearance', dark),
  explain: (output, cwd) => ipcRenderer.invoke('explain', output, cwd),

  version: () => ipcRenderer.invoke('version'),
  updateCheck: () => ipcRenderer.invoke('update:check'),
  updateNotes: () => ipcRenderer.invoke('update:notes'), // this version's release notes
  updateInstall: () => ipcRenderer.send('update:install'),

  track: (event, props) => ipcRenderer.send('track', event, props), // anonymous usage, see analytics.mjs
  analytics: (on) => ipcRenderer.invoke('analytics', on), // no argument: is it on?
});
