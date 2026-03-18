'use strict';

/**
 * Get 1-based start/end line from a tree-sitter node (0-based row).
 */
function nodeRange(node, source) {
  const startLine = (node.startPosition && node.startPosition.row != null)
    ? node.startPosition.row + 1
    : 1;
  const endLine = (node.endPosition && node.endPosition.row != null)
    ? node.endPosition.row + 1
    : startLine;
  return { startLine, endLine };
}

/**
 * Get first line (or first two lines) of node as "signature" text.
 */
function signatureLine(node, source) {
  if (!source || !node) return '';
  const start = node.startPosition ? node.startPosition.index : 0;
  const end = node.endPosition ? node.endPosition.index : source.length;
  const slice = source.slice(start, end);
  const lines = slice.split(/\n/).filter(Boolean);
  return lines.slice(0, 2).join(' ').trim().slice(0, 200);
}

/**
 * Stable id for an entity: filePath#name (deduped by name in file).
 */
function entityId(filePath, name, kind) {
  const safe = (name || 'anonymous').replace(/#/g, '_');
  return `${filePath}#${safe}`;
}

module.exports = { nodeRange, signatureLine, entityId };
