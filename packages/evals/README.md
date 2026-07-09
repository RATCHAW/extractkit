# @extractkit/evals

The extractkit benchmark harness: per-field value accuracy, grounding accuracy (predicted vs. annotated bounding box), and cost per 1k documents, measured on ~50 pinned public documents — 25 receipts from [CORD-v2](https://huggingface.co/datasets/naver-clova-ix/cord-v2) (NAVER CLOVA, CC BY 4.0) and 25 invoices from [DocILE](https://docile.rossum.ai/) (Rossum). Dataset rationale: [docs/benchmark-dataset.md](../../docs/benchmark-dataset.md).

Documents are never vendored. [`data/manifest.json`](./data/manifest.json) pins each document by id + SHA-256, and the fetch script pulls them from their canonical hosts and verifies every checksum, so every published number is reproducible on exactly the same bytes.

## Reproducing the benchmark

```sh
pnpm install && pnpm build          # from the repo root; evals imports core's build

cd packages/evals
pnpm fetch-data                     # CORD parquet (~230 MB) into .data/, checksum-verified
                                    # set DOCILE_TOKEN to also fetch the DocILE invoice half
export ANTHROPIC_API_KEY=...        # models under test
pnpm run-eval                       # extract every pinned doc with every model → results/run-<ts>.json
pnpm report [results/run-....json]  # regenerate docs/benchmark.md + the README table
```

Without `DOCILE_TOKEN` the receipt half still runs; the invoice half needs a free token from [docile.rossum.ai](https://docile.rossum.ai/) (DocILE terms prohibit redistributing the documents, so every runner requests their own).

`pnpm pin` re-runs curation and rewrites the manifest — only needed when changing the selection, not to reproduce a run.

## How scoring works

- **Ground truth mapping** (`src/datasets/`): each dataset's native labels are mapped onto the demo Zod schemas in `src/schemas.ts` (receipt ← CORD `gt_parse` + `valid_line`; invoice ← DocILE KILE/LIR fieldtypes). Documents whose annotations can't be mapped confidently are rejected at pin time (`CordMappingError` / `DocileMappingError`) rather than silently mis-scored; the mapping code is in-repo so it can be audited.
- **Value accuracy**: normalized comparison per field kind — whitespace/case for text, digits-and-sign for amounts ("24,000" ≡ "24.000" ≡ "24000"), lenient numeric parse for quantities ("2.00" ≡ "2"). A field the document doesn't carry counts as correct only when the model returns null. Line items align by printed order; extra predicted items are reported separately as hallucinations.
- **Grounding**: among fields with a correct value and an annotated region, best IoU between the predicted bbox and any acceptable ground-truth region on that page; hit@0.5 is the headline number, missing bbox or wrong page scores 0.
- **Cost**: measured token usage priced at the per-MTok list prices in `src/models.ts`.

Raw per-field results for every run are serialized to `results/`, and reports are generated only from those records — no hand-entered numbers.
