// src/cloud/gcpPlanner.js
// ─────────────────────────────────────────────────────────────
// Day 5 orchestrator.
//
// Coordinates three things to produce a full GCP infrastructure plan:
//
//   1. claudeanalyser.js  — AI-powered security & architecture analysis
//                           reads actual file contents, not just file presence
//
//   2. gcpPricingClient.js — fetches real live prices from the GCP
//                            Billing Catalog API (not hardcoded estimates)
//
//   3. claudeanalyser.recommendTiers() — AI-powered tier recommendation
//                                        based on detected stack + user answers
//
// Each step has a hardcoded fallback — if the API call fails, the plan
// still generates with sensible defaults so the app never fully breaks.
//
// The GCP_PRODUCTS catalogue at the bottom of this file is still used:
//   - As the source of truth for available tiers
//   - As the fallback when Claude's tier recommendation fails
//   - As the fallback when live pricing cannot be fetched
// ─────────────────────────────────────────────────────────────

const { analyseRepository, recommendTiers } = require('./claudeanalyser');
const { fetchLivePricing, validateGcpProject } = require('./gcpPricingClient');

// ════════════════════════════════════════════════════════════
// GCP PRODUCT CATALOGUE
// Source of truth for what tiers exist and their fallback prices.
// Live prices from gcpPricingClient.js will override these if available.
// ════════════════════════════════════════════════════════════

const GCP_PRODUCTS = {

  'Cloud Run': {
    description: 'Fully managed serverless containers. Scales to zero when idle.',
    docsUrl:     'https://cloud.google.com/run/docs',
    category:    'compute',
    tiers: [
      {
        id: 'starter', name: 'Starter',
        specs: '1 vCPU · 512 MB RAM · max 10 concurrent requests',
        fallbackMonthlyCost: 5,
        useCase: 'Development or very low traffic (< 1k req/day)',
        config: { cpu: '1', memory: '512Mi', minInstances: 0, maxInstances: 5, concurrency: 10 },
      },
      {
        id: 'standard', name: 'Standard',
        specs: '2 vCPU · 1 GB RAM · max 80 concurrent requests',
        fallbackMonthlyCost: 40,
        useCase: 'Production, moderate traffic (< 50k req/day)',
        config: { cpu: '2', memory: '1Gi', minInstances: 1, maxInstances: 20, concurrency: 80 },
        recommended: true,
      },
      {
        id: 'performance', name: 'Performance',
        specs: '4 vCPU · 2 GB RAM · max 200 concurrent requests',
        fallbackMonthlyCost: 130,
        useCase: 'High-traffic production (> 50k req/day)',
        config: { cpu: '4', memory: '2Gi', minInstances: 2, maxInstances: 100, concurrency: 200 },
      },
    ],
  },

  'Cloud Storage + CDN': {
    description: 'Static file hosting for frontend apps with global CDN caching.',
    docsUrl:     'https://cloud.google.com/storage/docs/hosting-static-website',
    category:    'storage',
    tiers: [
      {
        id: 'standard', name: 'Standard',
        specs: 'Cloud Storage + Cloud CDN · pay-per-GB',
        fallbackMonthlyCost: 5,
        useCase: 'All static frontend apps',
        config: { storageClass: 'STANDARD', cdnEnabled: true, region: 'us-central1' },
        recommended: true,
      },
    ],
  },

  'Cloud SQL (PostgreSQL)': {
    description: 'Fully managed PostgreSQL with automatic backups and optional HA.',
    docsUrl:     'https://cloud.google.com/sql/docs/postgres',
    category:    'database',
    tiers: [
      {
        id: 'sandbox', name: 'Sandbox',
        specs: 'db-f1-micro · 1 vCPU · 614 MB RAM · 10 GB SSD',
        fallbackMonthlyCost: 10,
        useCase: 'Development only',
        config: { tier: 'db-f1-micro', diskSizeGb: 10, backupsEnabled: false, highAvailability: false },
      },
      {
        id: 'standard', name: 'Standard',
        specs: 'db-g1-small · 1 vCPU · 1.7 GB RAM · 50 GB SSD · daily backups',
        fallbackMonthlyCost: 55,
        useCase: 'Small-to-medium production workloads',
        config: { tier: 'db-g1-small', diskSizeGb: 50, backupsEnabled: true, highAvailability: false },
        recommended: true,
      },
      {
        id: 'production', name: 'Production HA',
        specs: 'db-n1-standard-2 · 2 vCPU · 7.5 GB RAM · 100 GB SSD · HA failover',
        fallbackMonthlyCost: 200,
        useCase: 'High-availability production',
        config: { tier: 'db-n1-standard-2', diskSizeGb: 100, backupsEnabled: true, highAvailability: true },
      },
    ],
  },

  'Cloud SQL (MySQL)': {
    description: 'Fully managed MySQL with automatic backups.',
    docsUrl:     'https://cloud.google.com/sql/docs/mysql',
    category:    'database',
    tiers: [
      {
        id: 'sandbox', name: 'Sandbox',
        specs: 'db-f1-micro · 1 vCPU · 614 MB RAM · 10 GB SSD',
        fallbackMonthlyCost: 10,
        useCase: 'Development only',
        config: { tier: 'db-f1-micro', diskSizeGb: 10, backupsEnabled: false, highAvailability: false },
      },
      {
        id: 'standard', name: 'Standard',
        specs: 'db-g1-small · 1 vCPU · 1.7 GB RAM · 50 GB SSD',
        fallbackMonthlyCost: 50,
        useCase: 'Small-to-medium production',
        config: { tier: 'db-g1-small', diskSizeGb: 50, backupsEnabled: true, highAvailability: false },
        recommended: true,
      },
    ],
  },

  'MongoDB Atlas on GCP': {
    description: 'MongoDB managed service hosted on GCP. Configured via MongoDB Atlas.',
    docsUrl:     'https://www.mongodb.com/atlas/google-cloud',
    category:    'database',
    tiers: [
      {
        id: 'm0', name: 'Free Tier (M0)',
        specs: 'Shared · 512 MB storage · no SLA',
        fallbackMonthlyCost: 0,
        useCase: 'Development and prototyping only',
        config: { clusterTier: 'M0', region: 'us-central1' },
      },
      {
        id: 'm10', name: 'Dedicated (M10)',
        specs: '2 vCPU · 2 GB RAM · 10 GB storage',
        fallbackMonthlyCost: 60,
        useCase: 'Production workloads',
        config: { clusterTier: 'M10', region: 'us-central1' },
        recommended: true,
      },
    ],
  },

  'Memorystore (Redis)': {
    description: 'Fully managed Redis for session caching and rate limiting.',
    docsUrl:     'https://cloud.google.com/memorystore/docs/redis',
    category:    'cache',
    tiers: [
      {
        id: 'basic_1gb', name: 'Basic 1 GB',
        specs: '1 GB RAM · Basic tier',
        fallbackMonthlyCost: 35,
        useCase: 'Non-critical caching, development',
        config: { memorySizeGb: 1, tier: 'BASIC', redisVersion: 'REDIS_7_0' },
      },
      {
        id: 'standard_4gb', name: 'Standard 4 GB',
        specs: '4 GB RAM · Standard tier (HA replica)',
        fallbackMonthlyCost: 130,
        useCase: 'Production caching with high availability',
        config: { memorySizeGb: 4, tier: 'STANDARD_HA', redisVersion: 'REDIS_7_0' },
        recommended: true,
      },
    ],
  },

  'Cloud Tasks': {
    description: 'Managed async task queue. Replaces Celery workers.',
    docsUrl:     'https://cloud.google.com/tasks/docs',
    category:    'queue',
    tiers: [
      {
        id: 'standard', name: 'Standard',
        specs: 'Pay-per-task · first 1M tasks/month free',
        fallbackMonthlyCost: 5,
        useCase: 'All async task workloads',
        config: { maxConcurrentDispatches: 100, maxAttempts: 5, retryConfig: true },
        recommended: true,
      },
    ],
  },

  'Pub/Sub': {
    description: 'Managed message broker. Replaces RabbitMQ.',
    docsUrl:     'https://cloud.google.com/pubsub/docs',
    category:    'queue',
    tiers: [
      {
        id: 'standard', name: 'Standard',
        specs: 'Pay-per-message · first 10 GB/month free',
        fallbackMonthlyCost: 10,
        useCase: 'Event-driven messaging',
        config: { messageRetentionDuration: '7d', ackDeadlineSeconds: 30 },
        recommended: true,
      },
    ],
  },

  'Cloud Load Balancing': {
    description: 'Global HTTPS load balancer with SSL termination. Replaces Nginx.',
    docsUrl:     'https://cloud.google.com/load-balancing/docs',
    category:    'networking',
    tiers: [
      {
        id: 'global_https', name: 'Global HTTPS',
        specs: 'Global anycast · SSL termination · pay-per-rule',
        fallbackMonthlyCost: 20,
        useCase: 'All public-facing production apps',
        config: { type: 'EXTERNAL', protocol: 'HTTPS', sslEnabled: true },
        recommended: true,
      },
    ],
  },

  'Cloud Endpoints': {
    description: 'API gateway for managing and monitoring REST/GraphQL APIs.',
    docsUrl:     'https://cloud.google.com/endpoints/docs',
    category:    'api',
    tiers: [
      {
        id: 'standard', name: 'Standard',
        specs: 'Pay-per-call · first 2M calls/month free',
        fallbackMonthlyCost: 10,
        useCase: 'API management and monitoring',
        config: { authEnabled: true, monitoringEnabled: true },
        recommended: true,
      },
    ],
  },

  'Artifact Registry': {
    description: 'Stores Docker images before Cloud Run deploys them.',
    docsUrl:     'https://cloud.google.com/artifact-registry/docs',
    category:    'devops',
    tiers: [
      {
        id: 'standard', name: 'Standard',
        specs: 'Pay-per-GB · first 0.5 GB/month free',
        fallbackMonthlyCost: 2,
        useCase: 'All containerised apps',
        config: { format: 'DOCKER', location: 'us-central1' },
        recommended: true,
      },
    ],
  },

};

// ════════════════════════════════════════════════════════════
// MAIN EXPORTED FUNCTION
// ════════════════════════════════════════════════════════════

/**
 * generateGcpPlan
 *
 * Orchestrates the full Day 5 flow:
 *   1. Validates the GCP project
 *   2. Fetches live pricing from GCP Billing API
 *   3. Gets AI-powered security + architecture analysis from Claude
 *   4. Gets AI-powered tier recommendations from Claude
 *   5. Assembles the final plan
 *
 * @param {Object}   scanResult    - From repoScanner.scanRepository()
 * @param {Object}   graphResult   - From architectureMapper.generateArchitectureGraph()
 * @param {Map}      fileContents  - filename → content (from repoScanner, passed through IPC)
 * @param {Object}   usageAnswers  - User's answers: { expectedDailyUsers, teamSize,
 *                                   budget, isProduction, expectsSpikes }
 * @param {Function} onProgress    - Progress callback pushed to the frontend
 *
 * @returns {Object} gcpPlan — full infrastructure plan
 */
async function generateGcpPlan(scanResult, graphResult, fileContents, usageAnswers, onProgress = () => {}) {
  const { metadata } = graphResult;
  const projectId    = process.env.GCP_PROJECT_ID || null;

  // ── Step 1: Validate GCP project ──────────────────────────
  let projectValidation = null;
  if (projectId) {
    try {
      onProgress('Validating GCP project...');
      projectValidation = await validateGcpProject(onProgress);
      if (!projectValidation.projectExists) {
        onProgress(`⚠️  GCP project '${projectId}' not found — check your Project ID in Settings`);
      } else if (projectValidation.missingApis.length > 0) {
        onProgress(`⚠️  ${projectValidation.missingApis.length} GCP APIs need enabling`);
      } else {
        onProgress('✓ GCP project validated');
      }
    } catch (err) {
      console.warn('[GcpPlanner] Project validation failed:', err.message);
      onProgress('GCP project validation skipped — proceeding with plan');
    }
  }

  // ── Step 2: Fetch live pricing ─────────────────────────────
  let livePricing = {};
  try {
    livePricing = await fetchLivePricing(metadata.requiredGcpProducts, onProgress);
  } catch (err) {
    console.warn('[GcpPlanner] Live pricing fetch failed — using fallback estimates:', err.message);
    onProgress('Using estimated pricing (live GCP pricing unavailable)');
  }

  // ── Step 3: AI security & architecture analysis ───────────
  let analysis = null;
  if (fileContents && fileContents instanceof Map && fileContents.size > 0) {
    try {
      analysis = await analyseRepository(scanResult, fileContents, onProgress);
    } catch (err) {
      console.warn('[GcpPlanner] Claude analysis failed:', err.message);
      onProgress('AI analysis unavailable — check your Anthropic API key in Settings');
    }
  }

  // ── Step 4: AI tier recommendations ───────────────────────
  let tierRecommendations = null;
  if (usageAnswers && Object.keys(usageAnswers).length > 0) {
    try {
      tierRecommendations = await recommendTiers(
        scanResult, metadata, GCP_PRODUCTS, usageAnswers, onProgress
      );
    } catch (err) {
      console.warn('[GcpPlanner] Tier recommendation failed:', err.message);
      onProgress('Using default tier recommendations');
    }
  }

  // ── Step 5: Build planned services ────────────────────────
  const plannedServices = buildPlannedServices(
    metadata.requiredGcpProducts,
    livePricing,
    tierRecommendations
  );

  // ── Step 6: Assemble the full plan ────────────────────────
  const totalMonthlyCost = plannedServices.reduce(
    (sum, s) => sum + (s.estimatedMonthlyCost || 0), 0
  );

  return {
    region:     'us-central1',
    projectId:  projectId || null,
    projectValidation,

    plannedServices,

    // AI analysis findings (replaces hardcoded rules)
    analysis: analysis || { findings: [], summary: { overallRisk: 'unknown', totalFindings: 0 } },

    // Tier recommendation context (from Claude)
    tierAdvice: tierRecommendations?.overallAdvice || null,

    costEstimate: {
      totalMonthlyCost,
      totalAnnualCost: totalMonthlyCost * 12,
      usingLivePricing: Object.keys(livePricing).length > 0,
      disclaimer: Object.keys(livePricing).length > 0
        ? 'Prices fetched live from GCP Billing API (us-central1). Based on usage assumptions — actual cost depends on real traffic.'
        : 'Estimated prices based on GCP us-central1 pricing. Live pricing unavailable. Actual costs will vary.',
    },

    deploymentConfig: buildDeploymentConfig(plannedServices, scanResult, metadata),

    summary: {
      totalServices:          plannedServices.length,
      criticalFindings:       analysis?.summary?.byCategoryAndSeverity?.security?.critical || 0,
      highFindings:           (analysis?.summary?.byCategoryAndSeverity?.security?.high || 0) +
                              (analysis?.summary?.byCategoryAndSeverity?.architecture?.high || 0),
      totalFindings:          analysis?.summary?.totalFindings || 0,
      overallRisk:            analysis?.summary?.overallRisk || 'unknown',
      topPriority:            analysis?.summary?.topPriority || null,
      missingApis:            projectValidation?.missingApis || [],
    },
  };
}

// ════════════════════════════════════════════════════════════
// HELPERS
// ════════════════════════════════════════════════════════════

/**
 * buildPlannedServices
 * Assembles the list of planned GCP services, applying:
 *   1. Claude's tier recommendation (if available)
 *   2. Live prices (if available)
 *   3. Fallback to hardcoded defaults
 */
function buildPlannedServices(requiredProducts, livePricing, tierRecommendations) {
  const planned = requiredProducts
    .filter(name => GCP_PRODUCTS[name])
    .map(name => {
      const product = GCP_PRODUCTS[name];

      // Determine selected tier — Claude recommendation → hardcoded default
      let selectedTierId = tierRecommendations?.recommendations?.[name]?.tierId
        || product.tiers.find(t => t.recommended)?.id
        || product.tiers[0].id;

      const tier = product.tiers.find(t => t.id === selectedTierId) || product.tiers[0];

      // Determine price — live API → fallback estimate
      const livePrice = livePricing[name]?.monthlyCostUsd;
      const estimatedMonthlyCost = (livePrice != null && livePrice > 0)
        ? livePrice
        : tier.fallbackMonthlyCost;

      return {
        productName:          name,
        description:          product.description,
        docsUrl:              product.docsUrl,
        category:             product.category,
        selectedTierId:       tier.id,
        tiers:                product.tiers,
        activeConfig:         { ...tier.config },
        estimatedMonthlyCost,
        priceSource:          (livePrice != null && livePrice > 0) ? 'live' : 'estimate',
        // From Claude's recommendation
        tierReasoning:        tierRecommendations?.recommendations?.[name]?.reasoning || null,
        tierWarning:          tierRecommendations?.recommendations?.[name]?.warningIfWrong || null,
        // From live pricing
        pricingAssumptions:   livePricing[name]?.assumptions || null,
      };
    });

  // Auto-add Artifact Registry if Cloud Run is present
  const hasCloudRun      = planned.some(s => s.productName === 'Cloud Run');
  const hasRegistry      = planned.some(s => s.productName === 'Artifact Registry');
  if (hasCloudRun && !hasRegistry && GCP_PRODUCTS['Artifact Registry']) {
    const p    = GCP_PRODUCTS['Artifact Registry'];
    const tier = p.tiers[0];
    planned.push({
      productName:          'Artifact Registry',
      description:          p.description,
      docsUrl:              p.docsUrl,
      category:             p.category,
      selectedTierId:       tier.id,
      tiers:                p.tiers,
      activeConfig:         { ...tier.config },
      estimatedMonthlyCost: tier.fallbackMonthlyCost,
      priceSource:          'estimate',
      tierReasoning:        'Required for all Cloud Run deployments to store Docker images.',
      tierWarning:          null,
      pricingAssumptions:   null,
    });
  }

  return planned;
}

/**
 * buildDeploymentConfig
 * Structured config consumed by Day 6's pipeline generator.
 */
function buildDeploymentConfig(plannedServices, scanResult, metadata) {
  const config = {
    region:    'us-central1',
    projectId: '${GCP_PROJECT_ID}',
  };

  const cloudRun = plannedServices.find(s => s.productName === 'Cloud Run');
  if (cloudRun) {
    const name = deriveServiceName(scanResult);
    const reg = config.region || 'us-central1';
    config.cloudRun = {
      serviceName: name,
      image:       `${reg}-docker.pkg.dev/\${GCP_PROJECT_ID}/flowforge-ci/${name}:\${CI_COMMIT_SHA}`,
      region:      reg,
      ...cloudRun.activeConfig,
      envVars: buildEnvVarList(metadata),
    };
  }

  const cloudSql = plannedServices.find(s =>
    s.productName.startsWith('Cloud SQL')
  );
  if (cloudSql) {
    config.cloudSQL = {
      instanceName: `${deriveServiceName(scanResult)}-db`,
      ...cloudSql.activeConfig,
    };
  }

  const memorystore = plannedServices.find(s => s.productName === 'Memorystore (Redis)');
  if (memorystore) {
    config.memorystore = {
      instanceName: `${deriveServiceName(scanResult)}-cache`,
      ...memorystore.activeConfig,
    };
  }

  config.artifactRegistry = {
    repository: deriveServiceName(scanResult),
    location:   'us-central1',
    format:     'DOCKER',
  };

  return config;
}

function buildEnvVarList(metadata) {
  const vars = [
    { name: 'NODE_ENV', value: 'production' },
    { name: 'PORT',     value: '8080' },
  ];
  if (metadata.hasDatabase) {
    vars.push(
      { name: 'DB_HOST',     value: '${DB_HOST}',     secret: true },
      { name: 'DB_PORT',     value: '${DB_PORT}',     secret: true },
      { name: 'DB_NAME',     value: '${DB_NAME}',     secret: true },
      { name: 'DB_USER',     value: '${DB_USER}',     secret: true },
      { name: 'DB_PASSWORD', value: '${DB_PASSWORD}', secret: true },
    );
  }
  if (metadata.hasCache) {
    vars.push(
      { name: 'REDIS_HOST', value: '${REDIS_HOST}', secret: true },
      { name: 'REDIS_PORT', value: '6379' },
    );
  }
  return vars;
}

function deriveServiceName(scanResult) {
  const raw = scanResult.repoName || `service-${scanResult.projectId}`;
  return raw.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

/**
 * updateServiceTier
 * Called when the user changes a tier in the Infrastructure Dashboard.
 */
function updateServiceTier(gcpPlan, productName, tierId) {
  const service = gcpPlan.plannedServices.find(s => s.productName === productName);
  if (!service) return gcpPlan;

  const newTier = service.tiers.find(t => t.id === tierId);
  if (!newTier) return gcpPlan;

  service.selectedTierId       = tierId;
  service.activeConfig         = { ...newTier.config };
  service.estimatedMonthlyCost = newTier.fallbackMonthlyCost;
  service.priceSource          = 'estimate';

  const totalMonthlyCost = gcpPlan.plannedServices.reduce(
    (sum, s) => sum + (s.estimatedMonthlyCost || 0), 0
  );

  return {
    ...gcpPlan,
    plannedServices: [...gcpPlan.plannedServices],
    costEstimate: {
      ...gcpPlan.costEstimate,
      totalMonthlyCost,
      totalAnnualCost: totalMonthlyCost * 12,
    },
  };
}

module.exports = { generateGcpPlan, updateServiceTier, GCP_PRODUCTS };