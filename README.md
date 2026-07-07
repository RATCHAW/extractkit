# extractkit

**Extraction you can audit.** Define a Zod schema, feed it a PDF or image, get back schema-validated JSON where every field carries provenance — the page and bounding box it came from — plus a confidence score.

> **Status: in development.** The core library ([`packages/core`](./packages/core)) is implemented and tested against mock models; the eval benchmark and playground are next. See [ROADMAP.md](./ROADMAP.md).

## Why

TypeScript has structured-output libraries (instructor-js, AI SDK `generateObject`) and document parsers (LiteParse), but nothing that does the full pipeline: **document in → grounded, validated, auditable JSON out** — with a public eval benchmark so the accuracy claims are numbers, not adjectives.

## v1

- **Core library** (`packages/core`, shipped) — Zod schema + PDF/image → validated JSON with per-field `{ value, confidence, page, bbox }`. Provider-agnostic via the Vercel AI SDK. Document validation, typed failure handling, repair retries, streaming, and cost tracking built in. [Usage docs →](./packages/core/README.md)
- **Eval harness** (next) — public benchmark on ~50 real documents (invoices/receipts): field accuracy per model, grounding accuracy, cost per 1k docs.
- **Playground** (planned) — drag-drop a document, watch fields extract; hover a JSON field to highlight its source region on the page.

See [ROADMAP.md](./ROADMAP.md) for the build plan.

## Scope

General-purpose business documents: invoices, receipts, contracts.

## License

[MIT](./LICENSE)
