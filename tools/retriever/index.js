#!/usr/bin/env node
'use strict';

const { program } = require('commander');
const path = require('path');
const { runIndex } = require('./lib/indexer');
const { runRetrieve } = require('./lib/retriever');

program
  .name('retriever')
  .description('Language-aware code retriever for FlowForge')
  .version('1.0.0');

program
  .command('index')
  .description('Index repo and write retrieval/index.json')
  .requiredOption('--repo <dir>', 'Repo root')
  .requiredOption('--out <dir>', 'Output directory (e.g. retrieval)')
  .action((opts) => {
    const repo = path.resolve(opts.repo);
    const out = path.resolve(opts.out);
    const result = runIndex(repo, out);
    console.log(`Indexed ${result.entityCount} entities, ${result.edgeCount} edges -> ${result.outPath}`);
  });

program
  .command('retrieve')
  .description('Retrieve relevant snippets for a query')
  .requiredOption('--repo <dir>', 'Repo root')
  .requiredOption('--index <file>', 'Path to index.json')
  .requiredOption('--query <string>', 'Query (e.g. user question)')
  .requiredOption('--out <dir>', 'Output directory')
  .action((opts) => {
    const repo = path.resolve(opts.repo);
    const indexPath = path.resolve(opts.index);
    const outDir = path.resolve(opts.out);
    runRetrieve(repo, indexPath, opts.query, outDir);
    console.log(`Retrieval written to ${outDir}`);
  });

program.parse();
