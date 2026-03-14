#!/usr/bin/env node
// scripts/trigger-pipeline.js
// Trigger a GitLab pipeline via API.
// Usage: node scripts/trigger-pipeline.js <projectId> [branch]
//   or:  GITLAB_TOKEN=<token> node scripts/trigger-pipeline.js <projectId> [branch]
// Env: GITLAB_TOKEN (required), optional GITLAB_URL (default https://gitlab.com)
// Loads .env from project root if present.

try {
  require('dotenv').config({ path: require('path').resolve(__dirname, '..', '.env') });
} catch (_) {}

const axios = require('axios');

const projectId = process.argv[2];
const branch = process.argv[3] || 'main';
const token = process.env.GITLAB_TOKEN;
const baseUrl = (process.env.GITLAB_URL || 'https://gitlab.com').replace(/\/$/, '');

if (!projectId || !token) {
  console.error('Usage: GITLAB_TOKEN=<token> node scripts/trigger-pipeline.js <projectId> [branch]');
  console.error('Example: GITLAB_TOKEN=glpat-xxx node scripts/trigger-pipeline.js 80120689 main');
  process.exit(1);
}

const url = `${baseUrl}/api/v4/projects/${encodeURIComponent(projectId)}/pipeline`;

axios
  .post(
    url,
    { ref: branch },
    {
      headers: {
        'PRIVATE-TOKEN': token,
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
