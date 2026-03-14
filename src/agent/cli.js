#!/usr/bin/env node
// src/agent/cli.js
// CLI for FlowForge agent: stdout = JSON { gcpPlan, pipelineYaml }.
// Optionally writes gcp-plan.json and .gitlab-ci.yml for Duo/scripts.
// Usage: node src/agent/cli.js <gitlabProjectId> [--write-files]
//   or:  GITLAB_PROJECT_ID=123 node src/agent/cli.js
// Requires .env (or env): GITLAB_TOKEN, optional GCP_PROJECT_ID, ANTHROPIC_API_KEY.
// usageAnswers (passed to runFlow → generateGcpPlan) from env:
//   USERS, TEAM_SIZE, BUDGET, IS_PROD, EXPECTS_SPIKES
// Optional: WRITE_FILES=1 or --write-files to also write gcp-plan.json + .gitlab-ci.yml

try {
  require('dotenv').config();
} catch (_) {
  // dotenv optional when env vars are set by CI/Duo
}

const fs = require('fs');
const path = require('path');
const { runFlow } = require('./runFlow');

async function main() {
  const args = process.argv.slice(2).filter(a => a !== '--write-files');
  const writeFiles = process.env.WRITE_FILES === '1' || process.env.WRITE_FILES === 'true' || process.argv.includes('--write-files');
  const outputDir = process.env.OUTPUT_DIR || process.cwd();

  const projectIdEnv = process.env.GITLAB_PROJECT_ID;
  const projectIdArg = args[0];
  const projectId = Number(projectIdEnv || projectIdArg);

  if (!projectId || Number.isNaN(projectId)) {
    console.error('Usage: node src/agent/cli.js <gitlabProjectId> [--write-files]');
    console.error('   or: GITLAB_PROJECT_ID=<id> node src/agent/cli.js');
    console.error('   Env: WRITE_FILES=1 to write gcp-plan.json and .gitlab-ci.yml');
    process.exit(1);
  }

  // usageAnswers flow: CLI (env) → runFlow → generateGcpPlan → recommendTiers (Claude)
  const usageAnswers = {
    expectedDailyUsers: Number(process.env.USERS || 1000),
    teamSize: Number(process.env.TEAM_SIZE || 5),
    budget: process.env.BUDGET || 'medium',
    isProduction: process.env.IS_PROD === 'true',
    expectsSpikes: process.env.EXPECTS_SPIKES === 'true',
  };

  const onProgress = (msg) => {
    console.error(`[flow] ${msg}`);
  };

  try {
    const { gcpPlan, pipelineYaml } = await runFlow({
      projectId,
      usageAnswers,
      onProgress,
    });

    const out = { gcpPlan, pipelineYaml };
    process.stdout.write(JSON.stringify(out, null, 2) + '\n');

    if (writeFiles) {
      const dir = path.resolve(outputDir);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'gcp-plan.json'), JSON.stringify(gcpPlan, null, 2), 'utf8');
      fs.writeFileSync(path.join(dir, '.gitlab-ci.yml'), pipelineYaml, 'utf8');
      console.error(`[flow] Wrote gcp-plan.json and .gitlab-ci.yml to ${dir}`);
    }
  } catch (err) {
    console.error('[flow] Failed:', err.message || err);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}
