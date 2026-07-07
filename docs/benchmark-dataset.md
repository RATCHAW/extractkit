# Benchmark dataset — Phase 0 decision record

**Decision:** the v1 benchmark set is **~50 documents: 25 invoices from DocILE + 25 receipts from CORD-v2**, pinned by document ID + checksum and fetched from the canonical hosts at eval time. Documents are never vendored into the repo.

Decided 2026-07-07. Feeds `packages/evals` (Phase 2). The exact pinned ID list is produced during Phase 2 curation and may shift a few documents while staying at ~50.

## Requirements

The benchmark exists to back the core claim — grounded, auditable extraction — with real numbers. That set four hard requirements:

1. **Field-level ground truth** (values), so per-field accuracy is measurable.
2. **Bounding-box ground truth per field**, so provenance can be scored (predicted bbox vs. annotated bbox), not just values. Without this, the auditability wedge is unmeasurable.
3. **Domain match:** real invoices and receipts — the locked v1 scope.
4. **Workable licensing:** running and publishing benchmark results must be clearly fine, and others must be able to reproduce the runs without us redistributing documents.

## Candidates

| Dataset | Domain | Released docs | Field ground truth | Field bboxes | License / access | Verdict |
|---|---|---|---|---|---|---|
| **DocILE** | Real business documents (invoices, orders, etc.) from public sources | 6,680 annotated (+100k synthetic, ~1M unlabeled) | 55 field classes + line items (KILE/LIR tasks) | Yes — bbox + page per field | Research-oriented terms; free token via access-request form; tooling is MIT | **Selected — invoice half** |
| **CORD-v2** | Indonesian shop/restaurant receipts (photos) | 1,000 (800 train / 100 dev / 100 test) | 30 semantic classes in 5 superclasses, line grouping | Yes — quad boxes | CC BY 4.0, official NAVER repo on Hugging Face, ungated | **Selected — receipt half** |
| SROIE (ICDAR 2019) | Malaysian scanned receipts | ~1,000 (626 train / 347 test) | 4 fields only (company, date, address, total) | No — KIE values are not linked to boxes (word boxes exist separately in Tasks 1/2) | No explicit dataset license; portal registration; mirrors of unclear standing | Rejected — can't score grounding, schema too shallow, murky license |
| RVL-CDIP | 16-class grayscale document scans | 400k | None — one document-type label per image | No | Legacy IIT-CDIP terms | Rejected — classification dataset, no extraction ground truth |

RVL-CDIP was listed as a roadmap candidate but is a document-*classification* dataset; it has no field annotations at all, so it cannot evaluate extraction.

## Composition (~50 docs)

- **25 invoices — DocILE annotated set.** Real business documents; curate for invoice-type docs with line items, mixing single- and multi-page layouts and diverse vendors. This is the hard case core targets (PDF, tables, multi-page).
- **25 receipts — CORD-v2 test split** (100 docs; we pin 25). Photographed receipts stress OCR quality: skew, crumple, low contrast. Line items present.
- The selection lives in-repo as **document IDs + content checksums** plus a fetch script: CORD-v2 from Hugging Face directly; DocILE via its downloader with a user-supplied token (e.g. `DOCILE_TOKEN`). Runners without a DocILE token can still run the receipt half.
- `packages/evals` maps each dataset's native labels onto the extractkit demo Zod schemas (invoice, receipt): vendor/merchant, date, currency, totals, tax, line items `{ description, qty, unitPrice, amount }`. The mapping code ships in the harness, so the mapping itself is auditable.

## Metrics this choice enables (Phase 2 sketch)

- **Per-field value accuracy** per model (normalized comparison) — already on the roadmap.
- **Grounding accuracy:** predicted bbox vs. ground-truth bbox overlap. This is the metric no value-only dataset (SROIE) could support, and the reason both selected datasets have field-level boxes.
- **Cost per 1k docs** from tracked token usage — already on the roadmap.
- Candidate, not committed: confidence calibration (reported confidence vs. observed correctness).

## Licensing & redistribution posture

- **CORD-v2** is CC BY 4.0 — redistribution with attribution would be allowed, but we still don't vendor images; the repo stores IDs, checksums, and mapping code only. Attribution to NAVER CLOVA goes on the benchmark page.
- **DocILE** sits behind a free access-request token under research-oriented terms. We never redistribute its documents or annotations; each benchmark runner requests their own token. What we publish is per-field accuracy numbers — standard benchmark practice, and DocILE itself operates a public leaderboard.
- If a host disappears, the pinned IDs + checksums still document exactly what every published number was computed on.

## Caveats (state these on the benchmark page)

- **Training contamination:** both datasets are public and widely cited; frontier models have likely seen them. The benchmark is a *comparative* measurement across models/pipelines under identical conditions, not an absolute capability claim.
- **Locale skew:** CORD receipts are Indonesian (Latin script). Fine for v1 scope; noted so the numbers aren't read as universal.
- **Manual step:** DocILE token acquisition (form at docile.rossum.ai) must happen before Phase 2 data work starts.

## Sources

- CORD repo + license: https://github.com/clovaai/cord
- CORD-v2 hosting/splits: https://huggingface.co/datasets/naver-clova-ix/cord-v2
- DocILE benchmark repo: https://github.com/rossumai/docile
- DocILE dataset access + composition: https://docile.rossum.ai/
- DocILE benchmark paper (55 classes, 6.7k annotated): https://arxiv.org/abs/2302.05658
- SROIE challenge: https://rrc.cvc.uab.es/?ch=13 and https://arxiv.org/abs/2103.10213
- RVL-CDIP: https://huggingface.co/datasets/aharley/rvl_cdip
