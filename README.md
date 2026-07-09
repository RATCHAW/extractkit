# extractkit

**Extraction you can audit.** Define a Zod schema, feed it a PDF or image, get back schema-validated JSON where every field carries provenance — the page and bounding box it came from — plus a confidence score.

> **Status: in development.** The core library ([`packages/core`](./packages/core)) is implemented and tested against mock models; the eval benchmark and playground are next. See [ROADMAP.md](./ROADMAP.md).

## Why

TypeScript has structured-output libraries (instructor-js, AI SDK `generateObject`) and document parsers (LiteParse), but nothing that does the full pipeline: **document in → grounded, validated, auditable JSON out** — with a public eval benchmark so the accuracy claims are numbers, not adjectives.

## v1

- **Core library** (`packages/core`, shipped) — Zod schema + PDF/image → validated JSON with per-field `{ value, confidence, page, bbox }`. Provider-agnostic via the Vercel AI SDK. Document validation, typed failure handling, repair retries, streaming, and cost tracking built in. [Usage docs →](./packages/core/README.md)
- **Eval harness** (`packages/evals`, harness shipped) — public benchmark on ~50 pinned real documents (CORD-v2 receipts + DocILE invoices): field accuracy per model, grounding accuracy, cost per 1k docs. Fully reproducible — documents pinned by checksum, reports generated only from recorded runs. [Reproduce it →](./packages/evals/README.md)
- **Playground** (planned) — drag-drop a document, watch fields extract; hover a JSON field to highlight its source region on the page.

See [ROADMAP.md](./ROADMAP.md) for the build plan.

## Benchmark

<!-- benchmark:start -->

*No results published yet — the first live eval run is pending. Numbers will appear here only from recorded runs; see [`packages/evals`](./packages/evals) to reproduce.*

<!-- benchmark:end -->

## Scope

General-purpose business documents: invoices, receipts, contracts.

## License

[MIT](./LICENSE)
