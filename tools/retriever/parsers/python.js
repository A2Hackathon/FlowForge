'use strict';

const Parser = require('tree-sitter');
const Python = require('tree-sitter-python');
const { nodeRange, signatureLine, entityId } = require('./common');

const parser = new Parser();
parser.setLanguage(Python);

function getName(node, source) {
  const nameNode = node.childForFieldName('name');
  if (!nameNode) return 'anonymous';
  return source.slice(nameNode.startIndex, nameNode.endIndex).trim() || 'anonymous';
}

function getCallName(node, source) {
  const first = node.childForFieldName('function') || node.child(0);
  if (!first) return null;
  if (first.type === 'identifier') return source.slice(first.startIndex, first.endIndex).trim();
  if (first.type === 'attribute') {
    const attr = first.childForFieldName('attribute');
    if (attr) return source.slice(attr.startIndex, attr.endIndex).trim();
  }
  return null;
}

function collectEntitiesAndEdges(node, source, filePath, entities, edges, currentEntityId) {
  if (!node) return;
  const type = node.type;
  const range = nodeRange(node, source);
  const sig = signatureLine(node, source);

  if (type === 'function_definition') {
    const name = getName(node, source);
    const id = entityId(filePath, name, 'function');
    entities.push({ id, kind: 'function', name, file: filePath, startLine: range.startLine, endLine: range.endLine, signature: sig, language: 'py' });
    for (let i = 0; i < node.childCount; i++) collectEntitiesAndEdges(node.child(i), source, filePath, entities, edges, id);
    return;
  }
  if (type === 'class_definition') {
    const name = getName(node, source);
    const id = entityId(filePath, name, 'class');
    entities.push({ id, kind: 'class', name, file: filePath, startLine: range.startLine, endLine: range.endLine, signature: sig, language: 'py' });
    for (let i = 0; i < node.childCount; i++) collectEntitiesAndEdges(node.child(i), source, filePath, entities, edges, id);
    return;
  }
  if (type === 'call' && currentEntityId) {
    const callee = getCallName(node, source);
    if (callee) edges.push({ type: 'calls', from: currentEntityId, toName: callee });
  }
  for (let i = 0; i < node.childCount; i++) collectEntitiesAndEdges(node.child(i), source, filePath, entities, edges, currentEntityId);
}

function parseFile(filePath, source) {
  const tree = parser.parse(source);
  const entities = [];
  const edges = [];
  collectEntitiesAndEdges(tree.rootNode, source, filePath, entities, edges, null);
  return { entities, edges };
}

module.exports = { parseFile };
module.exports.language = 'python';
module.exports.extensions = ['.py'];
