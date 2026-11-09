---
id: ui-shotcraft-modal-csp-invariant
title: "Interactive Theater Modal CSP & Constellation Cutout Invariants"
l0_summary: "Interactive Theater Modal CSP & Constellation Cutout Scaling Invariant"
created_commit: "3ad564d"
created_branch: "main"
target_symbols: ["src/templates/ui-client.ts#renderUiClientHtml","src/cli/score.ts#renderScoreSvg","scripts/render-promo-assets.mjs#constCutoutCss"]
ast_fingerprints: {"src/templates/ui-client.ts#renderUiClientHtml":{"symbol":"src/templates/ui-client.ts#renderUiClientHtml","file_path":"src/templates/ui-client.ts","file":"src/templates/ui-client.ts","kind":"function","start_line":7,"end_line":4246,"signature":"export function renderUiClientHtml(snapshot: any, options: UiRenderOptions = {}): string","ast_hash":"de9c5e8612edcdcb"},"src/cli/score.ts#renderScoreSvg":{"symbol":"src/cli/score.ts#renderScoreSvg","file_path":"src/cli/score.ts","file":"src/cli/score.ts","kind":"function","start_line":861,"end_line":989,"signature":"export function renderScoreSvg(report: ScoreReport): string","ast_hash":"836dbfe562cc3329"},"scripts/render-promo-assets.mjs#constCutoutCss":{"symbol":"scripts/render-promo-assets.mjs#constCutoutCss","file_path":"scripts/render-promo-assets.mjs","file":"scripts/render-promo-assets.mjs","kind":"variable","start_line":134,"end_line":189,"signature":"const constCutoutCss = `","ast_hash":"843b93003a643443"}}
tags: []
origin: "evolved"
created_at: "2026-11-04T19:20:13.278Z"
updated_at: "2026-11-09T05:58:23.819Z"
---

## Symptom
Exported HTML CSP check or zero-inline-event audit fails, or headless Chromium constellation cutout has large upper empty space.

## Root Cause
Inline event audit regex /\bon[a-z]+\s*=/i matches identifier assignments starting with 'on', and uncentered SVG viewports in headless Chrome cutouts push constellation graphs into bottom half.

## Solution
Use addEventListener without any 'on*' identifiers in script, set exact SHA-256 CSP hashes, and flex-center #constellation-card with scale(1.35) inside 100vh viewport.
