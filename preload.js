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

  // ── GCP PLANNING ────────────────────────────────────────────
  // params: { scanResult, graphResult, fileContents, usageAnswers }
  //   fileContents: plain object converted from Map via Object.fromEntries(map)
  //   usageAnswers: { expectedDailyUsers, teamSize, budget, isProduction, expectsSpikes }
  generateGcpPlan: (params) => ipcRenderer.invoke('gcp:plan',       params),
  // params: { gcpPlan, productName, tierId }
  updateGcpTier:   (params) => ipcRenderer.invoke('gcp:updateTier', params),

  // Push listener for GCP planning progress (same pattern as scanner)
  onGcpProgress: (callback) => {
    const listener = (_event, data) => callback(data);
    ipcRenderer.on('gcp:progress', listener);
    return () => ipcRenderer.removeListener('gcp:progress', listener);
  },

  // ── PIPELINE (Day 6) ─────────────────────────────────────
  // Returns the generated .gitlab-ci.yml as a string, without committing.
  // Person B shows this as a preview diff before the user confirms deploy.
  // params: { deploymentConfig }
  previewPipeline: (params) => ipcRenderer.invoke('pipeline:preview', params),

  // Commits .gitlab-ci.yml and deploys. Long-running — progress comes via
  // onPipelineProgress. Resolves when pipeline reaches a terminal state.
  // params: { projectId, deploymentConfig }
  deployPipeline: (params) => ipcRenderer.invoke('pipeline:deploy', params),

  // Fetch the latest status of a specific pipeline and its jobs on-demand.
  // params: { projectId, pipelineId }
  getPipelineStatus: (params) => ipcRenderer.invoke('pipeline:status', params),

  // Push listener for deployment progress.
  // callback receives: { message, stage, pipelineId?, status?, jobs?, isRunning?, isComplete? }
  // React: const cleanup = window.api.onPipelineProgress(data => ...)
  onPipelineProgress: (callback) => {
    const listener = (_event, data) => callback(data);
    ipcRenderer.on('pipeline:progress', listener);
    return () => ipcRenderer.removeListener('pipeline:progress', listener);
  },

  // ── MONITORING (Day 7) ───────────────────────────────────
  // Returns last 10 pipelines with jobs and timing.
  // params: { projectId }
  getRecentDeployments: (params) => ipcRenderer.invoke('monitor:deployments', params),

  // Fetches the full ANSI-stripped log for one CI job.
  // params: { projectId, jobId }
  getJobLog: (params) => ipcRenderer.invoke('monitor:jobLog', params),

  // Starts streaming a running job's log. New lines arrive via onLogChunk.
  // params: { projectId, jobId }
  streamJobLog: (params) => ipcRenderer.invoke('monitor:streamLog', params),

  // Stops a log stream. Call when the user leaves the log viewer.
  // params: { jobId }
  stopLogStream: (params) => ipcRenderer.invoke('monitor:stopStream', params),

  // Push listener — called with each new batch of log lines while streaming.
  // callback receives: { jobId, text }
  onLogChunk: (callback) => {
    const listener = (_event, data) => callback(data);
    ipcRenderer.on('monitor:logChunk', listener);
    return () => ipcRenderer.removeListener('monitor:logChunk', listener);
  },

  // Push listener — called when a log stream finishes.
  // callback receives: { jobId, reason, finalStatus }
  onLogDone: (callback) => {
    const listener = (_event, data) => callback(data);
    ipcRenderer.on('monitor:logDone', listener);
    return () => ipcRenderer.removeListener('monitor:logDone', listener);
  },

  // Fetches structured log entries from Cloud Logging for a Cloud Run service.
  // params: { serviceName, region, options: { limit?, severity?, minutesAgo? } }
  getCloudRunLogs: (params) => ipcRenderer.invoke('monitor:cloudRunLogs', params),

  // Hits the service's /health endpoint and returns status + response time.
  // params: { serviceUrl }
  checkServiceHealth: (params) => ipcRenderer.invoke('monitor:healthCheck', params),

});