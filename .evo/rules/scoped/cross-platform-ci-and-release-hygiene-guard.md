---
id: cross-platform-ci-and-release-hygiene-guard
title: "Cross-Platform Path, Binary-Safe Leak Scan & Release Publish Idempotency Guard"
l0_summary: "Cross-OS/CI pipelines -> host paths, binary grep & bare lookup exit codes break releases -> use OS-neutral checks, -I & stdout match."
scope_glob: "{src/cli,scripts,.github/workflows}/**/*"
core: false
priority: 50
tokens: 596
origin: "evolved"
supersedes_id: "cross-platform-ci-and-release-hygiene-guard"
confidence: "high"
contrastive_evidence: "Before fix: `if npm view \"evo-kernel@$PKG_VERSION\" version >/dev/null 2>&1` in publish.yml exited 0 in 3s on v0.4.0 with empty stdout and silently skipped npm publish (`https://registry.npmjs.org/evo-kernel/0.4.0` returned 404). After fix: `PUBLISHED_VER=\"$(npm view ... | tr -d '[:space:]' || true)\"` checks `[ -n \"$PKG_VERSION\" ] && [ \"$PUBLISHED_VER\" = \"$PKG_VERSION\" ]`, guarded by regression assertions in `src/tests/score-and-ui.test.ts`."
transfer_scenarios: ["Pre-publish idempotency checks in GitHub Actions release workflows across npm, PyPI, or container registries","Cross-platform CLI diagnostic probes and static showcase exporters executed across Windows and POSIX runners"]
review_status: "pending"
created_at: "2026-11-11T07:53:24.313Z"
updated_at: "2026-11-14T17:57:58.729Z"
---

When implementing cross-platform CLI diagnostics, static web/documentation exporters, CI leak scanners, or package publish workflows:

1. **Cross-OS Path & Shell Wrapper Neutrality**: When inspecting user or harness configuration files that may contain paths authored on another OS, match both POSIX leading slashes and Windows drive-letter prefixes rather than relying solely on the host runtime's native path check; evaluate ephemeral package-runner cache markers before filesystem existence short-circuits; and escape environment-variable sigils inside Windows command-shell wrapper strings so literal percent-delimited tokens cannot expand.
2. **Binary-Safe Leak Gates & Positive Tarball Allowlists**: Exclude binary image/font streams when running regex secret/path leak gates across static site output directories so compressed binary deflate streams never trigger false-positive path matches; define package tarball contents strictly via positive file/subdirectory allowlists rather than unsupported negation patterns.
3. **Post-Edit Refresh Before Snapshot Rendering**: Always execute structural memory anchor refresh after final source modifications and prior to rendering static showcase artifacts so embedded health badges never freeze stale intermediate counts.
4. **StdOut-Verified Publish Idempotency & Live Registry Verification**: Never skip package publishing based solely on a zero exit code from a registry lookup CLI command—existing packages with an unpublished target version can return exit code zero with empty output and silently skip release publishing while reporting CI success. Assert exact trimmed stdout equality against the target version before skipping idempotently, and verify live origin registry artifacts after workflow completion.

## 典型反例锚点
Case Anchor: `.evo/memories/s1-s3-workbench-ci-and-anon-parity.md`, `.evo/memories/stage-gate-pages-grep-pack-and-cli-ascii.md`, `.github/workflows/publish.yml` (`src/cli/harness.ts#hasStaleNpxMcpEntry`, `src/tests/score-and-ui.test.ts`, `.github/workflows/pages.yml`, `package.json`)
