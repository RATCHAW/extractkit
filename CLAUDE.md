# CLAUDE.md

extractkit is an open-source TypeScript document-extraction engine: Zod schema + PDF/image in → schema-validated JSON out, where every field carries provenance (page + bounding box) and a confidence score. The wedge is **auditability**: grounded extraction plus a public eval benchmark. "Extraction you can audit."

## Current Phase

**Pre-development — spec and planning only.** This repo intentionally contains no code yet. Do not scaffold packages, configs, or app code unless explicitly asked to start building. Until then, work happens in the md files (spec refinement, roadmap, API design sketches).

## Planned Architecture

pnpm monorepo:

- **`packages/core`** — the library. Input: Zod schema + document (PDF/image). Output: validated JSON with per-field `{ value, confidence, page, bbox }`. Provider-agnostic via Vercel AI SDK. Production plumbing is first-class: OCR-failure handling, retries, streaming, cost tracking.
- **`packages/evals`** — benchmark harness. ~50 real public documents (invoices/receipts), accuracy per field per model, cost per 1k docs. Results publish to a benchmark page and the README table.
- **`apps/playground`** — hosted demo. **Vite** client (React), **Hono** API server. Killer interaction: hover a JSON field → its source bounding box highlights on the document.

## Tech Choices

- TypeScript strict everywhere; Zod for schemas (it's the public API surface).
- Hono for the playground/API backend. Vite for the client. Vitest for tests.
- Vercel AI SDK for model calls — no direct provider SDK coupling in core.
- Skills for Hono, Vite, and Vitest are installed in this repo — use them when working on those layers.

## Hard Constraints

1. **General-purpose business documents only** (invoices, receipts, contracts). Do not add support for other document categories without being explicitly asked.
2. **No invented numbers.** Benchmark results, accuracy claims, and README stats must come from actual eval runs.
3. **v1 scope is locked** to what's in ROADMAP.md: core lib, evals, playground. No auth, no billing, no multi-tenant "platform", no extra providers UI. Push back on scope creep.
4. **Quality over speed.** Typed, tested, boring where possible. No filler comments, no dead code, no placeholder sections.
