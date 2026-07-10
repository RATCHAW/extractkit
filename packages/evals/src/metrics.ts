import type { BBox, ExtractedField } from 'extractkit';
import { valuesMatch } from './normalize.js';
import type { DocResult, EvalDocument, FieldResult, GroundTruthField, ModelRun, SchemaId } from './types.js';

export function iou(a: BBox, b: BBox): number {
  const ix = Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0));
  const iy = Math.max(0, Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0));
  const inter = ix * iy;
  const areaA = Math.max(0, a.x1 - a.x0) * Math.max(0, a.y1 - a.y0);
  const areaB = Math.max(0, b.x1 - b.x0) * Math.max(0, b.y1 - b.y0);
  const union = areaA + areaB - inter;
  return union <= 0 ? 0 : inter / union;
}

function isExtractedField(node: unknown): node is ExtractedField<unknown> {
  return (
    typeof node === 'object' &&
    node !== null &&
    'value' in node &&
    'confidence' in node &&
    'page' in node &&
    'bbox' in node
  );
}

/** Walk an extract() FieldMap by dot path; null when the path leads nowhere
 * (e.g. the model returned fewer line items than ground truth has). */
export function leafAt(fields: unknown, path: string): ExtractedField<unknown> | null {
  let node: unknown = fields;
  for (const segment of path.split('.')) {
    if (node === null || typeof node !== 'object') return null;
    node = (node as Record<string, unknown>)[segment];
  }
  return isExtractedField(node) ? node : null;
}

function scoreField(gt: GroundTruthField, leaf: ExtractedField<unknown> | null): FieldResult {
  const predicted = leaf === null || leaf.value === null ? null : String(leaf.value);
  const valueCorrect =
    valuesMatch(gt.value, predicted, gt.compare) ||
    (predicted !== null && (gt.altValues ?? []).some((alt) => valuesMatch(alt, predicted, gt.compare)));

  let iouScore: number | null = null;
  if (valueCorrect && gt.regions.length > 0) {
    const samePage = gt.regions.filter((r) => leaf !== null && r.page === leaf.page);
    iouScore =
      leaf === null || leaf.bbox === null || samePage.length === 0
        ? 0
        : Math.max(...samePage.map((r) => iou(r.bbox, leaf.bbox as BBox)));
  }

  return {
    path: gt.path,
    compare: gt.compare,
    expected: gt.value,
    predicted,
    valueCorrect,
    iou: iouScore,
    predictedPage: leaf?.page ?? null,
  };
}

/** Number of line items the model returned, read from the field map. */
function predictedLineItemCount(fields: unknown): number {
  const items = (fields as Record<string, unknown> | null)?.['lineItems'];
  return Array.isArray(items) ? items.length : 0;
}

/** Score one successful extraction against a document's ground truth. */
export function scoreExtraction(
  doc: EvalDocument,
  extraction: { fields: unknown },
): Pick<DocResult, 'fields' | 'extraLineItems'> {
  return {
    fields: doc.fields.map((gt) => scoreField(gt, leafAt(extraction.fields, gt.path))),
    extraLineItems: Math.max(0, predictedLineItemCount(extraction.fields) - doc.lineItemCount),
  };
}

/** A failed extraction scores every ground-truth field as incorrect. */
export function scoreFailure(doc: EvalDocument): Pick<DocResult, 'fields' | 'extraLineItems'> {
  return {
    fields: doc.fields.map((gt) => ({
      path: gt.path,
      compare: gt.compare,
      expected: gt.value,
      predicted: null,
      valueCorrect: false,
      iou: gt.regions.length > 0 ? 0 : null,
      predictedPage: null,
    })),
    extraLineItems: 0,
  };
}

export interface SchemaSummary {
  docs: number;
  failedDocs: number;
  /** Fraction of ground-truth fields whose predicted value matched. */
  fieldAccuracy: number;
  fieldsScored: number;
  grounding: {
    /** Fields with a correct value and a ground-truth region. */
    scoreable: number;
    meanIoU: number | null;
    /** Fraction of scoreable fields with IoU ≥ 0.5. */
    hitAt50: number | null;
  };
  /** Accuracy per schema field, line items collapsed across indices. */
  perField: Array<{ field: string; accuracy: number; count: number }>;
  extraLineItems: number;
  cost: {
    totalUSD: number | null;
    per1kDocsUSD: number | null;
    inputTokens: number;
    outputTokens: number;
  };
}

export interface ModelSummary {
  model: string;
  perSchema: Partial<Record<SchemaId, SchemaSummary>>;
}

/** Collapse line-item indices: `lineItems.3.amount` → `lineItems[].amount`. */
function fieldKey(path: string): string {
  return path.replace(/\.\d+\./g, '[].');
}

export function summarizeRun(run: ModelRun): ModelSummary {
  const perSchema: Partial<Record<SchemaId, SchemaSummary>> = {};
  const bySchema = new Map<SchemaId, DocResult[]>();
  for (const doc of run.docs) {
    const list = bySchema.get(doc.schema) ?? [];
    list.push(doc);
    bySchema.set(doc.schema, list);
  }

  for (const [schema, docs] of bySchema) {
    const fields = docs.flatMap((d) => d.fields);
    const correct = fields.filter((f) => f.valueCorrect).length;
    const groundable = fields.filter((f) => f.iou !== null);
    const perFieldMap = new Map<string, { correct: number; count: number }>();
    for (const f of fields) {
      const key = fieldKey(f.path);
      const entry = perFieldMap.get(key) ?? { correct: 0, count: 0 };
      entry.count += 1;
      if (f.valueCorrect) entry.correct += 1;
      perFieldMap.set(key, entry);
    }

    const costs = docs.map((d) => d.usage?.costUSD ?? null);
    const totalUSD = costs.every((c) => c === null) ? null : costs.reduce<number>((sum, c) => sum + (c ?? 0), 0);

    perSchema[schema] = {
      docs: docs.length,
      failedDocs: docs.filter((d) => d.error !== null).length,
      fieldAccuracy: fields.length === 0 ? 0 : correct / fields.length,
      fieldsScored: fields.length,
      grounding: {
        scoreable: groundable.length,
        meanIoU:
          groundable.length === 0
            ? null
            : groundable.reduce((sum, f) => sum + (f.iou as number), 0) / groundable.length,
        hitAt50:
          groundable.length === 0 ? null : groundable.filter((f) => (f.iou as number) >= 0.5).length / groundable.length,
      },
      perField: [...perFieldMap.entries()]
        .map(([field, { correct: c, count }]) => ({ field, accuracy: c / count, count }))
        .sort((a, b) => a.field.localeCompare(b.field)),
      extraLineItems: docs.reduce((sum, d) => sum + d.extraLineItems, 0),
      cost: {
        totalUSD,
        per1kDocsUSD: totalUSD === null || docs.length === 0 ? null : (totalUSD / docs.length) * 1000,
        inputTokens: docs.reduce((sum, d) => sum + (d.usage?.inputTokens ?? 0), 0),
        outputTokens: docs.reduce((sum, d) => sum + (d.usage?.outputTokens ?? 0), 0),
      },
    };
  }

  return { model: run.model, perSchema };
}
