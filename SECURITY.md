# Security Policy

## Zero-Dependency Supply Chain Security

EvoKernel (`evo-kernel`) is engineered with **0 third-party runtime dependencies**, relying exclusively on built-in Node.js (`>= 22.5.0`) modules (`node:sqlite`, `node:module`, `node:crypto`, `node:http`, `node:zlib`). This eliminates transitive npm supply-chain attack vectors.

## Built-In Security Boundaries

- **6-Stage Deterministic Gatekeeper**: Every proposed rule, skill, micro-tool, or memory is scanned for hardcoded secrets, dangerous shell patterns, and unsafe regexes before commit.
- **Local EvoKernel Workbench UI (`evo ui`) Isolation**:
  - Binds strictly to `127.0.0.1` (loopback only).
  - Enforces `Host` header validation and blocks `Sec-Fetch-Site: cross-site` requests (`HTTP 403`).
  - Requires per-session cryptographic `X-Evo-UI-Token` authentication for `/api/snapshot` and `/api/events`.
  - Enforces strict SHA-256 `Content-Security-Policy` (`script-src 'sha256-...'`) on exported HTML reports.
- **Automatic Credential Redaction**: Diagnostic logs and telemetry streams automatically redact 18+ categories of API keys, tokens, PEM private keys, and basic-auth URLs.

## Reporting a Vulnerability

If you discover a security vulnerability, please report it privately via [GitHub Security Advisories](https://github.com/damonless/EvoKernel/security/advisories/new) rather than opening a public issue. We respond to all security reports within 48 hours.
