import { summarizeRun, type ModelSummary, type SchemaSummary } from './metrics.js';
import type { RunRecord, SchemaId } from './types.js';

const SCHEMA_LABELS: Record<SchemaId, string> = {
  receipt: 'Receipts — CORD-v2 (photographed shop receipts)',
  invoice: 'Invoices — DocILE (real business documents, PDF)',
};

function pct(value: number | null): string {
  return value === null ? '—' : `${(value * 100).toFixed(1)}%`;
}

function usd(value: number | null): string {
  return value === null ? '—' : `$${value.toFixed(2)}`;
}

function mainTable(summaries: ModelSummary[], schema: SchemaId): string | null {
  const rows = summaries
    .map((s) => ({ model: s.model, sum: s.perSchema[schema] }))
    .filter((r): r is { model: string; sum: SchemaSummary } => r.sum !== undefined);
  if (rows.length === 0) return null;
  const lines = [
    '| Model | Docs | Field accuracy | Grounding hit@0.5 | Mean IoU | Cost / 1k docs |',
    '|---|---|---|---|---|---|',
    ...rows.map(
      ({ model, sum }) =>
        `| ${model} | ${sum.docs}${sum.failedDocs > 0 ? ` (${sum.failedDocs} failed)` : ''} | ${pct(
          sum.fieldAccuracy,
        )} | ${pct(sum.grounding.hitAt50)} | ${pct(sum.grounding.meanIoU)} | ${usd(sum.cost.per1kDocsUSD)} |`,
    ),
  ];
  return lines.join('\n');
}

function perFieldTable(summaries: ModelSummary[], schema: SchemaId): string | null {
  const rows = summaries
    .map((s) => ({ model: s.model, sum: s.perSchema[schema] }))
    .filter((r): r is { model: string; sum: SchemaSummary } => r.sum !== undefined);
  if (rows.length === 0) return null;
  const fields = rows[0]?.sum.perField.map((f) => f.field) ?? [];
  const lines = [
    `| Field | ${rows.map((r) => r.model).join(' | ')} |`,
    `|---|${rows.map(() => '---').join('|')}|`,
    ...fields.map((field) => {
      const cells = rows.map(({ sum }) => {
        const entry = sum.perField.find((f) => f.field === field);
        return entry === undefined ? '—' : `${pct(entry.accuracy)} (${entry.count})`;
      });
      return `| \`${field}\` | ${cells.join(' | ')} |`;
    }),
  ];
  return lines.join('\n');
}

/** The summary table embedded in the README, one section per document type. */
export function renderReadmeTable(record: RunRecord): string {
  const summaries = record.runs.map(summarizeRun);
  const sections: string[] = [];
  for (const schema of ['invoice', 'receipt'] as const) {
    const table = mainTable(summaries, schema);
    if (table !== null) sections.push(`**${SCHEMA_LABELS[schema]}**\n\n${table}`);
  }
  return sections.join('\n\n');
}

/** The full benchmark page (docs/benchmark.md). */
export function renderBenchmarkPage(record: RunRecord): string {
  const summaries = record.runs.map(summarizeRun);
  const parts: string[] = [
    '# extractkit benchmark',
    '',
    'Field-level extraction accuracy, grounding accuracy, and cost, measured on pinned public',
    'documents: receipts from [CORD-v2](https://huggingface.co/datasets/naver-clova-ix/cord-v2)',
    '(NAVER CLOVA, CC BY 4.0) and invoices from [DocILE](https://docile.rossum.ai/) (Rossum).',
    'Documents are pinned by id + checksum in',
    '[`packages/evals/data/manifest.json`](../packages/evals/data/manifest.json) and fetched from',
    'their canonical hosts at eval time — see [`packages/evals`](../packages/evals) to reproduce.',
    '',
    `Run started ${record.startedAt}. Manifest checksum \`${record.manifestChecksum.slice(0, 12)}\`.`,
    '',
    '**Metrics.** *Field accuracy*: fraction of ground-truth fields whose predicted value matches',
    'under normalized comparison (whitespace/case for text, digits-and-sign for amounts, lenient',
    'numeric parse for quantities); a field the document does not carry counts as correct only when',
    'the model returned null for it. *Grounding hit@0.5*: among fields with a correct value and a',
    'ground-truth region, the fraction where the predicted bounding box overlaps an annotated region',
    'with IoU ≥ 0.5 on the right page; a missing bbox or wrong page scores 0. *Cost / 1k docs*:',
    'measured token usage priced at published per-token rates.',
    '',
  ];

  for (const schema of ['invoice', 'receipt'] as const) {
    const table = mainTable(summaries, schema);
    if (table === null) continue;
    parts.push(`## ${SCHEMA_LABELS[schema]}`, '', table, '');
    const fieldTable = perFieldTable(summaries, schema);
    if (fieldTable !== null) parts.push('### Accuracy per field', '', fieldTable, '');
    const extras = summaries
      .map((s) => ({ model: s.model, sum: s.perSchema[schema] }))
      .filter((r): r is { model: string; sum: SchemaSummary } => r.sum !== undefined)
      .filter((r) => r.sum.extraLineItems > 0);
    if (extras.length > 0) {
      parts.push(
        'Hallucinated line items (predicted beyond ground truth, not counted in field accuracy): ' +
          extras.map((r) => `${r.model}: ${r.sum.extraLineItems}`).join(', ') +
          '.',
        '',
      );
    }
  }

  parts.push(
    '## Caveats',
    '',
    '- Both datasets are public and widely cited; frontier models have likely seen them in training.',
    '  Read these numbers as a comparative measurement across models under identical conditions, not',
    '  an absolute capability claim.',
    '- CORD receipts are Indonesian (Latin script); the numbers are not universal across locales.',
    '- Line items are aligned to ground truth by printed order; a correct item at the wrong position',
    '  scores as wrong.',
    '',
    'Receipt data © NAVER CLOVA, [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/), via the',
    'official [cord-v2](https://huggingface.co/datasets/naver-clova-ix/cord-v2) dataset. DocILE',
    'documents are not redistributed; runners fetch them with their own access token.',
    '',
  );

  return parts.join('\n');
}
