---
id: cross-platform-ci-and-release-hygiene-guard
title: "Cross-Platform Path, Binary-Safe Leak Scan & Release Tarball Allowlist Guard"
l0_summary: "Cross-OS config/CI pipelines -> host path checks, binary grep & !files globs break CI -> use OS-neutral path checks, grep -I & allowlists."
scope_glob: "{src/cli,scripts,.github/workflows}/**/*"
core: false
priority: 50
tokens: 460
origin: "evolved"
confidence: "high"
contrastive_evidence: "Before: POSIX path.isAbsolute missed C:/ _npx paths on Linux CI, grep -rnE matched binary PNG bytes in public/ and broke Pages CI, !negation in package.json#files had undefined npm behavior, and pre-refresh asset renders froze stale memory counts. After: OS-neutral drive prefix check + -rnIE binary-safe grep + positive files allowlist + refresh-before-render passed 329/329 tests and 0 leak/audit violations."
transfer_scenarios: ["Validating serialized Windows or POSIX executable paths inside cross-platform CLI doctor and config migration tools running on Linux CI runners.","Running automated regex secret/path leak gates and npm tarball allowlist checks over static site outputs containing rendered PNG/WebP screenshots."]
review_status: "pending"
created_at: "2026-11-11T07:53:24.313Z"
updated_at: "2026-11-11T07:53:24.313Z"
---

When implementing cross-platform CLI diagnostics, static web/documentation exporters, CI leak scanners, or package release manifests:

1. **Cross-OS Path & Shell Wrapper Neutrality**: When inspecting user or harness configuration files that may contain paths authored on another OS, match both POSIX leading slashes and Windows drive-letter prefixes rather than relying solely on the host runtime's native path check; evaluate ephemeral package-runner cache markers before filesystem existence short-circuits; and escape environment-variable sigils inside Windows command-shell wrapper strings so literal percent-delimited tokens cannot expand.
2. **Binary-Safe Leak Gates & Positive Tarball Allowlists**: Exclude binary image/font streams (`-I` or text-MIME filtering) when running regex secret/path leak gates across static site output directories so compressed binary deflate streams never trigger false-positive path matches; define package tarball contents strictly via positive file/subdirectory allowlists rather than unsupported negation patterns.
3. **Post-Edit Refresh Before Snapshot Rendering**: Always execute structural memory anchor refresh after final source modifications and prior to rendering static SVG/PNG/HTML showcase artifacts so embedded health badges never freeze stale intermediate counts.

## 典型反例锚点
Case Anchor: `.evo/memories/s1-s3-workbench-ci-and-anon-parity.md`, `.evo/memories/stage-gate-pages-grep-pack-and-cli-ascii.md` (`src/cli/harness.ts#hasStaleNpxMcpEntry`, `.github/workflows/pages.yml`, `package.json`)
