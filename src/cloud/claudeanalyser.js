// src/cloud/claudeanalyser.js
// ─────────────────────────────────────────────────────────────
// Uses the Claude API for two things hardcoded rules cannot do:
//
//   1. analyseRepository — reads actual file contents and finds
//      real security/architecture issues (hardcoded secrets,
//      Dockerfile running as root, missing rate limiting, etc.)
//
//   2. recommendTiers — reasons about the detected stack and the
//      user's traffic/budget answers to pick the right GCP tier
//      for each service.
//
// Reads ANTHROPIC_API_KEY from process.env (set in .env file).
// Fails fast with a clear error if the key is missing.
// ─────────────────────────────────────────────────────────────

const axios = require('axios');

const CLAUDE_API_URL = 'https://api.anthropic.com/v1/messages';
const CLAUDE_MODEL   = 'claude-opus-4-5';

// Per-file character limit when sending contents to Claude.
// Keeps token usage and cost predictable (~$0.10–0.20 per full analysis).
const MAX_FILE_CONTENT_CHARS = 3000;
const MAX_FILES_TO_SEND      = 8;

// Security-sensitive files sent first so Claude sees them regardless of
// how many files the repo has
const PRIORITY_FILES = [
  'Dockerfile', '.env.example', '.gitignore', 'nginx.conf',
  'package.json', 'requirements.txt', 'docker-compose.yml', 'go.mod',
];

// ════════════════════════════════════════════════════════════
// CORE HELPERS
// ════════════════════════════════════════════════════════════

/**
 * getApiKey
 * Reads ANTHROPIC_API_KEY from the environment.
 * Throws a clear error if it's missing so the developer knows
 * exactly what to add to their .env file.
 */
function getApiKey() {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) {
    throw new Error(
      'ANTHROPIC_API_KEY is not set. Add it to your .env file:\n' +
      '  ANTHROPIC_API_KEY=sk-ant-api03-...'
    );
  }
  return key;
}

/**
 * callClaude
 * Low-level wrapper around the Anthropic /v1/messages endpoint.
 */
async function callClaude(systemPrompt, userMessage, maxTokens = 2000) {
  const response = await axios.post(
    CLAUDE_API_URL,
    {
      model:      CLAUDE_MODEL,
      max_tokens: maxTokens,
      system:     systemPrompt,
      messages:   [{ role: 'user', content: userMessage }],
    },
    {
      headers: {
        'x-api-key':         getApiKey(),
        'anthropic-version': '2023-06-01',
        'content-type':      'application/json',
      },
      timeout: 60000,
    }
  );

  return response.data.content
    .filter(b => b.type === 'text')
    .map(b => b.text)
    .join('');
}

/**
 * parseJsonResponse
 * Strips any accidental markdown fences and parses Claude's JSON.
 */
function parseJsonResponse(rawText) {
  const cleaned = rawText
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim();
  return JSON.parse(cleaned);
}

/**
 * buildFileContext
 * Selects and formats the most relevant files to send to Claude.
 * Priority files go first, everything else fills up to MAX_FILES_TO_SEND.
 */
function buildFileContext(fileContents) {
  const allFilenames = Array.from(fileContents.keys())
    .filter(k => !k.includes('/'));  // Top-level filenames only

  const ordered = [
    ...PRIORITY_FILES.filter(f => fileContents.has(f)),
    ...allFilenames.filter(f => !PRIORITY_FILES.includes(f)),
  ].slice(0, MAX_FILES_TO_SEND);

  return ordered.map(filename => {
    const content   = fileContents.get(filename) || '';
    const truncated = content.length > MAX_FILE_CONTENT_CHARS
      ? content.substring(0, MAX_FILE_CONTENT_CHARS) + '\n... [truncated]'
      : content;
    return `\n### FILE: ${filename}\n\`\`\`\n${truncated}\n\`\`\``;
  }).join('\n');
}

// ════════════════════════════════════════════════════════════
// FEATURE 1 — SECURITY & ARCHITECTURE ANALYSIS
// ════════════════════════════════════════════════════════════

/**
 * analyseRepository
 * Sends actual file contents to Claude for intelligent analysis.
 * Returns structured findings across security, performance,
 * architecture, and compliance categories.
 *
 * @param {Object}   scanResult   - Output from repoScanner
 * @param {Map}      fileContents - filename → file content strings
 * @param {Function} onProgress
 * @returns {Object} { findings: [...], summary: {...} }
 */
async function analyseRepository(scanResult, fileContents, onProgress = () => {}) {
  onProgress('Preparing files for AI analysis...');

  const fileContext = buildFileContext(fileContents);

  const systemPrompt = `You are a senior DevSecOps engineer reviewing a repository before deployment to Google Cloud.
Analyse the provided files and return a structured JSON list of findings.

CRITICAL: Respond with ONLY a valid JSON object. No preamble, no explanation outside the JSON, no markdown fences.

Required JSON structure:
{
  "findings": [
    {
      "id": "unique-kebab-case-id",
      "category": "security" | "performance" | "architecture" | "compliance",
      "severity": "critical" | "high" | "medium" | "low" | "info",
      "title": "Short headline (max 10 words)",
      "detail": "Full explanation of the issue and why it matters (2-4 sentences)",
      "action": "Specific actionable fix the developer can apply now (2-3 sentences)",
      "file": "filename where the issue was found, or null",
      "line": line_number_integer_or_null
    }
  ],
  "summary": {
    "overallRisk": "critical" | "high" | "medium" | "low",
    "totalFindings": <integer>,
    "byCategoryAndSeverity": {
      "security":     { "critical": 0, "high": 0, "medium": 0, "low": 0 },
      "performance":  { "critical": 0, "high": 0, "medium": 0, "low": 0 },
      "architecture": { "critical": 0, "high": 0, "medium": 0, "low": 0 },
      "compliance":   { "critical": 0, "high": 0, "medium": 0, "low": 0 }
    },
    "topPriority": "The single most important thing to fix right now (1 sentence)"
  }
}

Check for ALL of the following and anything else you spot:

SECURITY:
- Hardcoded secrets, passwords, tokens, or API keys anywhere in the files
- Dockerfile with no USER instruction (runs as root)
- Missing security headers (Helmet.js in Express, SECURE_SSL_REDIRECT in Django, etc.)
- Database connection strings without SSL
- Exposed debug routes or dev middleware that would be active in production
- .env file not listed in .gitignore
- Dependencies using "latest" tags or completely unpinned versions
- Missing CORS config or overly permissive CORS (*)
- No rate limiting on API endpoints

PERFORMANCE:
- No database connection pooling configured
- Docker image based on full OS (ubuntu, debian) when alpine would work
- No multi-stage Docker build (image will be unnecessarily large)
- Missing compression middleware

ARCHITECTURE:
- No health check endpoint (GET /health or /healthz)
- No graceful shutdown handler (SIGTERM)
- Hardcoded URLs, ports, or environment-specific values in source files
- docker-compose.yml missing restart policies
- No structured logging (plain console.log everywhere)

COMPLIANCE:
- No LICENSE file
- No SECURITY.md
- Dependencies at very old major versions with known CVEs`;

  const userMessage = `Analyse this repository for deployment readiness.

## Detected Stack
Languages: ${scanResult.summary?.byType?.languages?.join(', ') || 'unknown'}
Backend: ${scanResult.summary?.byType?.backend?.join(', ') || 'none'}
Frontend: ${scanResult.summary?.byType?.frontend?.join(', ') || 'none'}
Databases: ${scanResult.summary?.byType?.database?.join(', ') || 'none'}
Infrastructure: ${scanResult.summary?.byType?.infrastructure?.join(', ') || 'none'}
Total files in repo: ${scanResult.totalFiles || 'unknown'}

## File Contents
${fileContext}`;

  onProgress('Claude is analysing your repository...');
  const rawResponse = await callClaude(systemPrompt, userMessage, 3000);
  onProgress('Parsing analysis results...');

  try {
    const parsed = parseJsonResponse(rawResponse);
    if (!parsed.findings || !Array.isArray(parsed.findings)) {
      throw new Error('Missing findings array in response');
    }
    return parsed;
  } catch (err) {
    console.error('[ClaudeAnalyser] Parse error:', err.message);
    return {
      findings: [{
        id: 'parse-error', category: 'architecture', severity: 'info',
        title: 'Analysis could not be parsed — please retry',
        detail: 'The AI analysis completed but the response could not be read.',
        action: 'Re-run the analysis. If it persists, check ANTHROPIC_API_KEY in your .env file.',
        file: null, line: null,
      }],
      summary: {
        overallRisk: 'unknown', totalFindings: 1,
        byCategoryAndSeverity: {
          security:     { critical: 0, high: 0, medium: 0, low: 0 },
          performance:  { critical: 0, high: 0, medium: 0, low: 0 },
          architecture: { critical: 0, high: 0, medium: 0, low: 0 },
          compliance:   { critical: 0, high: 0, medium: 0, low: 0 },
        },
        topPriority: 'Re-run the analysis.',
      },
    };
  }
}

// ════════════════════════════════════════════════════════════
// FEATURE 2 — TIER RECOMMENDATION
// ════════════════════════════════════════════════════════════

/**
 * recommendTiers
 * Asks Claude to recommend the right GCP tier for each service
 * based on the detected stack and the user's usage answers.
 *
 * @param {Object}   scanResult    - From repoScanner
 * @param {Object}   graphMetadata - From architectureMapper
 * @param {Object}   gcpProducts   - The GCP_PRODUCTS catalogue from gcpPlanner
 * @param {Object}   usageAnswers  - { expectedDailyUsers, teamSize, budget,
 *                                     isProduction, expectsSpikes }
 * @param {Function} onProgress
 * @returns {Object|null} { recommendations, totalEstimatedMonthly, overallAdvice }
 *   Returns null on failure — caller falls back to hardcoded defaults.
 */
async function recommendTiers(scanResult, graphMetadata, gcpProducts, usageAnswers, onProgress = () => {}) {
  onProgress('Asking Claude for tier recommendations...');

  const productsContext = graphMetadata.requiredGcpProducts
    .filter(name => gcpProducts[name])
    .map(name => {
      const product   = gcpProducts[name];
      const tiersText = product.tiers.map(t =>
        `  - ${t.id} (${t.name}): ${t.specs} — ~$${t.fallbackMonthlyCost}/mo — best for: ${t.useCase}`
      ).join('\n');
      return `### ${name}\n${tiersText}`;
    })
    .join('\n\n');

  const systemPrompt = `You are a senior GCP solutions architect helping a developer choose the right service tiers.

CRITICAL: Respond with ONLY a valid JSON object. No preamble, no markdown fences.

Required JSON structure:
{
  "recommendations": {
    "<exact productName>": {
      "tierId": "<exact tier id>",
      "reasoning": "2-3 sentence plain English explanation of why this tier fits",
      "warningIfWrong": "1 sentence on what breaks if they pick too small or too large"
    }
  },
  "totalEstimatedMonthly": <number>,
  "overallAdvice": "2-3 sentences of overall cost/scaling advice for their situation"
}

Be practical. Small team + low traffic = smaller tiers. Production + spikes = bigger tiers.`;

  const userMessage = `Recommend GCP tiers for this deployment.

## Tech Stack
Languages: ${scanResult.summary?.byType?.languages?.join(', ') || 'unknown'}
Backend: ${scanResult.summary?.byType?.backend?.join(', ') || 'none'}
Frontend: ${scanResult.summary?.byType?.frontend?.join(', ') || 'none'}
Databases: ${scanResult.summary?.byType?.database?.join(', ') || 'none'}
Containerised: ${graphMetadata.isContainerised ? 'yes' : 'no'}
Monorepo: ${scanResult.isMonorepo ? `yes (${scanResult.services?.length} services)` : 'no'}

## Usage Answers
Expected daily active users: ${usageAnswers.expectedDailyUsers || 'not specified'}
Team size: ${usageAnswers.teamSize || 'not specified'}
Monthly budget: $${usageAnswers.budget || 'not specified'}
Production deployment: ${usageAnswers.isProduction ? 'yes' : 'no'}
Expects traffic spikes: ${usageAnswers.expectsSpikes ? 'yes' : 'no'}

## Available Tiers
${productsContext}`;

  const rawResponse = await callClaude(systemPrompt, userMessage, 2000);
  onProgress('Parsing tier recommendations...');

  try {
    const parsed = parseJsonResponse(rawResponse);
    if (!parsed.recommendations) throw new Error('Missing recommendations object');
    return parsed;
  } catch (err) {
    console.error('[ClaudeAnalyser] Tier recommendation parse error:', err.message);
    return null;  // gcpPlanner falls back to hardcoded defaults
  }
}

module.exports = { analyseRepository, recommendTiers };