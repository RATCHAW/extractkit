# Roadmap

## Phase 0 — Pre-flight

- [x] Benchmark dataset chosen: **25 DocILE invoices + 25 CORD-v2 receipts**, pinned by doc ID + checksum, fetched from canonical hosts (never vendored). Decision record: [docs/benchmark-dataset.md](./docs/benchmark-dataset.md)
- [ ] Request DocILE access token at [docile.rossum.ai](https://docile.rossum.ai/) — human action; blocks the Phase 2 data pull (CORD half is ungated)

## Phase 1 — Core library (`packages/core`)

- [ ] Zod schema → PDF/image → validated JSON with per-field `{ value, confidence, page, bbox }`
- [ ] Provider-agnostic model layer (Vercel AI SDK)
- [ ] OCR-failure handling, retries, streaming, cost tracking
- [ ] Vitest suite covering the failure paths, not just happy path

## Phase 2 — Evals (`packages/evals`)

- [ ] Harness: accuracy per field per model, grounding accuracy (predicted vs. ground-truth bbox), cost per 1k docs
- [ ] Benchmark page generated from real runs (engineering target: >90% field accuracy on the invoice set)
- [ ] Benchmark table in README

## Phase 3 — Playground (`apps/playground`)

- [ ] Hono API + Vite/React client
- [ ] Drag-drop extraction with hover-field → highlight-source-bbox interaction
- [ ] Demo GIF for the README

## Phase 4 — Release

- [ ] README final: pitch, benchmark table, demo GIF, quickstart
- [ ] MIT license
- [ ] Publish `extractkit` to npm

## Non-goals for v1

Auth, billing, hosted multi-tenant service, fine-tuning, non-TypeScript SDKs.
