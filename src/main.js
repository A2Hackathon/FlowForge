// src/main.js
// ─────────────────────────────────────────────────────────────
// The entry point of the Electron app.
// When you run "electron .", Electron reads package.json,
// sees "main": "src/main.js", and runs this file first.
//
// Responsibilities:
//   1. Create the desktop window (BrowserWindow)
//   2. Load the React frontend into it
//   3. Register all IPC handlers (backend ↔ frontend bridge)
//   4. Handle app lifecycle (open, close, dock behaviour on Mac)
// ─────────────────────────────────────────────────────────────

const { app, BrowserWindow } = require('electron');
const path = require('path');
const { registerIpcHandlers } = require('./ipc/ipcHandlers');

// Store window reference outside createWindow() so the garbage
// collector doesn't destroy it when the function finishes.
let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    webPreferences: {
      // preload.js runs before React loads.
      // It's the only script allowed to bridge Node.js and the browser.
      preload: path.join(__dirname, '..', 'preload.js'),

      // Security: renderer process (React) cannot call Node.js directly.
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // Development: load from Vite dev server (gives us hot reload).
  // Production: load the compiled static files.
  if (process.env.NODE_ENV === 'development') {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }

  mainWindow.on('closed', () => { mainWindow = null; });

  // Wire up all IPC channels so the frontend can call backend functions.
  // We pass mainWindow so handlers can push events (e.g. scan progress).
  registerIpcHandlers(mainWindow);

  console.log('[Main] Window created');
}

app.whenReady().then(() => {
  createWindow();

  // macOS: re-open window when clicking the dock icon after all windows closed.
  app.on('activate', () => {
    if (mainWindow === null) createWindow();
  });
});

// Windows/Linux: quit when all windows are closed.
// macOS: leave running in the dock (handled above).
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
