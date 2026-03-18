// src/auth/oauthServer.js
// ─────────────────────────────────────────────────────────────
// After the user logs in on GitLab's website, GitLab redirects
// their browser back to a URL we own — but we're a desktop app,
// not a website.
//
// Solution: spin up a tiny temporary Express server on localhost
// JUST long enough to catch the redirect, extract the 'code'
// parameter from the URL, then shut down immediately.
//
// Flow:
//   1. gitlabAuth.js calls startOAuthCallbackServer()
//   2. We start Express on port 3000
//   3. gitlabAuth.js opens the user's browser to GitLab
//   4. User logs in, GitLab redirects to http://localhost:3000/callback?code=XYZ
//   5. Our /callback route fires, we grab 'code', show success, shut down
//   6. The Promise resolves with 'code' back to gitlabAuth.js
// ─────────────────────────────────────────────────────────────

const express = require('express');
const http    = require('http');

const CALLBACK_PORT = 3000;

// This must exactly match the Redirect URI you set in your GitLab OAuth app:
// GitLab → Settings → Applications → your app → Redirect URI
const REDIRECT_URI = `http://localhost:${CALLBACK_PORT}/callback`;

/**
 * startOAuthCallbackServer
 *
 * Starts the server and returns a Promise that resolves with the
 * authorization code once GitLab redirects the user back.
 * Rejects if the user denies access or the 5-minute timeout expires.
 */
function startOAuthCallbackServer(expectedState) {
  return new Promise((resolve, reject) => {
    const app    = express();
    const server = http.createServer(app);

    // Safety net: if the user never completes the login flow, clean up.
    const timeout = setTimeout(() => {
      server.close();
      reject(new Error('OAuth login timed out after 5 minutes'));
    }, 5 * 60 * 1000);

    // ── /callback route ──────────────────────────────────────
    // GitLab sends the user here after they approve or deny access.
    // URL looks like: http://localhost:3000/callback?code=abc123&state=xyz
    app.get('/callback', (req, res) => {
      const { code, error, state } = req.query;

      // User denied access, or something went wrong on GitLab's side.
      if (error) {
        res.send('<h2 style="font-family:Arial">Login cancelled. You can close this tab.</h2>');
        clearTimeout(timeout);
        server.close();
        reject(new Error(`GitLab OAuth error: ${error}`));
        return;
      }

      if (expectedState && state !== expectedState) {
        res.send('<h2 style="font-family:Arial">Invalid login state. You can close this tab.</h2>');
        clearTimeout(timeout);
        server.close();
        reject(new Error('Invalid OAuth state in callback URL'));
        return;
      }

      if (!code) {
        res.send('<h2 style="font-family:Arial">No code received. You can close this tab.</h2>');
        clearTimeout(timeout);
        server.close();
        reject(new Error('No authorization code in callback URL'));
        return;
      }

      // Show a success page. The user can now close the browser tab.
      res.send(`
        <html>
          <body style="font-family:Arial;text-align:center;padding:80px;background:#0f172a;color:#f8fafc">
            <h1>✅ Connected to GitLab!</h1>
            <p style="color:#94a3b8">You can close this tab and return to CloudMapper.</p>
          </body>
        </html>
      `);

      clearTimeout(timeout);

      // Short delay so the browser can render the page before we shut down.
      setTimeout(() => {
        server.close();
        resolve(code);
      }, 500);
    });

    server.listen(CALLBACK_PORT, () => {
      console.log(`[OAuthServer] Listening on port ${CALLBACK_PORT}`);
    });

    server.on('error', (err) => {
      clearTimeout(timeout);
      reject(new Error(`Could not start OAuth server on port ${CALLBACK_PORT}: ${err.message}`));
    });
  });
}

module.exports = { startOAuthCallbackServer, REDIRECT_URI };
