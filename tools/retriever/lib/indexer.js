'use strict';

const fs = require('fs');
const path = require('path');
const { walkRepo } = require('./walk');
const jsParser = require('../parsers/javascript');
const tsParser = require('../parsers/typescript');
const pyParser = require('../parsers/python');

const parsers = [
  { exts: ['.js', '.jsx'], parse: jsParser.parseFile },
  { exts: ['.ts', '.tsx'], parse: tsParser.parseFile },
  { exts: ['.py'], parse: pyParser.parseFile },
];

function getParser(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  for (const p of parsers) {
    if (p.exts.includes(ext)) return p.parse;
  }
  return null;
}

function runIndex(repoRoot, outDir) {
  const files = walkRepo(repoRoot);
  const allEntities = [];
  const allEdges = [];

  for (const rel of files) {
    const fullPath = path.join(repoRoot, rel);
    let source;
    try {
      source = fs.readFileSync(fullPath, 'utf8');
    } catch (err) {
      continue;
    }
    const parse = getParser(rel);
    if (!parse) continue;
    try {
      const { entities, edges } = parse(rel, source);
      allEntities.push(...entities);
      allEdges.push(...edges);
    } catch (err) {
      // Skip broken parses
    }
  }

  const outPath = path.join(outDir, 'index.json');
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify({ entities: allEntities, edges: allEdges }, null, 2), 'utf8');
  return { entityCount: allEntities.length, edgeCount: allEdges.length, outPath };
}

module.exports = { runIndex };
