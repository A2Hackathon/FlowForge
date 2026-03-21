// src/api/gitlabClient.js
// ─────────────────────────────────────────────────────────────
// The single place for ALL GitLab API communication.
//
// Rather than adding Authorization headers in every function,
// we create one pre-configured Axios instance. Two interceptors
// handle token injection and automatic token refresh transparently
// so the rest of the code never has to think about auth.
//
// Days covered:
//   Day 2 → getCurrentUser, getUserRepositories, searchRepositories
//   Day 3 → getRepositoryTree, getFileContent, getDefaultBranch
//
// Scalability fixes applied:
//   [FIX 1] getRepositoryTree now paginates through ALL files (was capped at 100)
//   [FIX 2] downloadInBatches limits concurrent API calls to 5 at a time
//           to avoid hitting GitLab's rate limit (300 req/min)
// ─────────────────────────────────────────────────────────────

const axios = require('axios');
const { getAccessToken, getRefreshToken } = require('../store/tokenStore');
const { refreshAccessToken }              = require('../auth/gitlabAuth');

const GITLAB_URL = process.env.GITLAB_URL || 'https://gitlab.com';

/** GitLab PATs (glpat-...) are much longer; short values are almost always a mis-pasted CI variable. */
const MIN_PLAUSIBLE_PAT_LENGTH = 20;

function gitlab401UserMessage(error) {
  const data = error.response?.data;
  if (typeof data === 'string') return data.slice(0, 400);
  if (data && typeof data === 'object') {
    if (data.message) return String(data.message);
    if (data.error_description) return String(data.error_description);
    if (data.error) return String(data.error);
  }
  return null;
}

function shortTokenHint(token) {
  if (!token) return '';
  if (process.env.CI_JOB_TOKEN && token === process.env.CI_JOB_TOKEN) return '';
  if (token.length >= MIN_PLAUSIBLE_PAT_LENGTH) return '';
  return (
    ` GITLAB_TOKEN length is ${token.length} (too short). ` +
    'Paste the full Personal Access Token from GitLab → Edit profile → Access Tokens (or use a Project Access Token); it should start with glpat- and be much longer.'
  );
}

// ── Axios instance ────────────────────────────────────────────
// baseURL means we only have to write '/user' instead of
// 'https://gitlab.com/api/v4/user' in every call.
const apiClient = axios.create({
  baseURL: `${GITLAB_URL}/api/v4`,
  timeout: 15000,   // Give up after 15 seconds
});

// ── Request interceptor ───────────────────────────────────────
// Runs before EVERY outgoing request.
// Automatically attaches 'Authorization: Bearer <token>' so
// we never forget it on any API call.
apiClient.interceptors.request.use((config) => {
  const token = getAccessToken();
  if (token) {
    // CI_JOB_TOKEN is officially sent as JOB-TOKEN; Bearer also works on many hosts but not all.
    if (process.env.CI_JOB_TOKEN && token === process.env.CI_JOB_TOKEN) {
      config.headers['JOB-TOKEN'] = token;
    } else {
      config.headers['Authorization'] = `Bearer ${token}`;
    }
  }
  return config;
});

// ── Response interceptor ──────────────────────────────────────
// Runs after EVERY response.
// If GitLab returns 401 (token expired), we silently refresh the
// token and retry the original request once before giving up.
apiClient.interceptors.response.use(
  (response) => response,   // Success: pass through untouched

  async (error) => {
    const originalRequest = error.config;

    // 401 = Unauthorized. _retry flag prevents infinite retry loops.
    if (error.response?.status === 401 && originalRequest && !originalRequest._retry) {
      originalRequest._retry = true;

      const refreshToken = getRefreshToken();

      // CI / CLI: no OAuth refresh token — do not call refresh; surface GitLab's 401 reason.
      if (!refreshToken) {
        const detail = gitlab401UserMessage(error);
        const hint = shortTokenHint(getAccessToken());
        const msg = detail
          ? `GitLab API unauthorized: ${detail}.${hint}`
          : `GitLab API unauthorized (401). Check GITLAB_TOKEN and GITLAB_URL.${hint}`;
        return Promise.reject(new Error(msg));
      }

      try {
        const newToken = await refreshAccessToken(refreshToken);
        originalRequest.headers['Authorization'] = `Bearer ${newToken}`;
        return apiClient(originalRequest);   // Retry with new token
      } catch (refreshErr) {
        return Promise.reject(new Error('Session expired. Please log in again.'));
      }
    }

    return Promise.reject(error);
  }
);

// ════════════════════════════════════════════════════════════
// DAY 2 — User profile + repository listing
// ════════════════════════════════════════════════════════════

/**
 * getCurrentUser
 * Fetches the logged-in user's GitLab profile.
 * Used to display their name/avatar and to verify the token works.
 *
 * Returns: { id, username, name, email, avatar_url, web_url }
 */
async function getCurrentUser() {
  const response = await apiClient.get('/user');
  return response.data;
}

/**
 * getUserRepositories
 * Fetches paginated list of repos the user is a member of,
 * sorted by most recently active.
 *
 * @param {number} page    - Page number (starts at 1)
 * @param {number} perPage - Results per page (max 100)
 *
 * Returns: { repositories: [...], totalPages, currentPage }
 */
async function getUserRepositories(page = 1, perPage = 20) {
  const response = await apiClient.get('/projects', {
    params: {
      // membership=true: only show repos the user belongs to.
      // Without this we'd get every public repo on GitLab (millions).
      membership:   true,
      order_by:     'last_activity_at',
      sort:         'desc',
      page,
      per_page:     perPage,
    },
  });

  // GitLab includes pagination info in the response headers.
  const totalPages = parseInt(response.headers['x-total-pages'] || '1', 10);

  return {
    repositories: response.data,
    totalPages,
    currentPage:  page,
  };
}

/**
 * searchRepositories
 * Filters the user's repos by name — called as the user types in the search box.
 *
 * @param {string} query - Search term
 *
 * Returns: array of project objects
 */
async function searchRepositories(query) {
  const response = await apiClient.get('/projects', {
    params: {
      membership: true,
      search:     query,    // GitLab matches repos whose name contains this string
      order_by:   'last_activity_at',
      sort:       'desc',
      per_page:   20,
    },
  });

  return response.data;
}

// ════════════════════════════════════════════════════════════
// DAY 3 — Repository file access for scanning
// ════════════════════════════════════════════════════════════

/**
 * getDefaultBranch
 * Finds the repo's default branch (could be 'main', 'master', or custom).
 * We need this before reading any files so we target the right branch.
 *
 * @param {number} projectId - GitLab project ID
 *
 * Returns: branch name string, e.g. 'main'
 */
async function getDefaultBranch(projectId) {
  const response = await apiClient.get(`/projects/${projectId}`);
  return response.data.default_branch;
}

/**
 * getRepositoryTree
 * Lists ALL files in the repo (recursively) as a flat array.
 * Does NOT download file contents — just paths and types.
 *
 * FIX 1: Now paginates through ALL pages instead of stopping at 100.
 * GitLab returns max 100 items per page. A real project can have thousands
 * of files — without pagination we'd silently miss files on page 2+.
 *
 * @param {number} projectId - GitLab project ID
 * @param {string} path      - Subfolder to list. '' = repo root
 * @param {string} branch    - Branch name from getDefaultBranch()
 *
 * Returns: array of { id, name, type ('blob'|'tree'), path, mode }
 *   'blob' = file,  'tree' = directory
 */
async function getRepositoryTree(projectId, path = '', branch = 'main') {
  let allItems = [];
  let page     = 1;
  let hasMore  = true;

  while (hasMore) {
    const response = await apiClient.get(`/projects/${projectId}/repository/tree`, {
      params: {
        path,
        ref:       branch,
        recursive: true,
        per_page:  100,   // Max GitLab allows per page
        page,
      },
    });

    allItems = allItems.concat(response.data);

    // GitLab tells us the total number of pages in the response headers.
    // If we are on the last page, stop the loop.
    const totalPages = parseInt(response.headers['x-total-pages'] || '1', 10);
    hasMore = page < totalPages;
    page++;
  }

  console.log(`[GitLabClient] getRepositoryTree fetched ${allItems.length} items across ${page - 1} page(s)`);
  return allItems;
}

/**
 * downloadInBatches
 * Downloads multiple files with a concurrency limit to avoid hitting
 * GitLab's rate limit (300 requests/minute per user token).
 *
 * FIX 2: Instead of firing all downloads simultaneously (which can
 * trigger 429 Too Many Requests on large repos), this processes files
 * in groups of `batchSize` with a short pause between each group.
 *
 * @param {string[]} filePaths  - Array of file paths to download
 * @param {number}   projectId  - GitLab project ID
 * @param {string}   branch     - Branch to read from
 * @param {number}   batchSize  - Max concurrent downloads (default 5)
 * @param {Function} onProgress - Optional progress callback
 *
 * Returns: array of Promise.allSettled results
 */
async function downloadInBatches(filePaths, projectId, branch, batchSize = 5, onProgress = () => {}) {
  const results   = [];
  const total     = filePaths.length;

  for (let i = 0; i < total; i += batchSize) {
    // Slice out the next batch of up to `batchSize` files
    const batch = filePaths.slice(i, i + batchSize);

    onProgress(`Downloading files ${i + 1}–${Math.min(i + batchSize, total)} of ${total}...`);

    // Download this batch in parallel — safe because it is only 5 at a time
    const batchResults = await Promise.allSettled(
      batch.map(async (filePath) => {
        const content = await getFileContent(projectId, filePath, branch);
        return { path: filePath, content };
      })
    );

    results.push(...batchResults);

    // Pause 200ms between batches so we stay well under GitLab's rate limit.
    // At 5 files per batch + 200ms pause, we max out at ~25 requests/second —
    // safely below the 300/minute (~5/second average) limit.
    const isLastBatch = i + batchSize >= total;
    if (!isLastBatch) {
      await new Promise(resolve => setTimeout(resolve, 200));
    }
  }

  return results;
}

/**
 * getFileContent
 * Downloads and decodes a single file's contents as a UTF-8 string.
 * GitLab returns file contents as Base64, so we decode before returning.
 *
 * @param {number} projectId - GitLab project ID
 * @param {string} filePath  - Path to file e.g. 'package.json' or 'src/app.py'
 * @param {string} branch    - Branch to read from
 *
 * Returns: file contents as a plain string
 */
async function getFileContent(projectId, filePath, branch = 'main') {
  // File paths must be URL-encoded. Slashes become %2F, dots become %2E etc.
  // Without this, 'src/app.py' would be treated as a URL path segment.
  const encodedPath = encodeURIComponent(filePath);

  const response = await apiClient.get(
    `/projects/${projectId}/repository/files/${encodedPath}`,
    { params: { ref: branch } }
  );

  // GitLab sends: { content: '<base64 string>', encoding: 'base64', ... }
  // Buffer.from(..., 'base64').toString() decodes it back to plain text.
  return Buffer.from(response.data.content, 'base64').toString('utf-8');
}

// ════════════════════════════════════════════════════════════
// DAY 6 — Pipeline commit and status
// ════════════════════════════════════════════════════════════

/**
 * commitFile
 * Creates or updates a single file in a GitLab repo.
 * Uses PUT if the file already exists, POST if it doesn't.
 * GitLab automatically triggers a pipeline on the commit.
 *
 * @param {number} projectId     - GitLab project ID
 * @param {string} filePath      - File path in repo e.g. '.gitlab-ci.yml'
 * @param {string} content       - File content as a plain string
 * @param {string} message       - Commit message
 * @param {string} branch        - Target branch (usually the default branch)
 *
 * Returns: { id, short_id, title, ... } — the GitLab commit object
 */
async function commitFile(projectId, filePath, content, message, branch) {
  const encodedPath = encodeURIComponent(filePath);
  const payload = {
    branch,
    content,
    commit_message: message,
    encoding: 'text',
  };

  try {
    // Try PUT first (update existing file)
    const response = await apiClient.put(
      `/projects/${projectId}/repository/files/${encodedPath}`,
      payload
    );
    return response.data;
  } catch (err) {
    if (err.response?.status === 400 || err.response?.status === 404) {
      // File doesn't exist yet — create it with POST
      const response = await apiClient.post(
        `/projects/${projectId}/repository/files/${encodedPath}`,
        payload
      );
      return response.data;
    }
    throw err;
  }
}

/**
 * getProjectPipelines
 * Lists the most recent pipelines for a project.
 * Used after committing to find the pipeline that was just triggered.
 *
 * @param {number} projectId - GitLab project ID
 * @param {number} limit     - Max pipelines to return (default 5)
 *
 * Returns: array of pipeline objects (id, sha, status, web_url, ...)
 */
async function getProjectPipelines(projectId, limit = 5) {
  const response = await apiClient.get(`/projects/${projectId}/pipelines`, {
    params: {
      order_by: 'id',
      sort:     'desc',
      per_page: limit,
    },
  });
  return response.data;
}

/**
 * getPipelineJobs
 * Fetches the list of jobs for a specific pipeline.
 * Each job represents one CI stage step (build-image, deploy-cloud-run, etc.)
 * with its own status, log URL, and timing.
 *
 * @param {number} projectId  - GitLab project ID
 * @param {number} pipelineId - Pipeline ID
 *
 * Returns: array of job objects (id, name, stage, status, web_url, ...)
 */
async function getPipelineJobs(projectId, pipelineId) {
  const response = await apiClient.get(
    `/projects/${projectId}/pipelines/${pipelineId}/jobs`,
    { params: { per_page: 50 } }
  );
  return response.data;
}

// ════════════════════════════════════════════════════════════
// DAY 7 — Log fetching
// ════════════════════════════════════════════════════════════

/**
 * getJobLog
 * Downloads the raw console log for a single CI job.
 * GitLab returns logs as plain text (ANSI escape codes included).
 * The log grows while the job is running — call again to get new lines.
 *
 * @param {number} projectId - GitLab project ID
 * @param {number} jobId     - Job ID (from getPipelineJobs)
 *
 * Returns: raw log as a plain string
 */
async function getJobLog(projectId, jobId) {
  const response = await apiClient.get(
    `/projects/${projectId}/jobs/${jobId}/trace`,
    {
      // The log endpoint returns plain text, not JSON
      responseType: 'text',
      headers: { Accept: 'text/plain' },
    }
  );
  return response.data || '';
}

module.exports = {
  // Day 2
  getCurrentUser,
  getUserRepositories,
  searchRepositories,
  // Day 3
  getDefaultBranch,
  getRepositoryTree,
  getFileContent,
  downloadInBatches,
  // Day 6
  commitFile,
  getProjectPipelines,
  getPipelineJobs,
  // Day 7
  getJobLog,
};