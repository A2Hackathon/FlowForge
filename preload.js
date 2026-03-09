// preload.js
// ─────────────────────────────────────────────────────────────
// This runs in a "middle zone" between Electron's Node.js world
// and the React browser world. It is the ONLY place where the
// two worlds can safely talk to each other.
//
// contextBridge.exposeInMainWorld() creates a window.api object
// inside React. React calls window.api.login() etc., which this
// file forwards to ipcHandlers.js in the main process via IPC.
//
// React can never call require('electron') directly — this file
// is the controlled gateway.
// ─────────────────────────────────────────────────────────────

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {

  // ── AUTH ────────────────────────────────────────────────────
  login:     ()       => ipcRenderer.invoke('auth:login'),
  checkAuth: ()       => ipcRenderer.invoke('auth:check'),
  logout:    ()       => ipcRenderer.invoke('auth:logout'),
  getUser:   ()       => ipcRenderer.invoke('auth:getUser'),

  // ── REPOSITORIES ────────────────────────────────────────────
  listRepos:   (params) => ipcRenderer.invoke('repos:list',   params),
  searchRepos: (params) => ipcRenderer.invoke('repos:search', params),

  // ── SCANNER ─────────────────────────────────────────────────
  scanRepo: (params) => ipcRenderer.invoke('scanner:scan', params),

  // Push listener — backend sends progress messages during scanning.
  // React: const cleanup = window.api.onScanProgress(msg => setStatus(msg))
  // Call cleanup() when the component unmounts to avoid memory leaks.
  onScanProgress: (callback) => {
    const listener = (_event, data) => callback(data);
    ipcRenderer.on('scanner:progress', listener);
    return () => ipcRenderer.removeListener('scanner:progress', listener);
  },

  // ── ARCHITECTURE ────────────────────────────────────────────
  generateGraph: (params) => ipcRenderer.invoke('architect:generate', params),

});
