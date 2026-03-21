#!/usr/bin/env node
/**
 * CI helper: read gcp-plan.json and write deploy-image.txt (GCR tag for Kaniko / deploy).
 * Keeps .gitlab-ci.yml free of YAML/colon pitfalls in inline node -e strings.
 */
const fs = require('fs');

const j = JSON.parse(fs.readFileSync('gcp-plan.json', 'utf8'));
const projectId = process.env.GCP_PROJECT_ID;
const sha = process.env.CI_COMMIT_SHA;
const serviceName = j.deploymentConfig?.cloudRun?.serviceName || 'app';
const tag = `gcr.io/${projectId}/${serviceName}:${sha}`;
fs.writeFileSync('deploy-image.txt', tag);
console.log('Image:', tag);
