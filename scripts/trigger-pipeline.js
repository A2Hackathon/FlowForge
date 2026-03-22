#!/usr/bin/env node
// scripts/trigger-pipeline.js
// Trigger a GitLab pipeline via API.
// Usage: node scripts/trigger-pipeline.js <projectId> [branch]
//
// Auth (order):
//   1) FLOWFORGE_GITLAB_TRIGGER_TOKEN / GITLAB_TRIGGER_TOKEN — Pipeline trigger (POST .../trigger/pipeline)
//   2) FLOWFORGE_GITLAB_API_TOKEN — PRIVATE-TOKEN (use this for a Project access token in Duo; see below)
//   3) GITLAB_TOKEN — PRIVATE-TOKEN only when **not** in GitLab CI, or when FLOWFORGE_ALLOW_GITLAB_TOKEN=1 (Duo injects GITLAB_TOKEN in CI → 401)
//   4) CI_JOB_TOKEN — JOB-TOKEN (often 401)
//
// In GitLab CI, use FLOWFORGE_GITLAB_API_TOKEN for your glpat (never rely on GITLAB_TOKEN here).
// dotenv: override:false so CI wins over .env

const path = require('path');
const crypto = require('crypto');
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
    'FLOWFORGE_GITLAB_API_TOKEN',
    'GITLAB_TOKEN',
    '$FLOWFORGE_GITLAB_TRIGGER_TOKEN',
    '${FLOWFORGE_GITLAB_TRIGGER_TOKEN}',
    '$FLOWFORGE_GITLAB_API_TOKEN',
    '${FLOWFORGE_GITLAB_API_TOKEN}',
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

let privateToken = '';
let privateSource = '';
if (process.env.FLOWFORGE_GITLAB_API_TOKEN && String(process.env.FLOWFORGE_GITLAB_API_TOKEN).trim()) {
  privateToken = sanitizeTriggerToken(process.env.FLOWFORGE_GITLAB_API_TOKEN, 'FLOWFORGE_GITLAB_API_TOKEN');
  privateSource = 'FLOWFORGE_GITLAB_API_TOKEN';
} else if (process.env.GITLAB_TOKEN && String(process.env.GITLAB_TOKEN).trim()) {
  privateToken = sanitizeTriggerToken(process.env.GITLAB_TOKEN, 'GITLAB_TOKEN');
  privateSource = 'GITLAB_TOKEN';
}

const jobTok = process.env.CI_JOB_TOKEN;
const hasPrivate = Boolean(privateToken && privateToken.length > 0);
const hasJob = Boolean(jobTok && jobTok.length > 0);

/** SHA-256 (utf8) of the secret used for the API call — compare locally to your token to confirm CI injected the right value. */
function sha256Hex(secret) {
  return crypto.createHash('sha256').update(String(secret), 'utf8').digest('hex');
}

// Safe diagnostics (no raw token values)
console.log(
  '[trigger-pipeline] auth:',
  triggerToken
    ? `pipeline trigger token (length ${triggerToken.length})`
    : hasPrivate
      ? `PRIVATE-TOKEN from ${privateSource} (length ${privateToken.length})`
      : hasJob
        ? 'CI_JOB_TOKEN (may 401 on POST /pipeline)'
        : 'none'
);
// Fingerprint of the credential GitLab injected (verify locally: printf '%s' 'your-token' | shasum -a 256)
if (triggerToken) {
  console.log('[trigger-pipeline] sha256(pipeline trigger token)=', sha256Hex(triggerToken));
} else if (hasPrivate) {
  console.log(`[trigger-pipeline] sha256(${privateSource})=`, sha256Hex(privateToken));
} else if (hasJob) {
  console.log('[trigger-pipeline] sha256(CI_JOB_TOKEN)=', sha256Hex(jobTok));
}

// Duo workloads often omit CI=true / GITLAB_CI — but CI_JOB_TOKEN is always set on GitLab Runner jobs.
const inGitLabRunnerJob =
  Boolean(process.env.CI_JOB_TOKEN && String(process.env.CI_JOB_TOKEN).trim()) ||
  process.env.GITLAB_CI === 'true' ||
  process.env.CI === 'true' ||
  process.env.CI === '1';
const allowGitlabTokenInCi =
  process.env.FLOWFORGE_ALLOW_GITLAB_TOKEN === '1' ||
  process.env.FLOWFORGE_ALLOW_GITLAB_TOKEN === 'true';

if (inGitLabRunnerJob && privateSource === 'GITLAB_TOKEN' && !allowGitlabTokenInCi) {
  console.error('');
  console.error('[trigger-pipeline] Refusing to use GITLAB_TOKEN in GitLab CI for this API.');
  console.error('Duo and other jobs inject their own GITLAB_TOKEN — it is not your project access token.');
  console.error('');
  console.error('Fix: Settings → CI/CD → Variables → add');
  console.error('  Key:   FLOWFORGE_GITLAB_API_TOKEN');
  console.error('  Value: your Project access token secret (glpat-... from Settings → Access tokens)');
  console.error('Or use FLOWFORGE_GITLAB_TRIGGER_TOKEN from Pipeline triggers.');
  console.error('Escape hatch (not recommended): FLOWFORGE_ALLOW_GITLAB_TOKEN=1');
  console.error('');
  process.exit(1);
}

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
      console.error('401 on PRIVATE-TOKEN: wrong/expired token, or Duo injected a different GITLAB_TOKEN.');
      console.error('Fix: Create a Project access token (api scope), add CI/CD variable FLOWFORGE_GITLAB_API_TOKEN = the glpat-... secret (not the token name). Do not rely on GITLAB_TOKEN in Duo workloads.');
    } else {
      console.error('');
      console.error('401 on JOB-TOKEN: usually not allowed to create pipelines. Use FLOWFORGE_GITLAB_TRIGGER_TOKEN or FLOWFORGE_GITLAB_API_TOKEN.');
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
  console.error('No auth: set FLOWFORGE_GITLAB_TRIGGER_TOKEN (Pipeline trigger), or FLOWFORGE_GITLAB_API_TOKEN (project token glpat-...), or CI_JOB_TOKEN.');
  console.error('If the variable is set in GitLab but empty here: use the same variable name; check Protected/Environment scope; Duo must run on a ref that receives the variable.');
  process.exit(1);
}
