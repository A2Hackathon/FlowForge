// src/cloud/gcpPricingClient.js
// ─────────────────────────────────────────────────────────────
// Fetches real, live pricing from the GCP Cloud Billing Catalog API
// and validates that the target GCP project exists before deploying.
//
// Reads from process.env (set in .env file):
//   GCP_API_KEY    — a GCP API key with Cloud Billing API and
//                    Service Usage API enabled
//   GCP_PROJECT_ID — the GCP project to deploy into
//
// Fails fast with a clear error if either is missing.
// ─────────────────────────────────────────────────────────────

const axios = require('axios');

const BILLING_API_BASE = 'https://cloudbilling.googleapis.com/v1';

// ── GCP Service IDs ───────────────────────────────────────────
// Each GCP product has a stable unique ID in the Billing Catalog API.
const GCP_SERVICE_IDS = {
  'Cloud Run':              '152E-C115-5142',
  'Cloud SQL':              '9662-B51E-5089',
  'Memorystore (Redis)':    'E8FB-63C4-C6E8',
  'Cloud Storage':          '95FF-2EF5-5EA1',
  'Cloud Tasks':            'A9EF-8DDB-82D3',
  'Pub/Sub':                'A1E8-BE35-7EBC',
  'Cloud Load Balancing':   '7B14-3A62-76F7',
  'Artifact Registry':      'EFF6-47E3-73E1',
};

// ── Usage assumptions for monthly estimate calculations ────────
// We must make assumptions about usage volume because the Billing API
// gives unit prices, not monthly totals. These are clearly documented
// and shown in the UI so users understand the basis.
const MONTHLY_ASSUMPTIONS = {
  'Cloud Run': {
    note: '1 instance 24/7, 2 vCPU, 1 GB RAM, 1M requests/month',
    vcpuSeconds:     2 * 60 * 60 * 24 * 30,
    memoryGbSeconds: 1 * 60 * 60 * 24 * 30,
    requests:        1_000_000,
  },
  'Cloud SQL': {
    note: 'db-g1-small, 50 GB SSD, running 24/7',
    hours:     24 * 30,
    storageGb: 50,
  },
  'Memorystore (Redis)': {
    note: '1 GB Basic tier, running 24/7',
    gbHours: 1 * 24 * 30,
  },
  'Cloud Storage': {
    note: '10 GB stored, 100 GB egress/month',
    storageGb: 10,
    egressGb:  100,
  },
};

// ── GCP APIs that CloudMapper needs enabled ────────────────────
const REQUIRED_APIS = [
  'run.googleapis.com',
  'sqladmin.googleapis.com',
  'redis.googleapis.com',
  'storage.googleapis.com',
  'artifactregistry.googleapis.com',
  'cloudbuild.googleapis.com',
  'secretmanager.googleapis.com',
];

// ════════════════════════════════════════════════════════════
// ENV HELPERS
// ════════════════════════════════════════════════════════════

function getApiKey() {
  const key = process.env.GCP_API_KEY;
  if (!key) {
    throw new Error(
      'GCP_API_KEY is not set. Add it to your .env file:\n' +
      '  GCP_API_KEY=AIzaSy...'
    );
  }
  return key;
}

function getProjectId() {
  const id = process.env.GCP_PROJECT_ID;
  if (!id) {
    throw new Error(
      'GCP_PROJECT_ID is not set. Add it to your .env file:\n' +
      '  GCP_PROJECT_ID=my-project-123456'
    );
  }
  return id;
}

// ════════════════════════════════════════════════════════════
// BILLING API HELPERS
// ════════════════════════════════════════════════════════════

/**
 * fetchSkusForService
 * Fetches all SKUs for one GCP service, paginating until complete.
 */
async function fetchSkusForService(serviceId) {
  const apiKey  = getApiKey();
  let allSkus   = [];
  let pageToken = null;

  do {
    const params = { key: apiKey, pageSize: 500 };
    if (pageToken) params.pageToken = pageToken;

    const response = await axios.get(
      `${BILLING_API_BASE}/services/${serviceId}/skus`,
      { params, timeout: 15000 }
    );

    allSkus   = allSkus.concat(response.data.skus || []);
    pageToken = response.data.nextPageToken || null;
  } while (pageToken);

  return allSkus;
}

/**
 * extractUnitPrice
 * Pulls the USD unit price from a SKU's tieredRates pricing data.
 * GCP stores prices in nanos (billionths of a dollar) + whole units.
 */
function extractUnitPrice(sku) {
  try {
    const tieredRates = sku?.pricingInfo?.[0]?.pricingExpression?.tieredRates;
    if (!tieredRates?.length) return 0;

    // Skip the free tier (price = 0) and use the first paid tier
    const paidTier = tieredRates.find(r => {
      const nanos = parseInt(r.unitPrice?.nanos || 0, 10);
      const units = parseInt(r.unitPrice?.units || 0, 10);
      return units > 0 || nanos > 0;
    }) || tieredRates[tieredRates.length - 1];

    const units = parseInt(paidTier.unitPrice?.units || 0, 10);
    const nanos = parseInt(paidTier.unitPrice?.nanos || 0, 10);
    return units + nanos / 1e9;
  } catch {
    return 0;
  }
}

// ════════════════════════════════════════════════════════════
// PER-SERVICE PRICE CALCULATORS
// ════════════════════════════════════════════════════════════

async function getCloudRunPricing() {
  const skus      = await fetchSkusForService(GCP_SERVICE_IDS['Cloud Run']);
  const cpuSku    = skus.find(s => s.description?.includes('CPU Allocation Time'));
  const memSku    = skus.find(s => s.description?.includes('Memory Allocation Time'));
  const reqSku    = skus.find(s => s.description?.includes('Requests'));
  const a         = MONTHLY_ASSUMPTIONS['Cloud Run'];

  const cost = Math.round(
    (extractUnitPrice(cpuSku) * a.vcpuSeconds) +
    (extractUnitPrice(memSku) * a.memoryGbSeconds) +
    (extractUnitPrice(reqSku) * (a.requests / 1_000_000))
  );

  return { product: 'Cloud Run', monthlyCostUsd: cost, assumptions: a.note, fetchedAt: new Date().toISOString() };
}

async function getCloudSqlPricing(dbType = 'PostgreSQL') {
  const skus        = await fetchSkusForService(GCP_SERVICE_IDS['Cloud SQL']);
  const dbSkus      = skus.filter(s => s.description?.toLowerCase().includes(dbType.toLowerCase()));
  const instanceSku = dbSkus.find(s => s.description?.includes('g1-small'));
  const storageSku  = dbSkus.find(s => s.description?.includes('SSD'));
  const a           = MONTHLY_ASSUMPTIONS['Cloud SQL'];

  const cost = Math.round(
    (extractUnitPrice(instanceSku) * a.hours) +
    (extractUnitPrice(storageSku)  * a.storageGb)
  );

  return { product: `Cloud SQL (${dbType})`, monthlyCostUsd: cost, assumptions: a.note, fetchedAt: new Date().toISOString() };
}

async function getMemorystorePricing() {
  const skus    = await fetchSkusForService(GCP_SERVICE_IDS['Memorystore (Redis)']);
  const basicSku = skus.find(s => s.description?.includes('Basic') && s.description?.includes('GB'));
  const a       = MONTHLY_ASSUMPTIONS['Memorystore (Redis)'];
  const cost    = Math.round(extractUnitPrice(basicSku) * a.gbHours);

  return { product: 'Memorystore (Redis)', monthlyCostUsd: cost, assumptions: a.note, fetchedAt: new Date().toISOString() };
}

async function getCloudStoragePricing() {
  const skus       = await fetchSkusForService(GCP_SERVICE_IDS['Cloud Storage']);
  const storageSku = skus.find(s => s.description?.includes('Standard Storage') && s.description?.includes('us-central'));
  const egressSku  = skus.find(s => s.description?.includes('Download') && s.description?.includes('Americas'));
  const a          = MONTHLY_ASSUMPTIONS['Cloud Storage'];

  const cost = Math.round(
    (extractUnitPrice(storageSku) * a.storageGb) +
    (extractUnitPrice(egressSku)  * a.egressGb)
  );

  return { product: 'Cloud Storage + CDN', monthlyCostUsd: cost, assumptions: a.note, fetchedAt: new Date().toISOString() };
}

// ════════════════════════════════════════════════════════════
// MAIN EXPORTED FUNCTIONS
// ════════════════════════════════════════════════════════════

/**
 * fetchLivePricing
 * Fetches real pricing for all required GCP products in parallel.
 * Individual failures are caught — the rest of the pricing still works.
 *
 * @param {string[]} requiredProducts - Product names from the architecture graph
 * @param {Function} onProgress
 * @returns {Object} { [productName]: { monthlyCostUsd, assumptions, fetchedAt } }
 */
async function fetchLivePricing(requiredProducts, onProgress = () => {}) {
  onProgress('Fetching live GCP pricing...');

  const FETCHERS = {
    'Cloud Run':              getCloudRunPricing,
    'Cloud SQL (PostgreSQL)': () => getCloudSqlPricing('PostgreSQL'),
    'Cloud SQL (MySQL)':      () => getCloudSqlPricing('MySQL'),
    'Memorystore (Redis)':    getMemorystorePricing,
    'Cloud Storage + CDN':    getCloudStoragePricing,
  };

  const results = {};

  await Promise.allSettled(
    requiredProducts
      .filter(name => FETCHERS[name])
      .map(async name => {
        try {
          results[name] = await FETCHERS[name]();
          onProgress(`✓ Got live pricing for ${name}`);
        } catch (err) {
          console.warn(`[GcpPricingClient] Could not fetch pricing for ${name}:`, err.message);
          results[name] = { error: err.message, monthlyCostUsd: null };
        }
      })
  );

  onProgress(`Live pricing fetched for ${Object.values(results).filter(r => r.monthlyCostUsd != null).length} of ${requiredProducts.length} services.`);
  return results;
}

/**
 * validateGcpProject
 * Checks the project exists and lists any required APIs that aren't enabled.
 * Prevents Day 6 from failing due to missing APIs.
 *
 * @param {Function} onProgress
 * @returns {Object} { projectExists, projectId, enabledApis, missingApis, warnings }
 */
async function validateGcpProject(onProgress = () => {}) {
  const apiKey    = getApiKey();
  const projectId = getProjectId();

  onProgress(`Validating GCP project '${projectId}'...`);

  try {
    const response = await axios.get(
      `https://serviceusage.googleapis.com/v1/projects/${projectId}/services`,
      {
        params: { key: apiKey, filter: 'state:ENABLED' },
        timeout: 15000,
      }
    );

    const enabledApis = (response.data.services || [])
      .map(s => s.name?.split('/').pop())
      .filter(Boolean);

    const enabledSet  = new Set(enabledApis);
    const missingApis = REQUIRED_APIS.filter(api => !enabledSet.has(api));

    return {
      projectExists: true,
      projectId,
      enabledApis,
      missingApis,
      warnings: missingApis.length > 0
        ? [`${missingApis.length} required APIs not enabled: ${missingApis.join(', ')}`]
        : [],
    };
  } catch (err) {
    if (err.response?.status === 403 || err.response?.status === 404) {
      return {
        projectExists: false,
        projectId,
        enabledApis:  [],
        missingApis:  REQUIRED_APIS,
        warnings:     [`Project '${projectId}' not found or API key lacks permission.`],
      };
    }
    throw err;
  }
}

module.exports = { fetchLivePricing, validateGcpProject };