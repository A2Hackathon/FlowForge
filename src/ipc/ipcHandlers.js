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
//   Day 5 → gcp:plan, gcp:updateTier  (+ push event gcp:progress)
//   Day 6 → pipeline:preview, pipeline:deploy, pipeline:status  (+ push event pipeline:progress)
//   Day 7 → monitor:deployments, monitor:jobLog, monitor:streamLog, monitor:stopStream,
//            monitor:cloudRunLogs, monitor:healthCheck
// ─────────────────────────────────────────────────────────────

const { ipcMain }                    = require('electron');
const { login }                      = require('../auth/gitlabAuth');
const { isLoggedIn, clearTokens }    = require('../store/tokenStore');
const { getCurrentUser, getUserRepositories, searchRepositories } = require('../api/gitlabClient');
const { scanRepository }             = require('../scanner/repoScanner');
const { generateArchitectureGraph }  = require('../architect/architectureMapper');
const { generateGcpPlan, updateServiceTier } = require('../cloud/gcpPlanner');
const { commitAndDeploy, getPipelineStatus, generatePipelineYml } = require('../pipeline/pipelineGenerator');
const { getRecentDeployments, getJobLog, startLogStream, getCloudRunLogs, checkServiceHealth } = require('../monitor/logMonitor');

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

  // ════════════════════════════════════════════════════════════
  // DAY 6 — Pipeline generation and deployment
  // ════════════════════════════════════════════════════════════

  // Returns the generated .gitlab-ci.yml as a string WITHOUT committing it.
  // Person B uses this to show a preview diff in the UI before the user
  // confirms they want to commit.
  //
  // Frontend sends: { deploymentConfig }
  //   deploymentConfig — from the gcpPlan returned by gcp:plan (Day 5)
  ipcMain.handle('pipeline:preview', (_event, { deploymentConfig }) => {
    try {
      const yml = generatePipelineYml(deploymentConfig);
      return ok({ yml });
    } catch (e) { return fail(e); }
  });

  // Commits .gitlab-ci.yml to the repo and waits for the pipeline to finish.
  // This is a long-running operation (up to 30 minutes). Progress is streamed
  // to the frontend via the pipeline:progress push channel.
  //
  // Frontend sends: { projectId, deploymentConfig }
  //   projectId        — GitLab project ID (from the repo the user selected in Day 2)
  //   deploymentConfig — from gcpPlan.deploymentConfig (Day 5 output)
  //
  // Returns once the pipeline reaches a terminal state (success/failed/canceled).
  ipcMain.handle('pipeline:deploy', async (_event, { projectId, deploymentConfig }) => {
    try {
      const onProgress = (progressData) => {
        // progressData: { message, stage, pipelineId?, status?, jobs?, isRunning?, isComplete? }
        mainWindow.webContents.send('pipeline:progress', progressData);
      };

      const result = await commitAndDeploy(projectId, deploymentConfig, onProgress);
      return ok(result);
    } catch (e) { return fail(e); }
  });

  // Fetches the current status of a pipeline and all its jobs.
  // Called by the frontend on-demand (e.g. when the user opens the
  // Deployment Progress screen or clicks Refresh).
  //
  // Frontend sends: { projectId, pipelineId }
  ipcMain.handle('pipeline:status', async (_event, { projectId, pipelineId }) => {
    try {
      const status = await getPipelineStatus(projectId, pipelineId);
      return ok(status);
    } catch (e) { return fail(e); }
  });

  // ════════════════════════════════════════════════════════════
  // DAY 7 — Monitoring and log viewer
  // ════════════════════════════════════════════════════════════

  // Returns the last 10 pipelines with jobs and timing for the
  // deployment history list. Each entry includes a serviceUrl if
  // the deploy job captured it.
  //
  // Frontend sends: { projectId }
  ipcMain.handle('monitor:deployments', async (_event, { projectId }) => {
    try {
      const deployments = await getRecentDeployments(projectId);
      return ok(deployments);
    } catch (e) { return fail(e); }
  });

  // Fetches the full raw log for one CI job (ANSI stripped).
  // Used when the user clicks a job in the deployment history list.
  //
  // Frontend sends: { projectId, jobId }
  ipcMain.handle('monitor:jobLog', async (_event, { projectId, jobId }) => {
    try {
      const log = await getJobLog(projectId, jobId);
      return ok({ log });
    } catch (e) { return fail(e); }
  });

  // Starts streaming a running job's log. New lines are pushed to the
  // frontend via the monitor:logChunk push channel every 3 seconds.
  // The stream stops automatically when the job finishes.
  //
  // Frontend sends: { projectId, jobId }
  // Push channel:   monitor:logChunk  → { jobId, text }
  // Push channel:   monitor:logDone   → { jobId, reason, finalStatus }
  //
  // A Map tracks active streams so we can stop them on demand.
  ipcMain.handle('monitor:streamLog', (_event, { projectId, jobId }) => {
    try {
      // If there's already a stream for this job, stop it before starting a new one
      if (activeLogStreams.has(jobId)) {
        activeLogStreams.get(jobId)();
        activeLogStreams.delete(jobId);
      }

      const stopFn = startLogStream(
        projectId,
        jobId,
        (text) => {
          // New log lines — push to the renderer
          mainWindow.webContents.send('monitor:logChunk', { jobId, text });
        },
        ({ reason, finalStatus }) => {
          // Job finished or stream was stopped
          mainWindow.webContents.send('monitor:logDone', { jobId, reason, finalStatus });
          activeLogStreams.delete(jobId);
        }
      );

      activeLogStreams.set(jobId, stopFn);
      return ok({ streaming: true, jobId });
    } catch (e) { return fail(e); }
  });

  // Stops a log stream started with monitor:streamLog.
  // Called when the user navigates away from the log viewer.
  //
  // Frontend sends: { jobId }
  ipcMain.handle('monitor:stopStream', (_event, { jobId }) => {
    try {
      if (activeLogStreams.has(jobId)) {
        activeLogStreams.get(jobId)();
        activeLogStreams.delete(jobId);
      }
      return ok({ stopped: true, jobId });
    } catch (e) { return fail(e); }
  });

  // Fetches structured log entries from the Cloud Logging API for
  // a deployed Cloud Run service.
  //
  // Frontend sends: { serviceName, region, options }
  //   options: { limit?, severity?, minutesAgo? }
  ipcMain.handle('monitor:cloudRunLogs', async (_event, { serviceName, region, options = {} }) => {
    try {
      const result = await getCloudRunLogs(serviceName, region, options);
      return ok(result);
    } catch (e) { return fail(e); }
  });

  // Sends a GET /health request to the deployed service and returns the result.
  // Used to show a live "is it up?" indicator in the UI.
  //
  // Frontend sends: { serviceUrl }
  ipcMain.handle('monitor:healthCheck', async (_event, { serviceUrl }) => {
    try {
      const result = await checkServiceHealth(serviceUrl);
      return ok(result);
    } catch (e) { return fail(e); }
  });
}

// Map of jobId → stopStream() function for active log streams.
// Defined outside registerIpcHandlers so it persists across handler calls.
const activeLogStreams = new Map();

module.exports = { registerIpcHandlers };