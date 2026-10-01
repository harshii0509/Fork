// The notch window's only link to main.js: it hears tab states and moments, and can say where to go.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('notch', {
  onState: (fn) => ipcRenderer.on('notch:state', (_, tabs) => fn(tabs)),
  onMoment: (fn) => ipcRenderer.on('notch:moment', (_, m) => fn(m)),
  mouse: (over) => ipcRenderer.send('notch:mouse', over), // the cursor is over the shape: take clicks there
  go: (target) => ipcRenderer.send('notch:go', target), // { win, pane, action, url, kind }
});
