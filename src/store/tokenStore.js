// src/store/tokenStore.js
// ─────────────────────────────────────────────────────────────
// Persists GitLab OAuth tokens between app sessions.
//
// This is the ONLY thing we store on disk. All other credentials
// (Anthropic API key, GCP project ID, GCP API key) come from the
// .env file loaded at startup — no UI, no database, no electron-store
// fields for them.
//
// For CLI/CI (no Electron): prefer FLOWFORGE_GITLAB_API_TOKEN (glpat) then GITLAB_TOKEN, or
// CI_JOB_TOKEN in GitLab CI when both are missing / too short (see getAccessToken).
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

/** User pasted the variable *name* into the Value field — not a real PAT. */
function isLiteralVariableNamePlaceholder(s) {
  if (!s || typeof s !== 'string') return false;
  const t = s.trim();
  return t === '$GITLAB_TOKEN' || t === '${GITLAB_TOKEN}' || t === '{{GITLAB_TOKEN}}';
}

function isLiteralFlowforgeApiPlaceholder(s) {
  if (!s || typeof s !== 'string') return false;
  const t = s.trim();
  return (
    t === 'FLOWFORGE_GITLAB_API_TOKEN' ||
    t === '$FLOWFORGE_GITLAB_API_TOKEN' ||
    t === '${FLOWFORGE_GITLAB_API_TOKEN}' ||
    t === '{{FLOWFORGE_GITLAB_API_TOKEN}}'
  );
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
  // Trim: GitLab CI variable values often pick up stray spaces/newlines when pasted.
  const rawGitlab = process.env.GITLAB_TOKEN;
  let gitlab = typeof rawGitlab === 'string' ? rawGitlab.trim() : rawGitlab;
  const jobTok = process.env.CI_JOB_TOKEN;

  if (isLiteralVariableNamePlaceholder(gitlab)) {
    if (!_warnedShortPatFallback) {
      _warnedShortPatFallback = true;
      console.warn(
        '[TokenStore] GITLAB_TOKEN is set to the literal text "$GITLAB_TOKEN" — that is NOT expanded by GitLab. ' +
          'Edit CI/CD → Variables → GITLAB_TOKEN and paste the real PAT (glpat-...) in the Value field. ' +
          'Using CI_JOB_TOKEN for this job.'
      );
    }
    gitlab = undefined;
  }

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

  const rawFf = process.env.FLOWFORGE_GITLAB_API_TOKEN;
  const ff = typeof rawFf === 'string' ? rawFf.trim() : '';
  const rawGitlab = process.env.GITLAB_TOKEN;
  const gitlab = typeof rawGitlab === 'string' ? rawGitlab.trim() : rawGitlab;
  const job = process.env.CI_JOB_TOKEN;
  const effective = getAccessToken() || '';
  const usesJob = Boolean(job && effective === job);

  const isPlaceholder = isLiteralVariableNamePlaceholder(gitlab);
  console.error(
    '[flow] GitLab token meta (raw secrets never printed; compare sha256 locally): ' +
      `FLOWFORGE_GITLAB_API_TOKEN_len=${ff ? ff.length : 0}, ` +
      `FLOWFORGE_GITLAB_API_TOKEN_sha256_16=${sha256Prefix16(ff)}, ` +
      `GITLAB_TOKEN_len=${gitlab ? gitlab.length : 0}, ` +
      `GITLAB_TOKEN_sha256_16=${sha256Prefix16(gitlab)}, ` +
      `GITLAB_TOKEN_is_literal_dollar_placeholder=${isPlaceholder}, ` +
      `CI_JOB_TOKEN_len=${job ? job.length : 0}, ` +
      `effective_len=${effective.length}, ` +
      `effective_sha256_16=${sha256Prefix16(effective)}, ` +
      `effective_is_ci_job_token=${usesJob}, ` +
      `GITLAB_TOKEN_starts_with_glpat=${Boolean(gitlab && gitlab.startsWith('glpat-'))}`
  );
  if (usesJob) {
    console.error(
      '[flow] GitLab auth: API calls use **CI_JOB_TOKEN** (same-project job token). ' +
        (isPlaceholder
          ? 'Fix: CI/CD variable GITLAB_TOKEN must be the actual glpat-... string, not the text "$GITLAB_TOKEN".'
          : 'Your CI/CD variable GITLAB_TOKEN is not a valid PAT (wrong length or wrong value); it is ignored. ' +
            'To use a PAT instead: delete the bad GITLAB_TOKEN variable or paste a full token starting with glpat-.')
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