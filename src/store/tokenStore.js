// src/store/tokenStore.js
// ─────────────────────────────────────────────────────────────
// Persists GitLab OAuth tokens between app sessions.
//
// This is the ONLY thing we store on disk. All other credentials
// (Anthropic API key, GCP project ID, GCP API key) come from the
// .env file loaded at startup — no UI, no database, no electron-store
// fields for them.
//
// electron-store writes to:
//   Windows : %APPDATA%/cloudmapper/config.json
//   Mac     : ~/Library/Application Support/cloudmapper/config.json
//   Linux   : ~/.config/cloudmapper/config.json
// ─────────────────────────────────────────────────────────────

const Store = require('electron-store');

const store = new Store({
  schema: {
    accessToken: {
      type: ['string', 'null'],
      default: null,
    },
    refreshToken: {
      type: ['string', 'null'],
      default: null,
    },
    // Unix timestamp (ms) when the access token expires
    tokenExpiresAt: {
      type: ['number', 'null'],
      default: null,
    },
  },
});

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
  store.set('accessToken',    accessToken);
  store.set('refreshToken',   refreshToken);
  store.set('tokenExpiresAt', Date.now() + expiresIn * 1000);
}

/**
 * getAccessToken
 * Returns the access token if it exists and hasn't expired, else null.
 */
function getAccessToken() {
  const token     = store.get('accessToken');
  const expiresAt = store.get('tokenExpiresAt');
  if (!token) return null;
  if (expiresAt && Date.now() > expiresAt) {
    console.warn('[TokenStore] Access token expired');
    return null;
  }
  return token;
}

function getRefreshToken() { return store.get('refreshToken'); }

/**
 * clearTokens
 * Logs the user out by removing all token data from disk.
 */
function clearTokens() {
  store.delete('accessToken');
  store.delete('refreshToken');
  store.delete('tokenExpiresAt');
}

/**
 * isLoggedIn
 * Quick check used on startup to decide which screen to show.
 */
function isLoggedIn() {
  return getAccessToken() !== null;
}

module.exports = { saveTokens, getAccessToken, getRefreshToken, clearTokens, isLoggedIn };