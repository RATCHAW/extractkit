# Roadmap

## Phase 0 — Pre-flight

- [x] Benchmark dataset chosen: **25 DocILE invoices + 25 CORD-v2 receipts**, pinned by doc ID + checksum, fetched from canonical hosts (never vendored). Decision record: [docs/benchmark-dataset.md](./docs/benchmark-dataset.md)
- [ ] Request DocILE access token at [docile.rossum.ai](https://docile.rossum.ai/) — human action; blocks the Phase 2 data pull (CORD half is ungated)

## Phase 1 — Core library (`packages/core`)

- [x] Zod schema → PDF/image → validated JSON with per-field `{ value, confidence, page, bbox }`
- [x] Provider-agnostic model layer (Vercel AI SDK v7; models passed in, no provider coupling)
- [x] OCR-failure handling, retries, streaming, cost tracking
- [x] Vitest suite covering the failure paths, not just happy path (53 tests, mock models)

Live-provider path validated via the playground and the first Phase 2 eval run (OpenAI, 2026-07-12).

## Phase 2 — Evals (`packages/evals`)

- [x] Harness: accuracy per field per model, grounding accuracy (predicted vs. ground-truth bbox), cost per 1k docs — tested against mock models; report generation from recorded runs
- [x] Receipt half pinned: 25 CORD-v2 test docs curated by mapping-consistency checks, pinned by id + SHA-256 in `packages/evals/data/manifest.json`
- [ ] Invoice half pinned: blocked on the DocILE token (Phase 0 human action); curation script is ready
- [x] First live eval runs — OpenAI lineup + Google `gemini-3.5-flash` on the CORD-v2 receipt set (2026-07-12); benchmark page + README table generated from the recorded runs. The Anthropic lineup, the rest of the Gemini tiers, and the DocILE invoice half (>90% field-accuracy engineering target), still to run.
- [x] Benchmark table in README, filled by `pnpm report` from the recorded run

## Phase 3 — Playground (`apps/playground`)

- [x] Hono API + Vite/React client — `GET /api/config`, `POST /api/extract` streamed as SSE; routes tested against a mock model
- [x] Drag-drop extraction with hover-field → highlight-source-bbox interaction (images + PDFs via pdfjs)
- [x] Demo GIF for the README (`docs/demo.gif`, captured from a live playground run)

## Phase 4 — Release

- [x] README final: pitch, benchmark table, demo GIF, quickstart
- [x] MIT license (repo root + shipped in the npm package)
- [ ] Publish `@ratchaw/extractkit` to npm — package is publish-ready (tarball verified: dist + README + LICENSE; scoped, `publishConfig.access: public`); blocked on `npm login`, then `pnpm --filter @ratchaw/extractkit publish` (human action)

## Non-goals for v1

Auth, billing, hosted multi-tenant service, fine-tuning, non-TypeScript SDKs.
