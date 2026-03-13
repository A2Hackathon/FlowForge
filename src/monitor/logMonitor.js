// src/monitor/logMonitor.js
// ─────────────────────────────────────────────────────────────
// Day 7 — Monitoring and Log Viewer.
//
// Four responsibilities:
//
//   1. getRecentDeployments(projectId)
//      Returns the last 10 pipelines with their jobs and timing,
//      so Person B can render a deployment history list.
//
//   2. getJobLog(projectId, jobId)
//      Fetches the full raw log for one CI job as a string.
//      ANSI colour codes are stripped so the UI can display plain text.
//
//   3. startLogStream(projectId, jobId, onChunk, onDone)
//      Polls a running job's log every 3 seconds, diffing each response
//      against the last to emit only NEW lines. Stops automatically
//      when the job reaches a terminal state.
//      Returns a stopStream() function — call it to cancel early.
//
//   4. getCloudRunLogs(serviceName, region, options)
//      Fetches structured logs from the Cloud Logging API using the
//      GCP_API_KEY from .env. Returns parsed log entries ready for display.
//      Falls back gracefully if the Logging API isn't enabled.
//
//   5. checkServiceHealth(serviceUrl)
//      Sends a GET /health request to the deployed Cloud Run service and
//      returns the HTTP status and response time.
//
// Log streaming design:
//   GitLab's job log endpoint (/jobs/:id/trace) always returns the FULL log
//   from the beginning on every call — there is no "from offset" parameter.
//   We track how many characters we've already seen and only emit the diff.
//   This is cheap: the response body is text, not binary, so comparing lengths
//   is enough to detect new content without parsing the whole log each time.
// ─────────────────────────────────────────────────────────────

const axios  = require('axios');
const {
  getProjectPipelines,
  getPipelineJobs,
  getJobLog: fetchJobLog,
}            = require('../api/gitlabClient');
const STREAM_POLL_INTERVAL_MS = 3000;

// GitLab statuses that mean the job is still running
const JOB_RUNNING_STATUSES   = new Set(['created', 'pending', 'running', 'waiting_for_resource']);

// Cloud Logging API base URL
const CLOUD_LOGGING_URL = 'https://logging.googleapis.com/v2/entries:list';

// ════════════════════════════════════════════════════════════
// 1. DEPLOYMENT HISTORY
// ════════════════════════════════════════════════════════════

/**
 * getRecentDeployments
 * Returns the last 10 pipelines for the project with their jobs,
 * formatted for the deployment history list in the UI.
 *
 * @param {number} projectId - GitLab project ID
 * @returns {Object[]} Array of deployment summary objects
 */
async function getRecentDeployments(projectId) {
  const pipelines = await getProjectPipelines(projectId, 10);

  // Fetch jobs for all pipelines in parallel
  const withJobs = await Promise.all(
    pipelines.map(async (pipeline) => {
      let jobs = [];
      try {
        jobs = await getPipelineJobs(projectId, pipeline.id);
      } catch {
        // A failed fetch for one pipeline shouldn't break the whole list
      }

      return formatDeployment(pipeline, jobs);
    })
  );

  return withJobs;
}

/**
 * formatDeployment
 * Normalises one pipeline + its jobs into the shape the frontend expects.
 */
function formatDeployment(pipeline, jobs) {
  // Find the deploy job to extract the service URL if available
  const deployJob = jobs.find(j => j.name === 'deploy-cloud-run');

  // Calculate total duration from first job start to last job finish
  const startedAts  = jobs.map(j => j.started_at).filter(Boolean);
  const finishedAts = jobs.map(j => j.finished_at).filter(Boolean);
  const startedAt   = startedAts.length  ? startedAts.sort()[0]           : pipeline.created_at;
  const finishedAt  = finishedAts.length ? finishedAts.sort().reverse()[0] : null;
  const durationSec = (startedAt && finishedAt)
    ? Math.round((new Date(finishedAt) - new Date(startedAt)) / 1000)
    : null;

  return {
    pipelineId:  pipeline.id,
    status:      pipeline.status,
    commitSha:   pipeline.sha?.substring(0, 8),
    commitRef:   pipeline.ref,
    webUrl:      pipeline.web_url,
    createdAt:   pipeline.created_at,
    startedAt,
    finishedAt,
    durationSec,
    // Convenience flags for the UI
    isSuccess:   pipeline.status === 'success',
    isFailed:    pipeline.status === 'failed',
    isRunning:   JOB_RUNNING_STATUSES.has(pipeline.status) || pipeline.status === 'running',
    // Jobs summary
    jobs: jobs.map(j => ({
      id:          j.id,
      name:        j.name,
      stage:       j.stage,
      status:      j.status,
      durationSec: j.duration || null,
      startedAt:   j.started_at || null,
      webUrl:      j.web_url || null,
    })),
    // If the deploy job ran, try to extract the service URL from its environment
    serviceUrl:  deployJob?.environment?.url || null,
  };
}

// ════════════════════════════════════════════════════════════
// 2. FULL JOB LOG (single fetch)
// ════════════════════════════════════════════════════════════

/**
 * getJobLog
 * Fetches the complete log for one CI job as a cleaned string.
 * Strips ANSI escape codes so the UI can render plain text without
 * having to bundle an ANSI parser.
 *
 * @param {number} projectId - GitLab project ID
 * @param {number} jobId     - Job ID
 * @returns {string} Plain text log content
 */
async function getJobLog(projectId, jobId) {
  const rawLog = await fetchJobLog(projectId, jobId);
  return stripAnsi(rawLog);
}

// ════════════════════════════════════════════════════════════
// 3. STREAMING JOB LOG (live updates while job runs)
// ════════════════════════════════════════════════════════════

/**
 * startLogStream
 * Polls a running job's log every STREAM_POLL_INTERVAL_MS, emitting
 * only the NEW lines since the last poll via onChunk().
 * Calls onDone() when the job finishes (or an error occurs).
 * Returns a stopStream() function — call it to cancel early (e.g. user
 * navigates away from the log viewer).
 *
 * The streaming works by comparing the total log length on each poll.
 * GitLab always returns the FULL log, so we track the character offset
 * we've already emitted and slice from there.
 *
 * @param {number}   projectId - GitLab project ID
 * @param {number}   jobId     - Job ID to stream
 * @param {Function} onChunk   - Called with each new batch of lines: (newText: string) => void
 * @param {Function} onDone    - Called when streaming stops: ({ reason, finalStatus }) => void
 *
 * @returns {Function} stopStream — call to cancel polling
 */
function startLogStream(projectId, jobId, onChunk, onDone = () => {}) {
  let stopped       = false;
  let seenChars     = 0;     // How many chars of the log we've already emitted
  let pollTimer     = null;

  async function poll() {
    if (stopped) return;

    try {
      const rawLog   = await fetchJobLog(projectId, jobId);
      const cleanLog = stripAnsi(rawLog);

      // Emit only the new content since last poll
      if (cleanLog.length > seenChars) {
        const newText = cleanLog.substring(seenChars);
        seenChars     = cleanLog.length;
        onChunk(newText);
      }

      // Detect terminal state from log content
      // GitLab appends these markers when a job finishes
      const isFinished = (
        cleanLog.includes('\nJob succeeded')            ||
        cleanLog.includes('\nERROR: Job failed')        ||
        cleanLog.includes('\nERROR: Job canceled')      ||
        cleanLog.includes('Uploading artifacts')        // last step before success marker
      );

      if (isFinished) {
        stopped = true;
        const status = cleanLog.includes('Job succeeded') ? 'success'
          : cleanLog.includes('Job canceled')             ? 'canceled'
          : 'failed';
        onDone({ reason: 'finished', finalStatus: status });
        return;
      }

    } catch (err) {
      console.error('[LogMonitor] Poll error:', err.message);
      // Don't stop on a single error — transient network issues happen
    }

    if (!stopped) {
      pollTimer = setTimeout(poll, STREAM_POLL_INTERVAL_MS);
    }
  }

  // Start immediately
  poll();

  // Return a cancel function
  return function stopStream() {
    stopped = true;
    if (pollTimer) clearTimeout(pollTimer);
    onDone({ reason: 'stopped', finalStatus: null });
  };
}

// ════════════════════════════════════════════════════════════
// 4. CLOUD RUN LOGS (Cloud Logging API)
// ════════════════════════════════════════════════════════════

/**
 * getCloudRunLogs
 * Fetches structured log entries for a Cloud Run service from the
 * Cloud Logging API. Uses GCP_API_KEY from .env — no OAuth needed
 * if the Logging API is enabled on the project.
 *
 * @param {string} serviceName - Cloud Run service name (from deploymentConfig)
 * @param {string} region      - GCP region e.g. 'us-central1'
 * @param {Object} options
 *   @param {number} options.limit    - Max log entries (default 100)
 *   @param {string} options.severity - Min severity: 'DEFAULT'|'INFO'|'WARNING'|'ERROR'
 *   @param {number} options.minutesAgo - Fetch logs from last N minutes (default 60)
 *
 * @returns {Object} { entries: [...], totalFetched, fromTime, error? }
 */
async function getCloudRunLogs(serviceName, region, options = {}) {
  const apiKey      = process.env.GCP_API_KEY;
  const projectId   = process.env.GCP_PROJECT_ID;

  if (!apiKey || !projectId) {
    return {
      entries:      [],
      totalFetched: 0,
      error:        'GCP_API_KEY or GCP_PROJECT_ID not set in .env',
    };
  }

  const {
    limit      = 100,
    severity   = 'DEFAULT',
    minutesAgo = 60,
  } = options;

  const fromTime = new Date(Date.now() - minutesAgo * 60 * 1000).toISOString();

  // Cloud Logging filter syntax
  // resource.type="cloud_run_revision" matches all Cloud Run log entries.
  // resource.labels.service_name filters to our specific service.
  const filter = [
    `resource.type="cloud_run_revision"`,
    `resource.labels.service_name="${serviceName}"`,
    `resource.labels.location="${region}"`,
    severity !== 'DEFAULT' ? `severity>=${severity}` : '',
    `timestamp>="${fromTime}"`,
  ].filter(Boolean).join('\n');

  try {
    const response = await axios.post(
      CLOUD_LOGGING_URL,
      {
        resourceNames: [`projects/${projectId}`],
        filter,
        orderBy:   'timestamp desc',
        pageSize:  limit,
      },
      {
        params:  { key: apiKey },
        timeout: 15000,
      }
    );

    const rawEntries = response.data.entries || [];

    return {
      entries:      rawEntries.map(formatLogEntry),
      totalFetched: rawEntries.length,
      fromTime,
    };

  } catch (err) {
    // 403 usually means the Logging API isn't enabled or the API key
    // doesn't have permission to read logs
    const isPermissionError = err.response?.status === 403;
    const isNotEnabled      = err.response?.status === 400 &&
      err.response?.data?.error?.message?.includes('not enabled');

    return {
      entries:      [],
      totalFetched: 0,
      fromTime,
      error: isPermissionError || isNotEnabled
        ? 'Cloud Logging API not enabled or API key lacks permission. Enable it in GCP Console → APIs & Services → Library → Cloud Logging API.'
        : `Cloud Logging API error: ${err.response?.data?.error?.message || err.message}`,
    };
  }
}

/**
 * formatLogEntry
 * Normalises a raw Cloud Logging entry into a clean shape for the UI.
 */
function formatLogEntry(entry) {
  // Cloud Run logs can have different payload types:
  //   textPayload: plain string
  //   jsonPayload: structured JSON (most apps that use structured logging)
  //   protoPayload: protobuf (usually for audit logs)
  let message = '';

  if (entry.textPayload) {
    message = entry.textPayload;
  } else if (entry.jsonPayload) {
    // Try common structured log message fields
    message = entry.jsonPayload.message
      || entry.jsonPayload.msg
      || entry.jsonPayload.text
      || JSON.stringify(entry.jsonPayload);
  } else if (entry.protoPayload) {
    message = entry.protoPayload['@type'] || 'Proto log entry';
  }

  return {
    timestamp:    entry.timestamp,
    severity:     entry.severity || 'DEFAULT',
    message:      message.trim(),
    // Extra fields useful for debugging
    httpRequest:  entry.httpRequest || null,   // Present for request logs
    labels:       entry.labels      || {},
    // Severity mapped to a UI colour hint
    level: severityToLevel(entry.severity),
  };
}

/**
 * severityToLevel
 * Maps GCP log severity strings to simple UI level names.
 * Person B uses these to colour-code log lines.
 */
function severityToLevel(severity) {
  const map = {
    DEFAULT:   'info',
    DEBUG:     'debug',
    INFO:      'info',
    NOTICE:    'info',
    WARNING:   'warn',
    ERROR:     'error',
    CRITICAL:  'error',
    ALERT:     'error',
    EMERGENCY: 'error',
  };
  return map[severity] || 'info';
}

// ════════════════════════════════════════════════════════════
// 5. SERVICE HEALTH CHECK
// ════════════════════════════════════════════════════════════

/**
 * checkServiceHealth
 * Sends a GET request to the service's /health endpoint and measures
 * response time. Used to show a live "is it up?" indicator in the UI.
 *
 * @param {string} serviceUrl - Full URL of the deployed Cloud Run service
 *                              e.g. 'https://my-service-abc123-uc.a.run.app'
 * @returns {Object} {
 *   url:          string,
 *   healthy:      boolean,
 *   httpStatus:   number | null,
 *   responseMs:   number,        — round-trip time in milliseconds
 *   checkedAt:    string,        — ISO timestamp
 *   errorMessage: string | null,
 * }
 */
async function checkServiceHealth(serviceUrl) {
  const healthUrl  = `${serviceUrl.replace(/\/$/, '')}/health`;
  const startTime  = Date.now();

  try {
    const response = await axios.get(healthUrl, {
      timeout:           10000,
      validateStatus:    null,    // Don't throw on non-2xx — we want the status code
      maxRedirects:      3,
    });

    const responseMs = Date.now() - startTime;

    return {
      url:          healthUrl,
      healthy:      response.status === 200,
      httpStatus:   response.status,
      responseMs,
      checkedAt:    new Date().toISOString(),
      errorMessage: response.status !== 200
        ? `Unexpected HTTP ${response.status}`
        : null,
    };

  } catch (err) {
    return {
      url:          healthUrl,
      healthy:      false,
      httpStatus:   null,
      responseMs:   Date.now() - startTime,
      checkedAt:    new Date().toISOString(),
      errorMessage: err.code === 'ECONNREFUSED'  ? 'Connection refused — service may be down'
        : err.code === 'ETIMEDOUT'               ? 'Request timed out'
        : err.code === 'ENOTFOUND'               ? 'DNS lookup failed — check the service URL'
        : err.message,
    };
  }
}

// ════════════════════════════════════════════════════════════
// PRIVATE HELPERS
// ════════════════════════════════════════════════════════════

/**
 * stripAnsi
 * Removes ANSI terminal escape codes from a string.
 * GitLab CI logs contain colour codes for things like green "✓ passed"
 * lines. Without stripping them, the text looks like "[0;32m✓[0m".
 *
 * The regex matches the ESC character (\x1B) followed by [ and any
 * number of parameter bytes, ending with a letter.
 */
function stripAnsi(str) {
  if (!str) return '';
  // eslint-disable-next-line no-control-regex
  return str.replace(/\x1B\[[0-9;]*[a-zA-Z]/g, '');
}

module.exports = {
  getRecentDeployments,
  getJobLog,
  startLogStream,
  getCloudRunLogs,
  checkServiceHealth,
};
