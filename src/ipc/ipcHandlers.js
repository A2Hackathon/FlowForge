// src/ipc/ipcHandlers.js
// ─────────────────────────────────────────────────────────────
// The API between the React frontend and the Node.js backend.
//
// Electron splits the app into two isolated worlds:
//   Main process  (Node.js)  — our backend code
//   Renderer process (React) — the UI
//
// They can't call each other directly. IPC (Inter-Process Communication)
// is the message-passing system that connects them.
//
//   Frontend sends:  ipcRenderer.invoke('auth:login')
//   This file:       ipcMain.handle('auth:login', () => login())
//   Frontend gets:   the return value of login()
//
// Every backend feature needs:
//   1. A handler registered HERE with ipcMain.handle()
//   2. A corresponding entry in preload.js exposed on window.api
//
// Days covered:
//   Day 1 → auth:login, auth:check, auth:logout, auth:getUser
//   Day 2 → repos:list, repos:search
//   Day 3 → scanner:scan  (+ push event scanner:progress)
//   Day 4 → architect:generate
//   Day 5 → gcp:plan, gcp:updateTier
// ─────────────────────────────────────────────────────────────

const { ipcMain }                    = require('electron');
const { login }                      = require('../auth/gitlabAuth');
const { isLoggedIn, clearTokens }    = require('../store/tokenStore');
const { getCurrentUser, getUserRepositories, searchRepositories } = require('../api/gitlabClient');
const { scanRepository }             = require('../scanner/repoScanner');
const { generateArchitectureGraph }  = require('../architect/architectureMapper');
const { generateGcpPlan, updateServiceTier } = require('../cloud/gcpPlanner');

/**
 * registerIpcHandlers
 * Call once from main.js after the window is created.
 * Registers every IPC channel the frontend can call.
 *
 * @param {BrowserWindow} mainWindow - Needed to push events to the renderer
 */
function registerIpcHandlers(mainWindow) {

  // ── Helpers ──────────────────────────────────────────────────
  // Wraps every handler so we always return { success, data } or { success, error }.
  // The frontend can check result.success without try/catch everywhere.
  function ok(data)          { return { success: true,  data  }; }
  function fail(err)         { return { success: false, error: err.message }; }

  // ════════════════════════════════════════════════════════════
  // DAY 1 — Auth
  // ════════════════════════════════════════════════════════════

  // Starts the full OAuth flow (opens browser, waits, exchanges code).
  // Can take 10s–2min depending on how fast the user logs in.
  ipcMain.handle('auth:login', async () => {
    try   { return ok(await login()); }
    catch (e) { return fail(e); }
  });

  // Called on app startup. If the user has a valid stored token,
  // the frontend skips the login screen and goes straight to repos.
  ipcMain.handle('auth:check', () => {
    return { loggedIn: isLoggedIn() };
  });

  // Deletes all tokens from disk — effectively logs the user out.
  ipcMain.handle('auth:logout', () => {
    clearTokens();
    return ok(null);
  });

  // Fetches the user's GitLab profile to display their name/avatar.
  ipcMain.handle('auth:getUser', async () => {
    try   { return ok(await getCurrentUser()); }
    catch (e) { return fail(e); }
  });

  // ════════════════════════════════════════════════════════════
  // DAY 2 — Repository listing
  // ════════════════════════════════════════════════════════════

  // Returns a paginated list of the user's GitLab repos.
  // Frontend sends { page: 1 } — we default to page 1 if not provided.
  ipcMain.handle('repos:list', async (_event, { page = 1 } = {}) => {
    try   { return ok(await getUserRepositories(page)); }
    catch (e) { return fail(e); }
  });

  // Called as the user types in the search box on the repo selection screen.
  // Empty query falls back to the standard list.
  ipcMain.handle('repos:search', async (_event, { query }) => {
    try {
      if (!query || !query.trim()) {
        return ok((await getUserRepositories(1)).repositories);
      }
      return ok(await searchRepositories(query));
    } catch (e) {
      return fail(e);
    }
  });

  // ════════════════════════════════════════════════════════════
  // DAY 3 — Repository scanning
  // ════════════════════════════════════════════════════════════

  // Scans a repository for language, framework, and dependency info.
  // This is async and can take a few seconds, so we push live progress
  // messages to the frontend during the scan using a separate IPC channel.
  ipcMain.handle('scanner:scan', async (_event, { projectId }) => {
    try {
      // onProgress is called inside scanRepository at each major step.
      // We forward those messages to the renderer as push events.
      // The frontend listens with window.api.onScanProgress(cb).
      const onProgress = (message) => {
        mainWindow.webContents.send('scanner:progress', { message });
      };

      const result = await scanRepository(projectId, onProgress);
      return ok(result);
    } catch (e) {
      return fail(e);
    }
  });

  // ════════════════════════════════════════════════════════════
  // DAY 4 — Architecture graph generation
  // ════════════════════════════════════════════════════════════

  // Takes the scan result (stored in the frontend's state after Day 3)
  // and returns nodes + edges ready for React Flow.
  // This is synchronous and fast — no API calls needed.
  ipcMain.handle('architect:generate', (_event, { scanResult }) => {
    try {
      const graph = generateArchitectureGraph(scanResult);
      return ok(graph);
    } catch (e) {
      return fail(e);
    }
  });

  // ════════════════════════════════════════════════════════════
  // DAY 5 — GCP infrastructure planning
  // ════════════════════════════════════════════════════════════

  // Generates the full GCP plan using Claude AI + live GCP pricing.
  //
  // Frontend sends: { scanResult, graphResult, fileContents, usageAnswers }
  //   fileContents:  plain object { filename: content } — IPC can't send Maps,
  //                  so the frontend converts the Map to an object first.
  //                  We convert it back to a Map here before passing to Claude.
  //   usageAnswers:  { expectedDailyUsers, teamSize, budget,
  //                    isProduction, expectsSpikes }
  //                  From a short questionnaire Person B shows before Day 5.
  ipcMain.handle('gcp:plan', async (_event, { scanResult, graphResult, fileContents = {}, usageAnswers = {} }) => {
    try {
      const onProgress = (message) => {
        mainWindow.webContents.send('gcp:progress', { message });
      };

      // Convert plain object back to Map — IPC serialises Maps as plain objects
      const fileContentsMap = new Map(Object.entries(fileContents));

      const plan = await generateGcpPlan(
        scanResult, graphResult, fileContentsMap, usageAnswers, onProgress
      );
      return ok(plan);
    } catch (e) { return fail(e); }
  });

  // Called when user changes a tier in the Infrastructure Dashboard.
  // Fast — no API calls, just recalculates costs locally.
  ipcMain.handle('gcp:updateTier', (_event, { gcpPlan, productName, tierId }) => {
    try {
      return ok(updateServiceTier(gcpPlan, productName, tierId));
    } catch (e) { return fail(e); }
  });
}

module.exports = { registerIpcHandlers };