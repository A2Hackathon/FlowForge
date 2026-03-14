// src/agent/runFlow.js
// Single entry point: scan → architecture graph → GCP plan → pipeline YAML.
// Used by the CLI (and optionally by GitLab Duo / CI).

const { scanRepository } = require('../scanner/repoScanner');
const { generateArchitectureGraph } = require('../architect/architectureMapper');
const { generateGcpPlan } = require('../cloud/gcpPlanner');
const { generatePipelineYaml } = require('./pipelineGenerator');

/**
 * runFlow
 *
 * Orchestrates: repository scan → architecture graph → GCP plan → suggested .gitlab-ci.yml.
 *
 * @param {Object} opts
 * @param {number}   opts.projectId     - GitLab project ID
 * @param {Object}   opts.usageAnswers  - Optional: { expectedDailyUsers, teamSize, budget, isProduction, expectsSpikes }
 * @param {Function} opts.onProgress    - Optional: (message: string) => void
 *
 * @returns {Promise<{ scanResult: Object, graphResult: Object, gcpPlan: Object, pipelineYaml: string }>}
 */
async function runFlow({ projectId, usageAnswers = {}, onProgress = () => {} }) {
  if (!projectId) {
    throw new Error('projectId is required');
  }

  // 1) Scan repository
  onProgress(`Starting repository scan for project ${projectId}...`);
  const scanResult = await scanRepository(projectId, onProgress);

  // 2) Payload for architecture graph (monorepo: first service; else full scan)
  const payload =
    scanResult.isMonorepo &&
    Array.isArray(scanResult.services) &&
    scanResult.services.length > 0
      ? scanResult.services[0]
      : scanResult;

  onProgress('Generating architecture graph...');
  const graphResult = generateArchitectureGraph(payload);

  // 3) File contents for Claude: scanner does not expose them, so pass empty Map.
  // GCP plan still runs with defaults; AI file analysis is skipped until we add collection.
  const fileContents = new Map();

  // 4) Generate GCP plan (usageAnswers: USERS, TEAM_SIZE, BUDGET, IS_PROD, EXPECTS_SPIKES from env)
  onProgress('Generating GCP infrastructure plan...');
  const gcpPlan = await generateGcpPlan(
    scanResult,
    graphResult,
    fileContents,
    usageAnswers,
    onProgress
  );

  // 5) Generate suggested .gitlab-ci.yml (build → test → deploy)
  onProgress('Generating suggested GitLab pipeline...');
  const pipelineYaml = generatePipelineYaml(scanResult, gcpPlan);

  onProgress('Flow completed successfully.');
  return { scanResult, graphResult, gcpPlan, pipelineYaml };
}

module.exports = { runFlow };
