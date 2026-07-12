# CLAUDE.md

extractkit is an open-source TypeScript document-extraction engine: Zod schema + PDF/image in → schema-validated JSON out, where every field carries provenance (page + bounding box) and a confidence score. The wedge is **auditability**: grounded extraction plus a public eval benchmark. "Extraction you can audit."

## Current Phase

**Phase 3 (playground) shipped against mock models; the first live provider run is the remaining gate across evals + playground.** `packages/core`, the `packages/evals` harness, and `apps/playground` are all implemented and tested against mock models. The 25 CORD-v2 receipts are pinned in `packages/evals/data/manifest.json`; the 25 DocILE invoices are blocked on the dataset token (ROADMAP Phase 0, pending human action) — loader and curation script are ready. The eval lineup spans Anthropic, OpenAI, and Google Gemini (`packages/evals/src/models.ts`); a run includes every provider whose API key is set, or the subset named in `EVAL_PROVIDERS`. The playground (`apps/playground`) is a Hono API + Vite/React client: `GET /api/config`, `POST /api/extract` streamed as SSE via core's `streamExtract`, preset invoice/receipt schemas defined server-side, and a model registry resolved from whichever provider keys are present. It needs the same provider keys to run live, and its model registry is injectable so the routes test against a mock model. The first live run (any one of `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GOOGLE_GENERATIVE_AI_API_KEY`) doubles as core's first live-provider validation, fills the benchmark page + README table via `pnpm report`, and enables capturing the playground demo GIF. Keep README/ROADMAP/docs in sync with what actually ships.

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
