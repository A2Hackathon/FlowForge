require('dotenv').config();

const axios            = require('axios');
const { shell }        = require('electron');   // Opens URLs in the OS browser
const crypto           = require('crypto');     // Generates random state values
const { startOAuthCallbackServer, REDIRECT_URI } = require('./oauthServer');
const { saveTokens }   = require('../store/tokenStore');

// ── Config ────────────────────────────────────────────────────

const GITLAB_URL     = process.env.GITLAB_URL     || 'https://gitlab.com';
const CLIENT_ID      = process.env.GITLAB_CLIENT_ID     || 'YOUR_CLIENT_ID';
const CLIENT_SECRET  = process.env.GITLAB_CLIENT_SECRET || 'YOUR_CLIENT_SECRET';

// Scopes = permissions we're requesting from GitLab.

const SCOPES = 'read_user read_api write_repository';


let pendingState = null;

function generateState() {
  // 16 random bytes → 32-char hex string e.g. "a3f9b2c1..."
  return crypto.randomBytes(16).toString('hex');
}

/**
 * buildAuthUrl
 * Constructs the GitLab login page URL we open in the browser.
 * GitLab reads the query params to know what app is requesting access
 * and what permissions it wants.
 */
function buildAuthUrl() {
  pendingState = generateState();

  const params = new URLSearchParams({
    client_id:     CLIENT_ID,
    redirect_uri:  REDIRECT_URI,   // Where GitLab sends the user after login
    response_type: 'code',         // We want an auth code (not a token directly)
    state:         pendingState,   // CSRF protection
    scope:         SCOPES,
  });

  return `${GITLAB_URL}/oauth/authorize?${params.toString()}`;
}

/**
 * exchangeCodeForToken
 * POSTs the one-time code to GitLab's token endpoint and gets back
 * a real access token + refresh token.
 *
 * @param {string} code - The authorization code from the callback URL
 */
async function exchangeCodeForToken(code) {
  const response = await axios.post(`${GITLAB_URL}/oauth/token`, {
    client_id:     CLIENT_ID,
    client_secret: CLIENT_SECRET,
    code,
    grant_type:    'authorization_code',
    redirect_uri:  REDIRECT_URI,
  });

  // response.data looks like:
  // { access_token: '...', refresh_token: '...', expires_in: 7200, token_type: 'Bearer' }
  return response.data;
}

/**
 * login
 * The main function — call this when the user clicks "Connect GitLab".
 * Returns { success: true, accessToken } on success.
 */
async function login() {
  console.log('[GitLabAuth] Starting OAuth flow...');

  // Start the callback server BEFORE opening the browser.
  // If we did it the other way around, GitLab might redirect before
  // our server is ready to receive the request.
  const codePromise = startOAuthCallbackServer();

  // Open the GitLab login page in the user's default browser.
  // shell.openExternal() uses the OS to open the URL — Chrome, Firefox, etc.
  // We use the OS browser (not an Electron window) so the user benefits
  // from any existing GitLab session they already have.
  const authUrl = buildAuthUrl();
  await shell.openExternal(authUrl);

  console.log('[GitLabAuth] Waiting for user to log in...');

  // Wait here until oauthServer.js receives the callback from GitLab
  // and resolves the Promise with the authorization code.
  const code = await codePromise;

  console.log('[GitLabAuth] Code received, exchanging for token...');

  // Swap the one-time code for real tokens.
  const tokenData = await exchangeCodeForToken(code);

  // Persist tokens to disk so the user stays logged in.
  saveTokens(tokenData.access_token, tokenData.refresh_token, tokenData.expires_in);

  console.log('[GitLabAuth] Login successful');
  return { success: true, accessToken: tokenData.access_token };
}

/**
 * refreshAccessToken
 * Called automatically by the Axios interceptor (gitlabClient.js)
 * when a 401 response is received — silently renews without a new login.
 *
 * @param {string} refreshToken - The stored refresh token
 */
async function refreshAccessToken(refreshToken) {
  const response = await axios.post(`${GITLAB_URL}/oauth/token`, {
    client_id:     CLIENT_ID,
    client_secret: CLIENT_SECRET,
    refresh_token: refreshToken,
    grant_type:    'refresh_token',
  });

  const tokenData = response.data;
  saveTokens(tokenData.access_token, tokenData.refresh_token, tokenData.expires_in);
  return tokenData.access_token;
}

module.exports = { login, refreshAccessToken };
