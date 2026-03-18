'use strict';

const Parser = require('tree-sitter');
const TypeScript = require('tree-sitter-typescript');
const { nodeRange, signatureLine, entityId } = require('./common');

const parserTS = new Parser();
parserTS.setLanguage(TypeScript.typescript);
const parserTSX = new Parser();
parserTSX.setLanguage(TypeScript.tsx);

function getName(node, source) {
  const nameNode = node.childForFieldName('name') || node.child(1);
  if (!nameNode) return 'anonymous';
  return source.slice(nameNode.startIndex, nameNode.endIndex).trim() || 'anonymous';
}

function getCallName(node, source) {
  const first = node.childForFieldName('function') || node.child(0);
  if (!first) return null;
  if (first.type === 'identifier') return source.slice(first.startIndex, first.endIndex).trim();
  if (first.type === 'member_expression') {
    const prop = first.childForFieldName('property');
    if (prop) return source.slice(prop.startIndex, prop.endIndex).trim();
  }
  return null;
}

function collectEntitiesAndEdges(node, source, filePath, entities, edges, currentEntityId) {
  if (!node) return;
  const type = node.type;
  const range = nodeRange(node, source);
  const sig = signatureLine(node, source);

  if (type === 'function_declaration') {
    const name = getName(node, source);
    const id = entityId(filePath, name, 'function');
    entities.push({ id, kind: 'function', name, file: filePath, startLine: range.startLine, endLine: range.endLine, signature: sig, language: 'ts' });
    for (let i = 0; i < node.childCount; i++) collectEntitiesAndEdges(node.child(i), source, filePath, entities, edges, id);
    return;
  }
  if (type === 'class_declaration') {
    const name = getName(node, source);
    const id = entityId(filePath, name, 'class');
    entities.push({ id, kind: 'class', name, file: filePath, startLine: range.startLine, endLine: range.endLine, signature: sig, language: 'ts' });
    for (let i = 0; i < node.childCount; i++) collectEntitiesAndEdges(node.child(i), source, filePath, entities, edges, id);
    return;
  }
  if (type === 'method_definition') {
    const nameNode = node.childForFieldName('name');
    const name = nameNode ? source.slice(nameNode.startIndex, nameNode.endIndex).trim() : 'anonymous';
    const id = entityId(filePath, name, 'method');
    entities.push({ id, kind: 'method', name, file: filePath, startLine: range.startLine, endLine: range.endLine, signature: sig, language: 'ts' });
    for (let i = 0; i < node.childCount; i++) collectEntitiesAndEdges(node.child(i), source, filePath, entities, edges, id);
    return;
  }
  if (type === 'call_expression' && currentEntityId) {
    const callee = getCallName(node, source);
    if (callee) edges.push({ type: 'calls', from: currentEntityId, toName: callee });
  }
  for (let i = 0; i < node.childCount; i++) collectEntitiesAndEdges(node.child(i), source, filePath, entities, edges, currentEntityId);
}

function parseFile(filePath, source) {
  const parser = filePath.endsWith('.tsx') ? parserTSX : parserTS;
  const tree = parser.parse(source);
  const entities = [];
  const edges = [];
  collectEntitiesAndEdges(tree.rootNode, source, filePath, entities, edges, null);
  return { entities, edges };
}

module.exports = { parseFile };
module.exports.language = 'typescript';
module.exports.extensions = ['.ts', '.tsx'];
