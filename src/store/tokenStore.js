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

const crypto = require('crypto');

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

let _warnedShortPatFallback = false;

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
    if (gitlab && gitlab.length < MIN_PLAUSIBLE_PAT_LEN && !_warnedShortPatFallback) {
      _warnedShortPatFallback = true;
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
 * Never prints raw token values (they would leak in CI logs). Use SHA-256 prefix to compare locally.
 */
function sha256Prefix16(value) {
  if (!value) return '(empty)';
  return crypto.createHash('sha256').update(value, 'utf8').digest('hex').slice(0, 16);
}

/**
 * Logs non-secret diagnostics when FLOWFORGE_LOG_GITLAB_TOKEN_META=1|true.
 */
function logGitlabTokenMeta() {
  const enabled =
    process.env.FLOWFORGE_LOG_GITLAB_TOKEN_META === '1' ||
    process.env.FLOWFORGE_LOG_GITLAB_TOKEN_META === 'true';
  if (!enabled) return;

  const gitlab = process.env.GITLAB_TOKEN;
  const job = process.env.CI_JOB_TOKEN;
  const effective = getAccessToken() || '';
  const usesJob = Boolean(job && effective === job);

  console.error(
    '[flow] GitLab token meta (raw secrets never printed; compare sha256 locally): ' +
      `GITLAB_TOKEN_len=${gitlab ? gitlab.length : 0}, ` +
      `GITLAB_TOKEN_sha256_16=${sha256Prefix16(gitlab)}, ` +
      `CI_JOB_TOKEN_len=${job ? job.length : 0}, ` +
      `effective_len=${effective.length}, ` +
      `effective_sha256_16=${sha256Prefix16(effective)}, ` +
      `effective_is_ci_job_token=${usesJob}, ` +
      `GITLAB_TOKEN_starts_with_glpat=${Boolean(gitlab && gitlab.startsWith('glpat-'))}`
  );
  if (usesJob) {
    console.error(
      '[flow] GitLab auth: API calls use **CI_JOB_TOKEN** (same-project job token). ' +
        'Your CI/CD variable GITLAB_TOKEN is not a valid PAT (wrong length or wrong value); it is ignored. ' +
        'To use a PAT instead: delete the bad GITLAB_TOKEN variable or paste a full token starting with glpat-.'
    );
  }
}

module.exports = {
  saveTokens,
  getAccessToken,
  getRefreshToken,
  clearTokens,
  isLoggedIn,
  logGitlabTokenMeta,
};