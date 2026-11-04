# Contributing to EvoKernel

Thank you for your interest in contributing to **EvoKernel**!

## Core Engineering Invariants

1. **Zero Runtime Dependencies**: EvoKernel strictly uses zero external npm `dependencies` (`node:sqlite`, `node:module.stripTypeScriptTypes`, `node:test`, `node:http`, `node:zlib`, `node:crypto`). Do not add third-party runtime packages to `package.json`.
2. **NodeNext ESM Imports**: Always use explicit `.js` extensions on relative imports (`import { EvoStorage } from './storage.js'`) and `import type` for TypeScript interfaces so `node:module.stripTypeScriptTypes` compiles cleanly without external bundlers.
3. **Deterministic Self-Tests**: Every micro-tool under `.evo/tools/` and `templates/seed-evo/tools/` must pass `--self-test` (`EVO_SELF_TEST=1`) with exit code `0` and remain byte-synchronized between `.evo/` and `templates/seed-evo/`.

## Local Development Workflow

```bash
# 1. Requires Node.js >= 22.5.0 (or Node 24+)
node -v

# 2. Build ESM bundle into dist/
npm run build

# 3. Run the full 11-suite test matrix
npm test

# 4. Run release preflight & Gatekeeper audit micro-tools
node ./.evo/tools/evo-release-preflight/run.mjs
node ./.evo/tools/agy-config-auditor/run.mjs

# 5. Refresh AST memory fingerprints if you modified anchored functions
node ./dist/cli/index.js memory refresh
```
