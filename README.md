# extractkit

**Extraction you can audit.** Define a Zod schema, feed it a PDF or image, get back schema-validated JSON where every field carries provenance — the page and bounding box it came from — plus a confidence score.

> **Status: pre-development.** This repo currently holds the project spec and roadmap only. No code yet.

## Why

TypeScript has structured-output libraries (instructor-js, AI SDK `generateObject`) and document parsers (LiteParse), but nothing that does the full pipeline: **document in → grounded, validated, auditable JSON out** — with a public eval benchmark so the accuracy claims are numbers, not adjectives.

## Planned v1

- **Core library** — Zod schema + PDF/image → validated JSON with per-field `{ value, confidence, page, bbox }`. Provider-agnostic via the Vercel AI SDK. OCR-failure handling, retries, streaming, cost tracking built in.
- **Eval harness** — public benchmark on ~50 real documents (invoices/receipts): field accuracy per model, cost per 1k docs.
- **Playground** — drag-drop a document, watch fields extract; hover a JSON field to highlight its source region on the page.

See [ROADMAP.md](./ROADMAP.md) for the build plan.

## Scope

General-purpose business documents: invoices, receipts, contracts.

## License

MIT (to be added with first code).
