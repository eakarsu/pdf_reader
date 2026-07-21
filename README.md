# Local PDF Reader

A deliberately bounded PDF-to-JSON workflow. It extracts selectable text in the browser and never
uploads the source document. This replaces the previous browser-side AI integration, which exposed
credentials and sent full page images to a third party.

## Supported journey

The release contract is intentionally narrow:

- Accept one PDF with a valid `%PDF-` signature, no larger than 25 MiB or 100 pages.
- Compute a SHA-256 content identifier before parsing.
- Extract selectable Unicode text and dimensions for every page in page order.
- Preserve page number and source document ID on every page record.
- Mark image-only pages `needs_ocr`; do not guess, hallucinate, or upload missing content.
- Mark isolated page failures `failed` while retaining explicit provenance for other pages.
- Reject empty, mislabeled, malformed, encrypted, oversized, and over-page-limit documents.
- Validate the output schema and summary counts before offering a deterministic JSON download.
- Release the PDF worker and clear all in-memory results on removal, navigation, or refresh.

For the same file name and bytes, successful extraction emits the same JSON. There is deliberately
no processing timestamp or model-generated content in the artifact.

## Non-goals and privacy boundary

This is a static single-user utility, not a document-management service. It has no backend, upload,
database, object storage, cookies, analytics, accounts, tenants, signed links, OCR, AI provider,
redaction, retention service, legal hold, or deletion queue. Version identity is the content hash;
there is no server-side version history. A downloaded artifact contains all extracted selectable
text and must be reviewed before sharing. Those additional capabilities require a separate backend
architecture and threat model and must not be implied by this UI.

All source bytes and extracted text stay in the current browser tab. The only network requests in
production are for same-origin application assets. PDF JavaScript evaluation is disabled. See
[`SECURITY.md`](SECURITY.md) before changing this boundary.

## JSON contract

The exported schema version is `1.0.0`; the machine-readable contract is
[`schema/pdf-reader-output.schema.json`](schema/pdf-reader-output.schema.json). Its top-level fields
are:

- `document_id`: `sha256:<hex digest>`
- `source`: cleaned file name, canonical media type, byte size, and SHA-256 digest
- `page_count` and conservative PDF metadata
- `summary`: counts for `extracted`, `needs_ocr`, and `failed` pages
- `pages`: ordered records containing page number, document ID, extraction status, character count,
  page dimensions, text, and a non-sensitive error code

Consumers must reject unknown major schema versions and must not treat `needs_ocr` or `failed` pages
as empty source pages.

## Development

Node.js 22.13 or newer is required; CI and the container use Node.js 24.1.0.

```sh
npm ci --ignore-scripts
npm run dev
```

The development server prints its local URL. No `.env` values are required. Any `VITE_*` variable
is bundled into public JavaScript and therefore cannot contain a secret.

## Verification

```sh
npm run test
npm run test:coverage
npm run schema:check
npm run security:secrets
npm run security:audit
npm run build
```

`npm run check` combines the current-tree secret scan, coverage-gated tests, and production build.
Tests cover malformed types/signatures, size/page limits, multilingual text, scanned pages, encrypted
documents, partial page failure, cancellation, cleanup, output validation, UI errors, and download.
CI also builds and probes the production container.

## Production

Build a non-root container and run it on port 8080:

```sh
docker build -t local-pdf-reader:1.0.0 .
docker run --rm -p 8080:8080 local-pdf-reader:1.0.0
curl --fail http://127.0.0.1:8080/healthz
```

The bundled server adds a restrictive content security policy and related browser hardening headers.
If `dist/` is deployed to a different HTTPS static host, configure equivalent headers from
`server.mjs`; a successful Vite build alone does not configure the host.

## Known release blocker

A live-looking OpenRouter credential was committed before this boundary was implemented. It has been
removed from the current source, but it still exists in Git history. The credential owner must revoke
it, and maintainers must coordinate a history purge before making the repository public or allowing
forks. History rewriting is intentionally not automated by this change because it invalidates commit
IDs and requires coordination with every clone.
