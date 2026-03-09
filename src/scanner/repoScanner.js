// src/scanner/repoScanner.js
// ─────────────────────────────────────────────────────────────
// Day 3 core logic.
//
// Given a GitLab project ID, this file:
//   1. Gets the full file list (no content yet — just paths)
//   2. Identifies which of our target files exist in the repo
//   3. Downloads those files in parallel
//   4. Runs language + framework + compliance rules against them
//   5. Returns a structured scan result
//
// The scan result is passed directly to the architecture mapper
// on Day 4 and used by Person B to render the "Detected Stack" screen.
// ─────────────────────────────────────────────────────────────

const { getRepositoryTree, getFileContent, getDefaultBranch } = require('../api/gitlabClient');
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
 *                                Forwarded to the frontend as a live update.
 *
 * @returns {Object} Structured scan result (see end of file for shape)
 */
async function scanRepository(projectId, onProgress = () => {}) {

  // ── Step 1: Determine default branch ──────────────────────
  onProgress('Detecting default branch...');
  const branch = await getDefaultBranch(projectId);

  // ── Step 2: List all files in the repo ────────────────────
  onProgress(`Fetching file list from '${branch}'...`);
  const allFiles = await getRepositoryTree(projectId, '', branch);

  // Build a Set of all file paths for fast O(1) lookups.
  // We only want actual files (type 'blob'), not directories (type 'tree').
  const filePaths   = allFiles.filter(f => f.type === 'blob').map(f => f.path);
  const filePathSet = new Set(filePaths);

  onProgress(`Found ${filePaths.length} files. Identifying key files...`);

  // ── Step 3: Filter to only files we care about ────────────
  // Check both at root level ('package.json') and in subdirectories
  // ('backend/package.json') — monorepos may have files nested deeper.
  const filesToFetch = FILES_TO_SCAN.filter(target =>
    filePathSet.has(target) ||
    filePaths.some(p => p.endsWith('/' + target))
  );

  onProgress(`Downloading ${filesToFetch.length} key files...`);

  // ── Step 4: Download files in parallel ────────────────────
  // Promise.allSettled() runs all downloads simultaneously and
  // collects results without stopping on failures.
  // This is much faster than sequential downloading.
  const downloadResults = await Promise.allSettled(
    filesToFetch.map(async (filePath) => {
      const content = await getFileContent(projectId, filePath, branch);
      return { path: filePath, content };
    })
  );

  // Build a Map: { 'package.json' → '<file content>' }
  // Store by both the full path AND just the filename so rules can
  // match either 'Dockerfile' or 'backend/Dockerfile'.
  const fileContents = new Map();
  downloadResults.forEach(result => {
    if (result.status === 'fulfilled') {
      const { path, content } = result.value;
      const filename = path.split('/').pop();   // 'src/Dockerfile' → 'Dockerfile'
      fileContents.set(filename, content);
      fileContents.set(path, content);
    }
  });

  onProgress('Running detection rules...');

  // ── Step 5: Run all detection rules ───────────────────────
  const languages      = detectLanguages(filePathSet, filePaths);
  const frameworks     = detectFrameworks(fileContents);
  const infrastructure = detectInfrastructure(filePathSet);
  const compliance     = checkCompliance(filePathSet);
  const dependencies   = extractDependencies(fileContents);

  onProgress('Scan complete!');

  // ── Step 6: Return the structured result ──────────────────
  return {
    projectId,
    branch,
    totalFiles:    filePaths.length,
    scannedFiles:  filesToFetch,
    languages,
    frameworks,
    infrastructure,
    compliance,
    dependencies,
    // Flat summary used by Day 4 architecture mapper and the UI
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
