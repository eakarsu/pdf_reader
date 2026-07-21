# Security policy

## Supported version

Only the current `main` branch is supported. Report suspected vulnerabilities privately to the
repository owner; do not include document contents, credentials, or exploit details in a public
issue.

## Deliberate trust boundary

The application is a static, single-user browser tool. It reads a selected PDF into memory,
extracts selectable text with PDF.js, validates the output, and optionally downloads JSON. It has
no application server, accounts, database, analytics, object storage, AI provider, or outbound API
integration. It therefore does not claim tenant isolation, durable retention, legal hold, signed
sharing, deletion propagation, or server-side malware scanning.

There is no redaction workflow. Downloaded JSON includes all extracted selectable text, so users
must review the artifact before sharing it outside the trust boundary.

Documents with active content are not executed: PDF.js evaluation is disabled, the production
server emits a restrictive content security policy, and extracted strings are rendered as text by
React. Files are constrained to 25 MiB and 100 pages. Password-protected documents are rejected;
pages without selectable text are marked `needs_ocr` rather than sent to an external service.

## Secrets

No credential is required. Build-time `VITE_*` variables are public browser data and must never
contain a secret. A live-looking OpenRouter key existed in repository history before the local-only
boundary was implemented. The key must be revoked by its owner, and the history must be purged in a
coordinated maintenance window before this repository is made public or forked. Removing it from the
current tree does not invalidate it or erase earlier commits.

## Release checks

Before deployment:

1. Confirm the historical credential has been revoked and coordinate any history rewrite.
2. Run `npm ci --ignore-scripts`, `npm run check`, and `npm run security:audit`.
3. Review dependency changes and the generated lockfile.
4. Serve the static build over HTTPS with the headers implemented by `server.mjs` (or equivalents).
5. Do not add upload, OCR, AI, persistence, or multi-user features without a new threat model.
