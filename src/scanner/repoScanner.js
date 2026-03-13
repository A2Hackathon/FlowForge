// src/scanner/repoScanner.js
// ─────────────────────────────────────────────────────────────
// Day 3 core logic.
//
// Given a GitLab project ID, this file:
//   1. Gets the FULL file list (paginated — no 100-file cap)
//   2. Detects if this is a monorepo (multiple services in one repo)
//   3. Identifies which of our target files exist per service
//   4. Downloads those files in rate-limited batches
//   5. Runs language + framework + compliance rules against them
//   6. Returns a structured scan result (or one result per service)
//
// Scalability fixes applied:
//   [FIX 1] getRepositoryTree now paginates — handles repos of any size
//   [FIX 2] downloadInBatches — max 5 concurrent downloads, avoids 429s
//   [FIX 3] Monorepo detection — scans each service directory separately
// ─────────────────────────────────────────────────────────────

const { getRepositoryTree, getFileContent, getDefaultBranch, downloadInBatches } = require('../api/gitlabClient');
const { LANGUAGE_RULES, CONTENT_RULES, FILE_PRESENCE_RULES, COMPLIANCE_RULES } = require('./detectionRules');

// Files we always try to download if they exist.
// We only fetch these — downloading every file would be far too slow.
const FILES_TO_SCAN = [
  'package.json', 'tsconfig.json',
  'requirements.txt', 'Pipfile', 'setup.py', 'pyproject.toml',
  'go.mod', 'Gemfile', 'composer.json', 'Cargo.toml',
  'pom.xml', 'build.gradle',
  'Dockerfile', 'docker-compose.yml', 'docker-compose.yaml',
  '.gitlab-ci.yml', '.env.example', '.gitignore',
  'nginx.conf', 'SECURITY.md', 'LICENSE', 'CHANGELOG.md',
];

/**
 * scanRepository
 * Main exported function — orchestrates the full scan.
 *
 * @param {number}   projectId  - GitLab project ID
 * @param {Function} onProgress - Called with a status string during scanning.
 *
 * @returns {Object} Structured scan result:
 *   isMonorepo: boolean
 *   services:   array of per-service results (length 1 for normal repos)
 */
async function scanRepository(projectId, onProgress = () => {}) {

  // ── Step 1: Determine default branch ──────────────────────
  onProgress('Detecting default branch...');
  const branch = await getDefaultBranch(projectId);

  // ── Step 2: List ALL files in the repo ────────────────────
  // FIX 1: getRepositoryTree now paginates through every page,
  // so we get ALL files — not just the first 100.
  onProgress(`Fetching full file list from '${branch}'...`);
  const allFiles = await getRepositoryTree(projectId, '', branch);

  const filePaths   = allFiles.filter(f => f.type === 'blob').map(f => f.path);
  const filePathSet = new Set(filePaths);

  onProgress(`Found ${filePaths.length} files total.`);

  // ── Step 3: FIX 3 — Detect monorepo ───────────────────────
  // A monorepo has multiple services each with their own dependency file.
  // We find all directories that contain a known dependency file, then
  // scan each one as a separate service.
  const serviceDirs = findServiceDirectories(filePaths);
  const isMonorepo  = serviceDirs.length > 1;

  if (isMonorepo) {
    onProgress(`Monorepo detected — found ${serviceDirs.length} services: ${serviceDirs.map(d => d || 'root').join(', ')}`);
  }

  // ── Step 4: Scan each service directory ───────────────────
  // For a normal repo, serviceDirs = [''] (just the root).
  // For a monorepo, serviceDirs = ['frontend', 'backend', 'ml-service'], etc.
  const serviceResults = await Promise.all(
    serviceDirs.map((dir, index) => {
      const label = dir || 'root';
      return scanServiceDirectory({
        projectId,
        branch,
        dir,
        filePaths,
        filePathSet,
        onProgress: (msg) => onProgress(`[${label}] ${msg}`),
      });
    })
  );

  onProgress('Scan complete!');

  return {
    projectId,
    branch,
    totalFiles: filePaths.length,
    isMonorepo,
    // Flat list of repo entries for confirm screen (path + type: 'blob'|'tree').
    repositoryTree: allFiles.map(f => ({ path: f.path, type: f.type })),
    // For normal repos: services[0] is the full result (backwards compatible).
    // For monorepos: one result per detected service directory.
    services: serviceResults,
    // Keep top-level shortcut for non-monorepo consumers (Day 4 mapper etc.)
    ...(isMonorepo ? {} : serviceResults[0]),
  };
}

/**
 * findServiceDirectories
 * FIX 3: Identifies distinct service directories within a repo.
 *
 * Logic: a "service" is any directory that contains a dependency file
 * (package.json, requirements.txt, go.mod, etc.) at its root level.
 *
 * Examples:
 *   Normal repo:  ['package.json']              → ['']   (just root)
 *   Monorepo:     ['frontend/package.json',
 *                  'backend/package.json',
 *                  'ml/requirements.txt']        → ['frontend', 'backend', 'ml']
 *
 * @param {string[]} filePaths - All file paths in the repo
 * @returns {string[]} Array of directory paths ('' = root)
 */
function findServiceDirectories(filePaths) {
  // These files indicate the root of a service
  const depFiles = [
    'package.json', 'requirements.txt', 'go.mod',
    'Gemfile', 'composer.json', 'Cargo.toml', 'pom.xml', 'build.gradle',
  ];

  const serviceDirs = new Set();

  filePaths.forEach(filePath => {
    const filename  = filePath.split('/').pop();
    const isDepFile = depFiles.includes(filename);

    if (isDepFile) {
      // Get the directory containing this file.
      // 'frontend/package.json' → 'frontend'
      // 'package.json'          → '' (root)
      const dir = filePath.includes('/')
        ? filePath.substring(0, filePath.lastIndexOf('/'))
        : '';

      // Only count top-level service directories, not deeply nested ones.
      // 'frontend' is a service. 'frontend/node_modules/lodash' is not.
      const depth = dir.split('/').filter(Boolean).length;
      if (depth <= 1) {
        serviceDirs.add(dir);
      }
    }
  });

  // If nothing was found (unusual repo structure), default to root
  if (serviceDirs.size === 0) serviceDirs.add('');

  // Sort so root ('') comes first, then alphabetically
  return Array.from(serviceDirs).sort((a, b) => {
    if (a === '') return -1;
    if (b === '') return 1;
    return a.localeCompare(b);
  });
}

/**
 * scanServiceDirectory
 * Scans one service directory within a repo.
 * Called once for normal repos (dir='') and once per service for monorepos.
 *
 * @param {Object} opts
 * @param {number}   opts.projectId   - GitLab project ID
 * @param {string}   opts.branch      - Branch name
 * @param {string}   opts.dir         - Service directory path ('' = root)
 * @param {string[]} opts.filePaths   - All file paths in the whole repo
 * @param {Set}      opts.filePathSet - Set version for O(1) lookups
 * @param {Function} opts.onProgress  - Progress callback
 */
async function scanServiceDirectory({ projectId, branch, dir, filePaths, filePathSet, onProgress }) {

  // Build the list of files we want to fetch, scoped to this directory.
  // For root (''), we look for 'package.json'.
  // For 'frontend/', we look for 'frontend/package.json'.
  const prefix     = dir ? `${dir}/` : '';
  const filesToFetch = FILES_TO_SCAN
    .map(target => prefix + target)               // Prefix each target with the dir
    .filter(fullPath => filePathSet.has(fullPath)); // Only keep ones that exist

  onProgress(`Found ${filesToFetch.length} key files to download.`);

  // ── FIX 2: Download in rate-limited batches ──────────────
  // Instead of firing all requests simultaneously, we process
  // 5 at a time with a 200ms pause between batches.
  const downloadResults = await downloadInBatches(
    filesToFetch,
    projectId,
    branch,
    5,          // batchSize: 5 concurrent downloads at a time
    onProgress
  );

  // Build content map: { 'package.json' → '{ ... }' }
  // Store by both full path AND bare filename for flexible rule matching.
  const fileContents = new Map();
  downloadResults.forEach(result => {
    if (result.status === 'fulfilled') {
      const { path, content } = result.value;
      const filename = path.split('/').pop();
      fileContents.set(filename, content);
      fileContents.set(path, content);
    }
  });

  onProgress('Running detection rules...');

  // Scope filePaths to just this service directory for detection
  const scopedPaths   = filePaths.filter(p => p.startsWith(prefix));
  const scopedPathSet = new Set(scopedPaths);

  const languages      = detectLanguages(scopedPathSet, scopedPaths);
  const frameworks     = detectFrameworks(fileContents);
  const infrastructure = detectInfrastructure(scopedPathSet);
  const compliance     = checkCompliance(scopedPathSet);
  const dependencies   = extractDependencies(fileContents);

  return {
    serviceDir:   dir || 'root',
    scannedFiles: filesToFetch,
    languages,
    frameworks,
    infrastructure,
    compliance,
    dependencies,
    summary: {
      technologies: [
        ...languages.map(l => l.name),
        ...frameworks.map(f => f.name),
        ...infrastructure.map(i => i.name),
      ],
      byType: {
        languages:      languages.map(l => l.name),
        backend:        frameworks.filter(f => f.type === 'backend').map(f => f.name),
        frontend:       frameworks.filter(f => f.type === 'frontend').map(f => f.name),
        fullstack:      frameworks.filter(f => f.type === 'fullstack').map(f => f.name),
        database:       frameworks.filter(f => f.type === 'database').map(f => f.name),
        cache:          frameworks.filter(f => f.type === 'cache').map(f => f.name),
        queue:          frameworks.filter(f => f.type === 'queue').map(f => f.name),
        infrastructure: infrastructure.map(i => i.name),
      },
    },
  };
}

// ── Detection helpers ──────────────────────────────────────────

function detectLanguages(filePathSet, allFilePaths) {
  return LANGUAGE_RULES
    .filter(rule =>
      rule.indicatorFiles.some(file =>
        filePathSet.has(file) || allFilePaths.some(p => p.endsWith('/' + file))
      )
    )
    .map(rule => ({ name: rule.name, confidence: 'high' }));
}

function detectFrameworks(fileContents) {
  const detected = [];
  const seen     = new Set();   // Prevent duplicate entries

  for (const rule of CONTENT_RULES) {
    const content = fileContents.get(rule.file);
    if (!content) continue;

    // Case-insensitive match
    if (content.toLowerCase().includes(rule.contains.toLowerCase()) && !seen.has(rule.name)) {
      seen.add(rule.name);
      detected.push({ name: rule.name, type: rule.type, description: rule.description });
    }
  }

  return detected;
}

function detectInfrastructure(filePathSet) {
  return Object.entries(FILE_PRESENCE_RULES)
    .filter(([filename]) => filePathSet.has(filename))
    .map(([file, info]) => ({ name: info.name, type: info.type, file }));
}

function checkCompliance(filePathSet) {
  const passed  = [];
  const missing = [];

  for (const rule of COMPLIANCE_RULES) {
    if (filePathSet.has(rule.file)) {
      passed.push({ file: rule.file, indicates: rule.indicates });
    } else {
      missing.push({ file: rule.file, indicates: rule.indicates });
    }
  }

  return { passed, missing };
}

function extractDependencies(fileContents) {
  const deps = {};

  // Node.js — parse package.json
  const packageJson = fileContents.get('package.json');
  if (packageJson) {
    try {
      const parsed = JSON.parse(packageJson);
      deps.npm = {
        dependencies:    parsed.dependencies    || {},
        devDependencies: parsed.devDependencies || {},
        count:
          Object.keys(parsed.dependencies    || {}).length +
          Object.keys(parsed.devDependencies || {}).length,
      };
    } catch (e) {
      console.warn('[Scanner] Could not parse package.json:', e.message);
    }
  }

  // Python — parse requirements.txt (one package per line: 'flask==2.3.0')
  const requirements = fileContents.get('requirements.txt');
  if (requirements) {
    const packages = requirements
      .split('\n')
      .map(l => l.trim())
      .filter(l => l && !l.startsWith('#'))
      .map(l => ({ name: l.split(/[=><!~]/)[0].trim(), version: l }));

    deps.pip = { packages, count: packages.length };
  }

  return deps;
}

module.exports = { scanRepository };