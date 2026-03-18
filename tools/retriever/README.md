# FlowForge retriever

Language-aware code retriever for the Duo flow. Indexes the repo (JS/TS/Python) and retrieves relevant snippets so the agent answers with citations and does not hallucinate.

## Local usage

From repo root:

```bash
cd tools/retriever
npm ci
```

Index (writes `retrieval/index.json`):

```bash
node index.js index --repo . --out ../retrieval
```

Retrieve (writes `retrieval/context.md`, `retrieval/snippets/*.txt`, `retrieval/manifest.json`):

```bash
node index.js retrieve --repo . --index ../retrieval/index.json --query "how does auth work" --out ../retrieval
```

Paths above assume you run from `tools/retriever` with repo root as parent. From repo root you can use `--repo .` and `--out retrieval`.

## In the Duo flow

The flow's `setup_script` runs index then retrieve. The query is set from the user's goal when Duo provides it (e.g. `GOAL`); otherwise a fallback query is used. The agent reads `retrieval/context.md` and `retrieval/snippets/` and must cite (path:startLine-endLine) for every repo claim.
