'use strict';

const fs = require('fs');
const path = require('path');
const { maxEntities, maxFiles } = require('../config');
const { writeSnippet } = require('./snippet');
const { buildContext } = require('./context-builder');

function tokenizeQuery(query) {
  return query
    .toLowerCase()
    .replace(/[^a-z0-9_\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

function scoreEntity(entity, keywords) {
  let score = 0;
  const name = (entity.name || '').toLowerCase();
  const file = (entity.file || '').toLowerCase();
  const sig = (entity.signature || '').toLowerCase();
  for (const k of keywords) {
    if (name.includes(k)) score += 3;
    if (file.includes(k)) score += 2;
    if (sig.includes(k)) score += 1;
  }
  return score;
}

function runRetrieve(repoRoot, indexPath, query, outDir) {
  const raw = fs.readFileSync(indexPath, 'utf8');
  const { entities, edges } = JSON.parse(raw);
  const keywords = tokenizeQuery(query);
  if (keywords.length === 0) keywords.push('main', 'index', 'app');

  const scored = entities.map(e => ({ entity: e, score: scoreEntity(e, keywords) }));
  scored.sort((a, b) => b.score - a.score);

  const entityById = new Map(entities.map(e => [e.id, e]));
  const outCalls = new Map();
  for (const ed of edges) {
    if (ed.type === 'calls') {
      if (!outCalls.has(ed.from)) outCalls.set(ed.from, []);
      outCalls.get(ed.from).push(ed.toName);
    }
  }

  const selected = [];
  const seenIds = new Set();
  const seenFiles = new Set();

  for (const { entity, score } of scored) {
    if (selected.length >= maxEntities || seenFiles.size >= maxFiles) break;
    if (score === 0 && selected.length > 0) break;
    if (seenIds.has(entity.id)) continue;
    selected.push({ entity, score, why: score > 0 ? 'keyword match' : 'graph' });
    seenIds.add(entity.id);
    seenFiles.add(entity.file);
  }

  for (const { entity } of selected) {
    const callees = outCalls.get(entity.id) || [];
    for (const toName of callees.slice(0, 5)) {
      const match = entities.find(e => e.name === toName && !seenIds.has(e.id));
      if (match && selected.length < maxEntities && seenFiles.size <= maxFiles) {
        selected.push({ entity: match, score: 0, why: `called by ${entity.name}` });
        seenIds.add(match.id);
        seenFiles.add(match.file);
      }
    }
  }

  const snippetsDir = path.join(outDir, 'snippets');
  fs.mkdirSync(snippetsDir, { recursive: true });
  const manifestEntries = [];
  let n = 1;
  for (const { entity, why } of selected) {
    const snippetPath = path.join(snippetsDir, `${String(n).padStart(3, '0')}.txt`);
    const written = writeSnippet(repoRoot, entity.file, entity.startLine, entity.endLine, snippetPath);
    if (written) {
      manifestEntries.push({ entity: entity.id, file: entity.file, lines: [entity.startLine, entity.endLine], why });
      n++;
    }
  }

  const selectedEntities = selected.map(s => s.entity);
  buildContext(selectedEntities, path.join(outDir, 'context.md'));

  const manifest = {
    query,
    selected: manifestEntries,
    limits: { maxEntities, maxFiles },
  };
  fs.writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');
}

module.exports = { runRetrieve };
