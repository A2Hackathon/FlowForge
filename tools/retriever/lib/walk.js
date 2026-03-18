'use strict';

const fs = require('fs');
const path = require('path');

const { extensions, ignoreDirs } = require('../config');

/**
 * Walk repo and return file paths with allowed extensions.
 * Skips ignoreDirs and respects .gitignore-style ignores (dirs only).
 */
function walkRepo(repoRoot, options = {}) {
  const extSet = new Set(extensions);
  const ignore = new Set(ignoreDirs.map(d => d.toLowerCase()));
  const files = [];

  function walk(dir) {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (err) {
      return;
    }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      const rel = path.relative(repoRoot, full);
      if (e.isDirectory()) {
        if (ignore.has(e.name.toLowerCase())) continue;
        walk(full);
      } else if (e.isFile()) {
        const ext = path.extname(e.name).toLowerCase();
        if (extSet.has(ext)) files.push(rel.replace(/\\/g, '/'));
      }
    }
  }

  walk(repoRoot);
  return files;
}

module.exports = { walkRepo };
