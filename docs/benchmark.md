# extractkit benchmark

Field-level extraction accuracy, grounding accuracy, and cost, measured on pinned public
documents: receipts from [CORD-v2](https://huggingface.co/datasets/naver-clova-ix/cord-v2)
(NAVER CLOVA, CC BY 4.0) and invoices from [DocILE](https://docile.rossum.ai/) (Rossum).
Documents are pinned by id + checksum in
[`packages/evals/data/manifest.json`](../packages/evals/data/manifest.json) and fetched from
their canonical hosts at eval time — see [`packages/evals`](../packages/evals) to reproduce.

Combines two runs on the same pinned manifest (checksum `3fcd95f11b94`): the OpenAI lineup (2026-07-12T12:17:58Z) and `gemini-3.5-flash` (2026-07-12T17:40:57Z).

**Metrics.** *Field accuracy*: fraction of ground-truth fields whose predicted value matches
under normalized comparison (whitespace/case for text, digits-and-sign for amounts, lenient
numeric parse for quantities); a field the document does not carry counts as correct only when
the model returned null for it. *Grounding hit@0.5*: among fields with a correct value and a
ground-truth region, the fraction where the predicted bounding box overlaps an annotated region
with IoU ≥ 0.5 on the right page; a missing bbox or wrong page scores 0. *Cost / 1k docs*:
measured token usage priced at published per-token rates.

## Receipts — CORD-v2 (photographed shop receipts)

| Model | Docs | Field accuracy | Grounding hit@0.5 | Mean IoU | Cost / 1k docs |
|---|---|---|---|---|---|
| gpt-5.6-sol | 25 | 94.1% | 82.5% | 66.5% | $57.99 |
| gpt-5.6-luna | 25 | 88.0% | 51.8% | 46.8% | $11.91 |
| gpt-5.4-mini | 25 | 84.7% | 0.4% | 1.4% | $4.77 |
| gemini-3.5-flash | 25 (1 failed) | 96.3% | 82.6% | 66.4% | $27.19 |

### Accuracy per field

| Field | gpt-5.6-sol | gpt-5.6-luna | gpt-5.4-mini | gemini-3.5-flash |
|---|---|---|---|---|
| `discount` | 96.0% (25) | 100.0% (25) | 92.0% (25) | 100.0% (25) |
| `lineItems[].amount` | 91.6% (83) | 84.3% (83) | 92.8% (83) | 97.6% (83) |
| `lineItems[].description` | 88.0% (83) | 72.3% (83) | 78.3% (83) | 88.0% (83) |
| `lineItems[].quantity` | 97.6% (83) | 95.2% (83) | 97.6% (83) | 98.8% (83) |
| `lineItems[].unitPrice` | 98.8% (83) | 96.4% (83) | 62.7% (83) | 98.8% (83) |
| `serviceCharge` | 96.0% (25) | 96.0% (25) | 88.0% (25) | 100.0% (25) |
| `subtotal` | 92.0% (25) | 80.0% (25) | 84.0% (25) | 96.0% (25) |
| `tax` | 96.0% (25) | 92.0% (25) | 92.0% (25) | 100.0% (25) |
| `total` | 92.0% (25) | 84.0% (25) | 92.0% (25) | 92.0% (25) |

## Caveats

- Both datasets are public and widely cited; frontier models have likely seen them in training.
  Read these numbers as a comparative measurement across models under identical conditions, not
  an absolute capability claim.
- CORD receipts are Indonesian (Latin script); the numbers are not universal across locales.
- Line items are aligned to ground truth by printed order; a correct item at the wrong position
  scores as wrong.

Receipt data © NAVER CLOVA, [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/), via the
official [cord-v2](https://huggingface.co/datasets/naver-clova-ix/cord-v2) dataset. DocILE
documents are not redistributed; runners fetch them with their own access token.
