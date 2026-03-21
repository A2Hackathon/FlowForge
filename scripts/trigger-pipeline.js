#!/usr/bin/env node
// scripts/trigger-pipeline.js
// Trigger a GitLab pipeline via API.
// Usage: node scripts/trigger-pipeline.js <projectId> [branch]
//
// Auth (try in order — Duo/CI often gets 401 with CI_JOB_TOKEN alone):
//   1) FLOWFORGE_GITLAB_TRIGGER_TOKEN or GITLAB_TRIGGER_TOKEN — Pipeline trigger token
//      (Settings → CI/CD → Pipeline triggers). POST .../trigger/pipeline — most reliable in Duo.
//   2) GITLAB_TOKEN — PAT or project/group access token with "api" (PRIVATE-TOKEN)
//   3) CI_JOB_TOKEN — JOB-TOKEN (often rejected for POST .../pipeline → 401)
//
// Env: optional GITLAB_URL (default https://gitlab.com), FLOWFORGE_DEPLOY_REF / CI_DEFAULT_BRANCH for branch
// Loads .env from project root if present.

try {
  require('dotenv').config({ path: require('path').resolve(__dirname, '..', '.env') });
} catch (_) {}

const axios = require('axios');

const projectId = process.argv[2];
const branch =
  process.argv[3] ||
  process.env.FLOWFORGE_DEPLOY_REF ||
  process.env.CI_DEFAULT_BRANCH ||
  'main';
const baseUrl = (process.env.GITLAB_URL || 'https://gitlab.com').replace(/\/$/, '');

const triggerToken = process.env.FLOWFORGE_GITLAB_TRIGGER_TOKEN || process.env.GITLAB_TRIGGER_TOKEN;
const privateToken = process.env.GITLAB_TOKEN;
const jobTok = process.env.CI_JOB_TOKEN;

if (!projectId) {
  console.error('Usage: node scripts/trigger-pipeline.js <projectId> [branch]');
  process.exit(1);
}

function print401Hint() {
  console.error('');
  console.error('401 usually means CI_JOB_TOKEN cannot create pipelines on this GitLab instance.');
  console.error('Fix (pick one):');
  console.error('  A) Settings → CI/CD → Pipeline triggers → Add trigger → copy token →');
  console.error('     set masked variable FLOWFORGE_GITLAB_TRIGGER_TOKEN in CI/CD variables.');
  console.error('  B) Settings → Access tokens → create project token with "api" → set GITLAB_TOKEN.');
  console.error('');
}

function handleSuccess({ data }) {
  console.log('Pipeline triggered:', data.id, data.web_url || data.status || '');
}

function handleError(err) {
  const status = err.response?.status;
  const body = err.response?.data;
  const msg =
    (typeof body?.message === 'string' && body.message) ||
    (Array.isArray(body?.message) && body.message.join('; ')) ||
    body?.error ||
    err.message;
  console.error('Error:', status || '', msg);
  if (status === 401) {
    print401Hint();
  }
  process.exit(1);
}

// 1) Pipeline trigger token (recommended for Duo / automation)
if (triggerToken) {
  const url = `${baseUrl}/api/v4/projects/${encodeURIComponent(projectId)}/trigger/pipeline`;
  axios
    .post(url, new URLSearchParams({ token: triggerToken, ref: branch }), {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    })
    .then(handleSuccess)
    .catch(handleError);
} else if (privateToken) {
  const url = `${baseUrl}/api/v4/projects/${encodeURIComponent(projectId)}/pipeline`;
  axios
    .post(
      url,
      { ref: branch },
      {
        headers: {
          'PRIVATE-TOKEN': privateToken,
          'Content-Type': 'application/json',
        },
      }
    )
    .then(handleSuccess)
    .catch(handleError);
} else if (jobTok) {
  const url = `${baseUrl}/api/v4/projects/${encodeURIComponent(projectId)}/pipeline`;
  axios
    .post(
      url,
      { ref: branch },
      {
        headers: {
          'JOB-TOKEN': jobTok,
          'Content-Type': 'application/json',
        },
      }
    )
    .then(handleSuccess)
    .catch(handleError);
} else {
  console.error('No auth: set FLOWFORGE_GITLAB_TRIGGER_TOKEN (Pipeline trigger token), or GITLAB_TOKEN (api), or CI_JOB_TOKEN.');
  console.error('Duo: prefer FLOWFORGE_GITLAB_TRIGGER_TOKEN — see README "Deploy to GCP after Duo".');
  process.exit(1);
}
