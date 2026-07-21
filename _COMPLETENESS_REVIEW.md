# Completeness Review: pdf_reader

**Review date:** 2026-07-18

## Assessment basis

Static inspection of project-owned source and configuration only; no dependency installation, build, database migration, external-service call, or runtime launch was performed. The scan considered 45 project files (15 source files), 1 manifest(s), 2 test-like file(s), and 0 CI workflow(s), excluding dependency/generated directories.

## Classification

**Functional but incomplete**

This is a substantive but unfinished document/PDF processing application, not just an empty scaffold. Inspection found 15 source files across `src/` using React; however, the checked-in workflow and delivery controls do not yet demonstrate a complete, production-operable product.

## Why it is not complete

- Only 2 test-like file(s) were found, too little evidence for the breadth of the implemented workflow.
- No checked-in CI workflow proves builds, tests, migrations, and security checks on every change.
- No environment template documents required configuration and secret boundaries.
- No clear deployment/container configuration demonstrates a reproducible production topology.

## Needed features

1. Add durable upload, malware/type validation, OCR/conversion jobs, object storage, retries, and lifecycle cleanup.
2. Preserve page-level provenance, version history, redaction boundaries, metadata, and deterministic output validation.
3. Implement tenant isolation, signed access, retention/legal hold, export, and deletion propagation.
4. Test encrypted, malformed, oversized, multilingual, scanned, and partially processed documents.
5. Add risk-based unit, integration, and end-to-end tests in CI, including migration and failure-path coverage.

## Risks or launch blockers

- AI-provider availability, cost, privacy, prompt injection, and unvalidated output are launch risks until bounded and evaluated.
- No CI evidence prevents broken or insecure changes from reaching a release.

## Evidence inspected

- `README.md`
- `src/components/CabinetViewer.js:69`
- `src/._App.js`
- `src/._App.test.js`
- `package.json`

## Recommended next action

Choose one real document/PDF processing journey, define acceptance criteria and external contracts, then close its persistence, permission, integration, failure, and test gaps before expanding features.

## Implementation progress — 2026-07-20

**Result:** Complete for the retained local-only PDF-to-JSON scope. The repository is intentionally
not represented as a durable, multi-user document platform.

### Retained boundary and implementation

- Replaced the browser-side OpenRouter/page-image workflow with same-origin, in-browser PDF.js text
  extraction. The current application has no API key, AI provider, upload, backend, account, cookie,
  analytics, database, or object-storage integration.
- Added `%PDF-` signature and MIME checks, a 25 MiB limit, a 100-page limit, SHA-256 document IDs,
  PDF JavaScript evaluation disablement, bounded metadata, page dimensions, page-level source
  provenance, explicit `extracted`/`needs_ocr`/`failed` states, cancellation, worker cleanup, and
  relational output validation before JSON export.
- Defined the versioned consumer contract in `schema/pdf-reader-output.schema.json`. The README and
  security policy explicitly exclude OCR, redaction, malware scanning, tenant isolation, signed
  sharing, durable versioning, retention/legal hold, and deletion propagation from this static
  boundary; adding any of them requires a new backend architecture and threat model.
- Added failure-path and UI tests, including a real PDF.js parser integration fixture, plus
  multilingual text, scanned page, partial page failure, malformed/type/signature, encrypted,
  oversized/page-limit, cancellation, cleanup, deterministic validation, and download coverage.
- Replaced Create React App with pinned React/Vite/PDF.js dependencies, regenerated the lockfile,
  removed the exposed third-party integration from the current tree, documented the no-secret
  environment boundary, and added current-tree secret scanning.
- Added least-privilege GitHub Actions checks, build artifact retention, a non-root multi-stage
  container, a health endpoint, immutable asset caching, restrictive browser security headers, and
  a container smoke job.

### Verification evidence

- Collision protocol: `main` matched `origin/main`; the inherited untracked review was preserved;
  no recent non-generated project writes or repository writer were found; two pre-edit project
  digests matched at `15ba8ced098d685b84fb424375ed438d78250fd0c071f51d365a3a0deb52c40e`.
- `npm ci --ignore-scripts`: 172 packages installed and 173 audited with zero vulnerabilities.
- `npm run check`: current-tree secret scan passed; schema identity check passed; 3 test files and
  17 tests passed; coverage was 89.61% statements, 84.11% branches, 94.11% functions, and 93.29%
  lines; Vite 8.1.5 produced the production build.
- `npm run security:audit`: zero vulnerabilities across production and development dependencies.
- Gitleaks 8.30.1: `gitleaks dir . --redact` found no current-tree leak. The history scan correctly
  remains non-zero with 6 redacted findings across 3 commits; the findings span the old
  `package.json` and removed CabinetViewer components.
- Production HTTP smoke: `/healthz` and `/` returned 200, required CSP/nosniff/frame headers were
  present, a missing asset returned 404, and POST returned 405. Node syntax checks and YAML parsing
  passed. The pinned `node:24.1.0-alpine` registry manifest exists.
- Two post-implementation project digests matched at
  `99622d8f76353d2d7774532629657621a6352befb07d23a98a5b9391a50c8cff` (generated directories and
  this review excluded).

### Residual blockers and evidence gaps

1. A live-looking credential remains in Git history. Its owner must revoke it, and maintainers must
   coordinate a history purge before public release or forking. No destructive history rewrite was
   performed here.
2. The Docker base-image manifest resolved, but the local image could not be built because the
   configured Docker/Colima daemon socket was unavailable. The checked-in CI smoke job is the
   reproducible container gate, but it has not run against these uncommitted changes.
3. The in-app browser runtime exposed zero browser instances, so an additional interactive visual
   pass could not run here. Component/UI tests and the production HTTP smoke passed; manual browser
   acceptance remains advisable before release.
4. No deployment, external write, commit, push, or history rewrite was performed.

## Runtime and login acceptance — 2026-07-20

- **Status:** BLOCKED
- **Startup safety:** the new root `start.sh` launches only the checked-in production static server, requires an existing dependency tree and `dist` build, and performs no install, build, upload, data mutation, or process killing.
- **Startup:** `./start.sh` launched without error on isolated port `5830`; `/` and `/healthz` both returned `200`.
- **Readiness:** `/healthz` returned `200` with the production build available.
- **Login:** N/A; this local-only browser utility has no accounts, cookies, backend, or authentication surface.
- **Primary journey:** the existing component/integration tests cover PDF validation, extraction, failure isolation, cleanup, schema validation, and deterministic export; a new interactive file-selection pass could not run because no browser backend was available.
- **Browser/server evidence:** production HTTP and security-header smoke exists, but current interactive browser evidence remains unavailable.
- **Cleanup:** the listener was stopped; the application persists no server-side data.
- **Residual issue:** rerun one representative PDF extraction/export in an available browser to close the remaining browser-only gate.
