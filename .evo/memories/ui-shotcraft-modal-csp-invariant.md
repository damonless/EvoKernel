---
id: ui-shotcraft-modal-csp-invariant
title: "Interactive Theater Modal CSP & Constellation Cutout Invariants"
l0_summary: "Interactive Theater Modal CSP & Constellation Cutout Scaling Invariant"
created_commit: "eb1dafc"
created_branch: "main"
target_symbols: ["src/templates/ui-client.ts#renderUiClientHtml","src/cli/score.ts#renderScoreSvg","scripts/render-promo-assets.mjs#findBrowserExecutable"]
ast_fingerprints: {"src/templates/ui-client.ts#renderUiClientHtml":{"symbol":"src/templates/ui-client.ts#renderUiClientHtml","file_path":"src/templates/ui/shell.ts","file":"src/templates/ui/shell.ts","kind":"function","start_line":12,"end_line":301,"signature":"export function renderUiClientHtml(snapshot: any, options: UiRenderOptions = {}): string","ast_hash":"0f374cbbc1e86b11"},"src/cli/score.ts#renderScoreSvg":{"symbol":"src/cli/score.ts#renderScoreSvg","file_path":"src/cli/score.ts","file":"src/cli/score.ts","kind":"function","start_line":1014,"end_line":1143,"signature":"export function renderScoreSvg(report: ScoreReport): string","ast_hash":"31a2124f6b86b44c"},"scripts/render-promo-assets.mjs#findBrowserExecutable":{"symbol":"scripts/render-promo-assets.mjs#findBrowserExecutable","file_path":"scripts/render-promo-assets.mjs","file":"scripts/render-promo-assets.mjs","kind":"function","start_line":26,"end_line":42,"signature":"function findBrowserExecutable()","ast_hash":"c46a20bf576b248a"}}
tags: []
origin: "evolved"
created_at: "2026-11-04T19:20:13.278Z"
updated_at: "2026-11-25T08:58:32.597Z"
---

## Symptom
Exported HTML CSP check or zero-inline-event audit fails, or headless Chromium constellation cutout has large upper empty space.

## Root Cause
Inline event audit regex /\bon[a-z]+\s*=/i matches identifier assignments starting with 'on', and uncentered SVG viewports in headless Chrome cutouts push constellation graphs into bottom half.

## Solution
Use addEventListener without any 'on*' identifiers in script, set exact SHA-256 CSP hashes, and flex-center #constellation-card with scale(1.35) inside 100vh viewport.
