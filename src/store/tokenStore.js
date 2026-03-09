// src/store/tokenStore.js
// ─────────────────────────────────────────────────────────────
// Saves the GitLab OAuth tokens to the user's disk so they stay
// logged in between app sessions.
//
// electron-store writes a JSON file to the OS app-data folder:
//   Windows : %APPDATA%/cloudmapper/config.json
//   Mac     : ~/Library/Application Support/cloudmapper/config.json
//   Linux   : ~/.config/cloudmapper/config.json
//
// We never store tokens in memory only — closing the app would
// log the user out every single time.
// ─────────────────────────────────────────────────────────────

const Store = require('electron-store');

const store = new Store({
  schema: {
    // The Bearer token attached to every GitLab API request.
    accessToken: {
      type: ['string', 'null'],
      default: null,
    },
    // Used to silently renew the access token without a new login.
    refreshToken: {
      type: ['string', 'null'],
      default: null,
    },
    // Unix timestamp (ms) when the access token expires.
    // We compare this against Date.now() before every API call.
    tokenExpiresAt: {
      type: ['number', 'null'],
      default: null,
    },
  },
});

/**
 * saveTokens
 * Called immediately after a successful OAuth login.
 *
 * @param {string} accessToken  - The token from GitLab
 * @param {string} refreshToken - The refresh token from GitLab
 * @param {number} expiresIn    - Seconds until access token expires
 */
function saveTokens(accessToken, refreshToken, expiresIn) {
  store.set('accessToken', accessToken);
  store.set('refreshToken', refreshToken);
  // Convert relative "expires in X seconds" to an absolute timestamp.
  // e.g. expiresIn=7200 → store.now + 2 hours
  store.set('tokenExpiresAt', Date.now() + expiresIn * 1000);
}

/**
 * getAccessToken
 * Returns the access token if it exists and has not expired.
 * Returns null if the user isn't logged in or the token is stale.
 */
function getAccessToken() {
  const token     = store.get('accessToken');
  const expiresAt = store.get('tokenExpiresAt');

  if (!token) return null;

  // Token exists but has expired — signal the caller to refresh it.
  if (expiresAt && Date.now() > expiresAt) {
    console.warn('[TokenStore] Access token expired');
    return null;
  }

  return token;
}

/**
 * getRefreshToken
 * Returns the refresh token so gitlabAuth can obtain a new access token.
 */
function getRefreshToken() {
  return store.get('refreshToken');
}

/**
 * clearTokens
 * Logs the user out by deleting all token data from disk.
 */
function clearTokens() {
  store.delete('accessToken');
  store.delete('refreshToken');
  store.delete('tokenExpiresAt');
}

/**
 * isLoggedIn
 * Quick boolean check used on app startup to decide which screen to show.
 */
function isLoggedIn() {
  return getAccessToken() !== null;
}

module.exports = { saveTokens, getAccessToken, getRefreshToken, clearTokens, isLoggedIn };
