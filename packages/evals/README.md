# @extractkit/evals

The extractkit benchmark harness: per-field value accuracy, grounding accuracy (predicted vs. annotated bounding box), and cost per 1k documents, measured on ~50 pinned public documents — 25 receipts from [CORD-v2](https://huggingface.co/datasets/naver-clova-ix/cord-v2) (NAVER CLOVA, CC BY 4.0) and 25 invoices from [DocILE](https://docile.rossum.ai/) (Rossum). Dataset rationale: [docs/benchmark-dataset.md](../../docs/benchmark-dataset.md).

Documents are never vendored. [`data/manifest.json`](./data/manifest.json) pins each document by id + SHA-256, and the fetch script pulls them from their canonical hosts and verifies every checksum, so every published number is reproducible on exactly the same bytes.

## Reproducing the benchmark

```sh
pnpm install && pnpm build          # from the repo root; evals imports core's build

cd packages/evals
pnpm fetch-data                     # CORD parquet (~230 MB) into .data/, checksum-verified
                                    # set DOCILE_TOKEN to also fetch the DocILE invoice half
export ANTHROPIC_API_KEY=...        # and/or OPENAI_API_KEY / GOOGLE_GENERATIVE_AI_API_KEY
pnpm run-eval                       # extract every pinned doc with every model → results/run-<ts>.json
pnpm report [results/run-....json]  # regenerate docs/benchmark.md + the README table
```

Without `DOCILE_TOKEN` the receipt half still runs; the invoice half needs a free token from [docile.rossum.ai](https://docile.rossum.ai/) (DocILE terms prohibit redistributing the documents, so every runner requests their own).

### Choosing providers

The lineup (`src/models.ts`) spans three providers — **Anthropic**, **OpenAI**, and **Google Gemini** — with three vision-capable tiers each and their public list pricing:

| Provider | Key | Models |
| --- | --- | --- |
| Anthropic | `ANTHROPIC_API_KEY` | `claude-opus-4-8`, `claude-sonnet-5`, `claude-haiku-4-5` |
| OpenAI | `OPENAI_API_KEY` | `gpt-5.6-sol`, `gpt-5.6-luna`, `gpt-5.4-mini` |
| Google | `GOOGLE_GENERATIVE_AI_API_KEY` | `gemini-3.5-flash`, `gemini-2.5-pro`, `gemini-2.5-flash`, `gemini-2.5-flash-lite` |

By default the run includes every provider whose API key is set, so exporting only `OPENAI_API_KEY` benchmarks OpenAI alone — a cheaper way to iterate than the full Anthropic lineup. Pin the selection explicitly with `EVAL_PROVIDERS` (comma-separated, e.g. `EVAL_PROVIDERS=openai,google`); each named provider must have its key set.

To run a single model instead of a provider's whole lineup, set `EVAL_MODELS` to a comma-separated list of model names (e.g. `EVAL_MODELS=gemini-3.5-flash pnpm run-eval`). Each named model must belong to a provider whose key is set; unknown or unkeyed model names fail fast.

`pnpm pin` re-runs curation and rewrites the manifest — only needed when changing the selection, not to reproduce a run.

## How scoring works

- **Ground truth mapping** (`src/datasets/`): each dataset's native labels are mapped onto the demo Zod schemas in `src/schemas.ts` (receipt ← CORD `gt_parse` + `valid_line`; invoice ← DocILE KILE/LIR fieldtypes). Documents whose annotations can't be mapped confidently are rejected at pin time (`CordMappingError` / `DocileMappingError`) rather than silently mis-scored; the mapping code is in-repo so it can be audited.
- **Value accuracy**: normalized comparison per field kind — whitespace/case for text, digits-and-sign for amounts ("24,000" ≡ "24.000" ≡ "24000"), lenient numeric parse for quantities ("2.00" ≡ "2"). A field the document doesn't carry counts as correct only when the model returns null. Line items align by printed order; extra predicted items are reported separately as hallucinations.
- **Grounding**: among fields with a correct value and an annotated region, best IoU between the predicted bbox and any acceptable ground-truth region on that page; hit@0.5 is the headline number, missing bbox or wrong page scores 0.
- **Cost**: measured token usage priced at the per-MTok list prices in `src/models.ts`.

Raw per-field results for every run are serialized to `results/`, and reports are generated only from those records — no hand-entered numbers.
