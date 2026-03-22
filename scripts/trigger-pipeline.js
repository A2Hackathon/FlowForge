#!/usr/bin/env node
// scripts/trigger-pipeline.js
// Trigger a GitLab pipeline via API.
// Usage: node scripts/trigger-pipeline.js <projectId> [branch]
//
// Auth (order):
//   1) FLOWFORGE_GITLAB_TRIGGER_TOKEN / GITLAB_TRIGGER_TOKEN — Pipeline trigger token (POST .../trigger/pipeline)
//   2) GITLAB_TOKEN — PRIVATE-TOKEN + api scope
//   3) CI_JOB_TOKEN — JOB-TOKEN (often 401 on gitlab.com)
//
// Never put the variable *name* as the value in CI/CD Variables — the Value must be the glptt-... token string.
// dotenv must not override CI: override:false

const path = require('path');
try {
  require('dotenv').config({
    path: path.resolve(__dirname, '..', '.env'),
    override: false,
  });
} catch (_) {}

const axios = require('axios');

const projectId = process.argv[2];
const branch =
  process.argv[3] ||
  process.env.FLOWFORGE_DEPLOY_REF ||
  process.env.CI_DEFAULT_BRANCH ||
  'main';
const baseUrl = (process.env.GITLAB_URL || 'https://gitlab.com').replace(/\/$/, '');

if (!projectId) {
  console.error('Usage: node scripts/trigger-pipeline.js <projectId> [branch]');
  process.exit(1);
}

/** Reject common mistake: pasting the env var name as the secret value */
function sanitizeTriggerToken(raw, envKey) {
  if (raw == null || raw === '') return '';
  const s = String(raw).trim();
  const bad = new Set([
    envKey,
    'GITLAB_TRIGGER_TOKEN',
    'FLOWFORGE_GITLAB_TRIGGER_TOKEN',
    'GITLAB_TOKEN',
    '$FLOWFORGE_GITLAB_TRIGGER_TOKEN',
    '${FLOWFORGE_GITLAB_TRIGGER_TOKEN}',
    '$GITLAB_TRIGGER_TOKEN',
    '${GITLAB_TRIGGER_TOKEN}',
  ]);
  if (bad.has(s)) {
    console.error(
      `Error: ${envKey} is set to the literal text "${s}" instead of the real secret.`
    );
    console.error(
      'In GitLab → Settings → CI/CD → Variables: Key = FLOWFORGE_GITLAB_TRIGGER_TOKEN, Value = the glptt-... string from Pipeline triggers (not the name of the variable).'
    );
    process.exit(1);
  }
  return s;
}

const rawTrigger =
  process.env.FLOWFORGE_GITLAB_TRIGGER_TOKEN || process.env.GITLAB_TRIGGER_TOKEN;
const triggerToken = sanitizeTriggerToken(rawTrigger, 'FLOWFORGE_GITLAB_TRIGGER_TOKEN');
const privateToken = sanitizeTriggerToken(process.env.GITLAB_TOKEN, 'GITLAB_TOKEN');
const jobTok = process.env.CI_JOB_TOKEN;
const hasPrivate = Boolean(privateToken && privateToken.length > 0);
const hasJob = Boolean(jobTok && jobTok.length > 0);

// Safe diagnostics (no token values)
console.log(
  '[trigger-pipeline] auth:',
  triggerToken
    ? `pipeline trigger token (length ${triggerToken.length})`
    : hasPrivate
      ? `GITLAB_TOKEN (length ${privateToken.length})`
      : hasJob
        ? 'CI_JOB_TOKEN (may 401 on POST /pipeline)'
        : 'none'
);

function handleSuccess({ data }) {
  console.log('Pipeline triggered:', data.id, data.web_url || data.status || '');
}

function handleError(err, authKind) {
  const status = err.response?.status;
  const body = err.response?.data;
  const msg =
    (typeof body?.message === 'string' && body.message) ||
    (Array.isArray(body?.message) && body.message.join('; ')) ||
    body?.error ||
    err.message;
  console.error('Error:', status || '', msg);
  if (status === 401) {
    if (authKind === 'trigger') {
      console.error('');
      console.error('401 on Pipeline trigger API: wrong token, revoked trigger, or token created in a different project.');
      console.error('Regenerate: Settings → CI/CD → Pipeline triggers → add trigger → copy glptt-... into FLOWFORGE_GITLAB_TRIGGER_TOKEN value.');
    } else if (authKind === 'private') {
      console.error('');
      console.error('401 on PRIVATE-TOKEN: token expired, revoked, or missing "api" scope.');
    } else {
      console.error('');
      console.error('401 on JOB-TOKEN: usually not allowed to create pipelines. Use FLOWFORGE_GITLAB_TRIGGER_TOKEN (Pipeline trigger) or GITLAB_TOKEN (api).');
    }
  }
  process.exit(1);
}

// Node 18+ global FormData; if missing, use URL-encoded fallback
function postTriggerPipelineCompat(token) {
  const url = `${baseUrl}/api/v4/projects/${encodeURIComponent(projectId)}/trigger/pipeline`;
  if (typeof FormData !== 'undefined') {
    try {
      const fd = new FormData();
      fd.append('token', token);
      fd.append('ref', branch);
      return axios.post(url, fd);
    } catch (e) {
      /* fall through */
    }
  }
  return axios.post(
    url,
    new URLSearchParams({ token, ref: branch }),
    { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
  );
}

if (triggerToken) {
  postTriggerPipelineCompat(triggerToken)
    .then(handleSuccess)
    .catch((err) => handleError(err, 'trigger'));
} else if (hasPrivate) {
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
    .catch((err) => handleError(err, 'private'));
} else if (hasJob) {
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
    .catch((err) => handleError(err, 'job'));
} else {
  console.error('No auth: set FLOWFORGE_GITLAB_TRIGGER_TOKEN to the glptt-... secret from Pipeline triggers, or GITLAB_TOKEN (api), or CI_JOB_TOKEN.');
  console.error('If the variable is set in GitLab but empty here: use the same variable name; check Protected/Environment scope; Duo must run on a ref that receives the variable.');
  process.exit(1);
}
