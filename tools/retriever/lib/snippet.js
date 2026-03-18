'use strict';

const fs = require('fs');
const path = require('path');

const { maxSnippetLines, snippetContextLines } = require('../config');

function writeSnippet(repoRoot, filePath, startLine, endLine, outPath) {
  const full = path.join(repoRoot, filePath);
  let lines;
  try {
    const raw = fs.readFileSync(full, 'utf8');
    lines = raw.split(/\n/);
  } catch (err) {
    return null;
  }
  const oneBased = 1;
  const start = Math.max(oneBased, startLine - snippetContextLines) - 1;
  const end = Math.min(lines.length, endLine + snippetContextLines);
  const cappedEnd = Math.min(end, start + maxSnippetLines);
  const slice = lines.slice(start, cappedEnd).join('\n');
  const header = `FILE: ${filePath}\nLINES: ${start + 1}-${cappedEnd}\n--- SNIPPET START ---\n`;
  const footer = '\n--- SNIPPET END ---';
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, header + slice + footer, 'utf8');
  return { filePath, startLine: start + 1, endLine: cappedEnd };
}

module.exports = { writeSnippet };
