#!/usr/bin/env node
// src/agent/cli.js
// CLI for FlowForge agent: outputs GCP plan JSON to stdout.
// Usage: node src/agent/cli.js <gitlabProjectId>
//   or:  GITLAB_PROJECT_ID=123 node src/agent/cli.js
// Requires .env (or env): GITLAB_TOKEN, optional GCP_PROJECT_ID, ANTHROPIC_API_KEY.
// usageAnswers (passed to runFlow → generateGcpPlan) from env:
//   USERS, TEAM_SIZE, BUDGET, IS_PROD, EXPECTS_SPIKES

try {
  require('dotenv').config();
} catch (_) {
  // dotenv optional when env vars are set by CI/Duo
}

const { runFlow } = require('./runFlow');

async function main() {
  const projectIdEnv = process.env.GITLAB_PROJECT_ID;
  const projectIdArg = process.argv[2];
  const projectId = Number(projectIdEnv || projectIdArg);

  if (!projectId || Number.isNaN(projectId)) {
    console.error('Usage: node src/agent/cli.js <gitlabProjectId>');
    console.error('   or: GITLAB_PROJECT_ID=<id> node src/agent/cli.js');
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
    const { gcpPlan } = await runFlow({
      projectId,
      usageAnswers,
      onProgress,
    });
    process.stdout.write(JSON.stringify(gcpPlan, null, 2) + '\n');
  } catch (err) {
    console.error('[flow] Failed:', err.message || err);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}
