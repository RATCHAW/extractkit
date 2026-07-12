# extractkit playground

The hosted demo for [extractkit](../../packages/core): drop in a PDF or image, watch fields
stream in as they extract, and **hover any field to highlight the exact region it came from** on the
page. A Vite + React client talks to a small Hono API that runs `extractkit` against a live model.

## Run it

From the repo root (the core library must be built once so the server can import it):

```sh
pnpm install
pnpm --filter @ratchaw/extractkit build
```

Set at least one provider key — copy `.env.example` to `.env` and fill one in, or export it:

```sh
# .env  (git-ignored)
ANTHROPIC_API_KEY=sk-ant-...
# or OPENAI_API_KEY=... / GOOGLE_GENERATIVE_AI_API_KEY=...
```

Then, from `apps/playground`:

```sh
pnpm dev      # Hono API on :8787 + Vite client on :5173 (open this)
```

The client offers whichever models have a key set. With no key, the UI loads but extraction is
disabled and tells you which variable to set.

### Production preview

```sh
pnpm build    # bundles the client to dist/client
pnpm start    # Hono serves the API and the built client on :8787
```

## How it works

- **`src/server`** — a Hono app (`app.ts`) with two routes:
  - `GET /api/config` — the preset schemas and the models available in this environment.
  - `POST /api/extract` — a multipart upload streamed back as Server-Sent Events. It calls
    `streamExtract` from core and forwards each field as it completes, then a final `result` or a
    typed `error`. The model registry is injected, so tests exercise the routes against a mock model
    with no API key.
- **`src/client`** — the React app. `DocumentViewer` renders images directly and PDFs via `pdfjs`,
  overlaying each field's bounding box (normalized 0–1 coordinates from core) on the page.
  `ResultPanel` shows fields streaming in, then the validated tree with per-field confidence, token
  usage, and cost.
- **`src/shared`** — the DTOs both sides share.

Schemas are fixed presets (invoice, receipt) defined server-side — the playground does not accept
arbitrary schemas from the browser.

## Test & typecheck

```sh
pnpm test        # server routes (mock model) + client logic (SSE, geometry, fields, upload)
pnpm typecheck   # client (DOM) and server (node) tsconfigs
```
