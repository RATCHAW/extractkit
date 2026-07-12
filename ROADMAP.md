# Roadmap

## Phase 0 — Pre-flight

- [x] Benchmark dataset chosen: **25 DocILE invoices + 25 CORD-v2 receipts**, pinned by doc ID + checksum, fetched from canonical hosts (never vendored). Decision record: [docs/benchmark-dataset.md](./docs/benchmark-dataset.md)
- [ ] Request DocILE access token at [docile.rossum.ai](https://docile.rossum.ai/) — human action; blocks the Phase 2 data pull (CORD half is ungated)

## Phase 1 — Core library (`packages/core`)

- [x] Zod schema → PDF/image → validated JSON with per-field `{ value, confidence, page, bbox }`
- [x] Provider-agnostic model layer (Vercel AI SDK v7; models passed in, no provider coupling)
- [x] OCR-failure handling, retries, streaming, cost tracking
- [x] Vitest suite covering the failure paths, not just happy path (53 tests, mock models)

Tested against mock models only so far; first live-provider validation happens when Phase 2 eval runs stand up.

## Phase 2 — Evals (`packages/evals`)

- [x] Harness: accuracy per field per model, grounding accuracy (predicted vs. ground-truth bbox), cost per 1k docs — tested against mock models; report generation from recorded runs
- [x] Receipt half pinned: 25 CORD-v2 test docs curated by mapping-consistency checks, pinned by id + SHA-256 in `packages/evals/data/manifest.json`
- [ ] Invoice half pinned: blocked on the DocILE token (Phase 0 human action); curation script is ready
- [ ] First live eval run (needs a provider key — `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, and/or `GOOGLE_GENERATIVE_AI_API_KEY`) → benchmark page generated from real runs (engineering target: >90% field accuracy on the invoice set)
- [ ] Benchmark table in README (markers in place; filled by `pnpm report` from a recorded run)

## Phase 3 — Playground (`apps/playground`)

- [x] Hono API + Vite/React client — `GET /api/config`, `POST /api/extract` streamed as SSE; routes tested against a mock model
- [x] Drag-drop extraction with hover-field → highlight-source-bbox interaction (images + PDFs via pdfjs)
- [ ] Demo GIF for the README (needs one live run — same provider key as the Phase 2 first run)

## Phase 4 — Release

- [ ] README final: pitch, benchmark table, demo GIF, quickstart
- [ ] MIT license
- [ ] Publish `extractkit` to npm

## Non-goals for v1

Auth, billing, hosted multi-tenant service, fine-tuning, non-TypeScript SDKs.
