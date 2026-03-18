'use strict';

const fs = require('fs');
const path = require('path');

function buildContext(entities, outPath) {
  const lines = [
    '# Retrieved context',
    '',
    '## Entities',
    '',
  ];
  for (const e of entities) {
    lines.push(`- **${e.name}** (${e.kind}) — \`${e.file}:${e.startLine}-${e.endLine}\``);
    if (e.signature) lines.push(`  \`${e.signature.slice(0, 80)}${e.signature.length > 80 ? '...' : ''}\``);
    lines.push('');
  }
  lines.push('## Instructions');
  lines.push('');
  lines.push('Answer only from the snippets in retrieval/snippets/. Cite as (path:startLine-endLine).');
  lines.push('If something is not in the snippets, say "I cannot confirm from the retrieved code."');
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, lines.join('\n'), 'utf8');
}

module.exports = { buildContext };
