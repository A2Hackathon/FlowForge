// src/store/tokenStore.js
// ─────────────────────────────────────────────────────────────
// Persists GitLab OAuth tokens between app sessions.
//
// This is the ONLY thing we store on disk. All other credentials
// (Anthropic API key, GCP project ID, GCP API key) come from the
// .env file loaded at startup — no UI, no database, no electron-store
// fields for them.
//
// For CLI/CI (no Electron): set GITLAB_TOKEN (full glpat-... PAT), or rely on
// CI_JOB_TOKEN in GitLab CI when GITLAB_TOKEN is missing / too short (see getAccessToken).
//
// electron-store writes to:
//   Windows : %APPDATA%/cloudmapper/config.json
//   Mac     : ~/Library/Application Support/cloudmapper/config.json
//   Linux   : ~/.config/cloudmapper/config.json
// ─────────────────────────────────────────────────────────────

let store = null;
try {
  const Store = require('electron-store');
  store = new Store({
    schema: {
      accessToken:    { type: ['string', 'null'], default: null },
      refreshToken:   { type: ['string', 'null'], default: null },
      tokenExpiresAt: { type: ['number', 'null'], default: null },
    },
  });
} catch (err) {
  // Not in Electron (e.g. CLI / CI); use GITLAB_TOKEN from env only
}

/** Real GitLab PATs (glpat-...) are longer; shorter values are usually a bad CI variable. */
const MIN_PLAUSIBLE_PAT_LEN = 20;

function isGitLabCi() {
  return process.env.CI === 'true' || process.env.GITLAB_CI === 'true';
}

// ════════════════════════════════════════════════════════════
// GitLab OAuth tokens
// ════════════════════════════════════════════════════════════

/**
 * saveTokens
 * Called immediately after a successful OAuth login.
 * @param {string} accessToken
 * @param {string} refreshToken
 * @param {number} expiresIn - seconds until the access token expires
 */
function saveTokens(accessToken, refreshToken, expiresIn) {
  if (store) {
    store.set('accessToken',    accessToken);
    store.set('refreshToken',   refreshToken);
    store.set('tokenExpiresAt', Date.now() + expiresIn * 1000);
  }
}

/**
 * getAccessToken
 * Returns the access token if it exists and hasn't expired, else null.
 * In CLI/CI (no Electron): prefers a full PAT in GITLAB_TOKEN; in GitLab CI, if that
 * value is missing or implausibly short (wrong paste / name / ID), uses CI_JOB_TOKEN
 * so the same-project API works without a separate PAT.
 */
function getAccessToken() {
  const gitlab = process.env.GITLAB_TOKEN;
  const jobTok = process.env.CI_JOB_TOKEN;

  if (gitlab && gitlab.length >= MIN_PLAUSIBLE_PAT_LEN) {
    return gitlab;
  }

  if (isGitLabCi() && jobTok) {
    if (gitlab && gitlab.length < MIN_PLAUSIBLE_PAT_LEN) {
      console.warn(
        '[TokenStore] GITLAB_TOKEN is missing or too short to be a real PAT; using CI_JOB_TOKEN for this job. ' +
          'Remove or fix the GITLAB_TOKEN CI/CD variable, or paste a full token (starts with glpat-).'
      );
    }
    return jobTok;
  }

  if (gitlab) return gitlab;
  if (!store) return null;
  const token     = store.get('accessToken');
  const expiresAt = store.get('tokenExpiresAt');
  if (!token) return null;
  if (expiresAt && Date.now() > expiresAt) {
    console.warn('[TokenStore] Access token expired');
    return null;
  }
  return token;
}

function getRefreshToken() {
  return store ? store.get('refreshToken') : null;
}

/**
 * clearTokens
 * Logs the user out by removing all token data from disk.
 */
function clearTokens() {
  if (store) {
    store.delete('accessToken');
    store.delete('refreshToken');
    store.delete('tokenExpiresAt');
  }
}

/**
 * isLoggedIn
 * Quick check used on startup to decide which screen to show.
 */
function isLoggedIn() {
  return getAccessToken() !== null;
}

/**
 * Logs non-secret diagnostics when FLOWFORGE_LOG_GITLAB_TOKEN_META=1|true.
 * Never prints token values (unsafe in CI logs).
 */
function logGitlabTokenMeta() {
  const enabled =
    process.env.FLOWFORGE_LOG_GITLAB_TOKEN_META === '1' ||
    process.env.FLOWFORGE_LOG_GITLAB_TOKEN_META === 'true';
  if (!enabled) return;

  const gitlab = process.env.GITLAB_TOKEN;
  const job = process.env.CI_JOB_TOKEN;
  const effective = getAccessToken() || '';
  console.error(
    '[flow] GitLab token meta (values never logged): ' +
      `GITLAB_TOKEN_len=${gitlab ? gitlab.length : 0}, ` +
      `CI_JOB_TOKEN_len=${job ? job.length : 0}, ` +
      `effective_len=${effective.length}, ` +
      `effective_is_ci_job_token=${Boolean(job && effective === job)}, ` +
      `GITLAB_TOKEN_starts_with_glpat=${Boolean(gitlab && gitlab.startsWith('glpat-'))}`
  );
}

module.exports = {
  saveTokens,
  getAccessToken,
  getRefreshToken,
  clearTokens,
  isLoggedIn,
  logGitlabTokenMeta,
};