# extractkit

**Extraction you can audit.** Define a Zod schema, feed it a PDF or image, get back schema-validated JSON where every field carries provenance — the page and bounding box it came from — plus a confidence score.

> **Status: in development.** The core library ([`packages/core`](./packages/core)), the eval harness ([`packages/evals`](./packages/evals)), and the playground ([`apps/playground`](./apps/playground)) are implemented and tested against mock models. What's left is the first live provider run, which publishes the benchmark table and the demo GIF. See [ROADMAP.md](./ROADMAP.md).

## Why

TypeScript has structured-output libraries (instructor-js, AI SDK `generateObject`) and document parsers (LiteParse), but nothing that does the full pipeline: **document in → grounded, validated, auditable JSON out** — with a public eval benchmark so the accuracy claims are numbers, not adjectives.

## v1

- **Core library** (`packages/core`, shipped) — Zod schema + PDF/image → validated JSON with per-field `{ value, confidence, page, bbox }`. Provider-agnostic via the Vercel AI SDK. Document validation, typed failure handling, repair retries, streaming, and cost tracking built in. [Usage docs →](./packages/core/README.md)
- **Eval harness** (`packages/evals`, harness shipped) — public benchmark on ~50 pinned real documents (CORD-v2 receipts + DocILE invoices): field accuracy per model, grounding accuracy, cost per 1k docs. Fully reproducible — documents pinned by checksum, reports generated only from recorded runs. [Reproduce it →](./packages/evals/README.md)
- **Playground** (`apps/playground`, built) — drag-drop a document, watch fields stream in, hover a field to highlight its source region on the page. Hono API + Vite/React client, running `extractkit` against a live model. [Run it →](./apps/playground/README.md)

See [ROADMAP.md](./ROADMAP.md) for the build plan.

## Benchmark

<!-- benchmark:start -->

*No results published yet — the first live eval run is pending. Numbers will appear here only from recorded runs; see [`packages/evals`](./packages/evals) to reproduce.*

<!-- benchmark:end -->

## Scope

General-purpose business documents: invoices, receipts, contracts.

## License

[MIT](./LICENSE)
