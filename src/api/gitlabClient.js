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
// ─────────────────────────────────────────────────────────────

const axios = require('axios');
const { getAccessToken, getRefreshToken } = require('../store/tokenStore');
const { refreshAccessToken }              = require('../auth/gitlabAuth');

const GITLAB_URL = process.env.GITLAB_URL || 'https://gitlab.com';

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
    config.headers['Authorization'] = `Bearer ${token}`;
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
    if (error.response?.status === 401 && !originalRequest._retry) {
      originalRequest._retry = true;

      try {
        const newToken = await refreshAccessToken(getRefreshToken());
        originalRequest.headers['Authorization'] = `Bearer ${newToken}`;
        return apiClient(originalRequest);   // Retry with new token
      } catch {
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
 * Lists all files in the repo (recursively) as a flat array.
 * Does NOT download file contents — just paths and types.
 *
 * @param {number} projectId - GitLab project ID
 * @param {string} path      - Subfolder to list. '' = repo root
 * @param {string} branch    - Branch name from getDefaultBranch()
 *
 * Returns: array of { id, name, type ('blob'|'tree'), path, mode }
 *   'blob' = file,  'tree' = directory
 */
async function getRepositoryTree(projectId, path = '', branch = 'main') {
  const response = await apiClient.get(`/projects/${projectId}/repository/tree`, {
    params: {
      path,
      ref:       branch,
      recursive: true,    // Get all files in all subdirectories
      per_page:  100,
    },
  });

  return response.data;
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

module.exports = {
  // Day 2
  getCurrentUser,
  getUserRepositories,
  searchRepositories,
  // Day 3
  getDefaultBranch,
  getRepositoryTree,
  getFileContent,
};
