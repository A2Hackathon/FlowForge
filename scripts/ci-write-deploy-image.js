#!/usr/bin/env node
/**
 * CI helper: read gcp-plan.json and write deploy-image.txt (Artifact Registry tag for Kaniko / deploy).
 * Uses REGION-docker.pkg.dev (not legacy gcr.io) so pushes align with Artifact Registry IAM.
 *
 * Env:
 *   GAR_REPOSITORY — Artifact Registry repo name (default: flowforge-ci)
 *   GCP_REGION       — region for the repo (default: deploymentConfig.region or us-central1)
 */
const fs = require('fs');

const j = JSON.parse(fs.readFileSync('gcp-plan.json', 'utf8'));
const projectId = process.env.GCP_PROJECT_ID;
const sha = process.env.CI_COMMIT_SHA;
const serviceName = j.deploymentConfig?.cloudRun?.serviceName || 'app';
const region =
  process.env.GCP_REGION ||
  j.deploymentConfig?.region ||
  j.deploymentConfig?.cloudRun?.region ||
  'us-central1';
const repoName = process.env.GAR_REPOSITORY || 'flowforge-ci';
// One Docker repo in AR holds many images; image name = service name.
const tag = `${region}-docker.pkg.dev/${projectId}/${repoName}/${serviceName}:${sha}`;
fs.writeFileSync('deploy-image.txt', tag);
console.log('Image:', tag);
