#!/usr/bin/env node
// scripts/trigger-pipeline.js
// Trigger a GitLab pipeline via API.
// Usage: node scripts/trigger-pipeline.js <projectId> [branch]
//   or:  GITLAB_TOKEN=<token> node scripts/trigger-pipeline.js <projectId> [branch]
// Auth (first available):
//   - GITLAB_TOKEN — PAT or project/group access token (PRIVATE-TOKEN header)
//   - CI_JOB_TOKEN — same-project pipeline trigger from CI/Duo workload (JOB-TOKEN header)
// Env: optional GITLAB_URL (default https://gitlab.com)
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

const usePrivate = Boolean(process.env.GITLAB_TOKEN);
const jobTok = process.env.CI_JOB_TOKEN;
const token = process.env.GITLAB_TOKEN || jobTok;

if (!projectId || !token) {
  console.error('Usage: GITLAB_TOKEN=<token> node scripts/trigger-pipeline.js <projectId> [branch]');
  console.error('   or: CI_JOB_TOKEN is set (e.g. Duo/CI) node scripts/trigger-pipeline.js <projectId> [branch]');
  console.error('Example: GITLAB_TOKEN=glpat-xxx node scripts/trigger-pipeline.js 80120689 main');
  process.exit(1);
}

const authHeaders = usePrivate
  ? { 'PRIVATE-TOKEN': process.env.GITLAB_TOKEN }
  : { 'JOB-TOKEN': jobTok };

const url = `${baseUrl}/api/v4/projects/${encodeURIComponent(projectId)}/pipeline`;

axios
  .post(
    url,
    { ref: branch },
    {
      headers: {
        ...authHeaders,
        'Content-Type': 'application/json',
      },
    }
  )
  .then(({ data }) => {
    console.log('Pipeline triggered:', data.id, data.web_url || data.status);
  })
  .catch((err) => {
    const msg = err.response?.data?.message || err.response?.data?.error || err.message;
    console.error('Error:', msg);
    process.exit(1);
  });
