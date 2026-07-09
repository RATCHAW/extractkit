import type { BBox, Pricing, SupportedMediaType } from 'extractkit';
import type { LanguageModel } from 'ai';

export type DatasetId = 'cord' | 'docile';
export type SchemaId = 'receipt' | 'invoice';

/**
 * How a field's predicted value is compared to ground truth:
 * - `text`: Unicode-normalized, case-folded, whitespace-collapsed equality.
 * - `money`: digits-and-sign equality, ignoring currency symbols and
 *   separators ("24,000" ≡ "24.000" ≡ "24000"). Robust to locale-ambiguous
 *   thousands separators on the benchmark receipts.
 * - `count`: lenient numeric parse ("2.00" ≡ "2", "1X" ≡ "1").
 */
export type CompareKind = 'text' | 'money' | 'count';

/** One annotated occurrence of a value: 0-based page + normalized (0–1) box. */
export interface GroundTruthRegion {
  page: number;
  bbox: BBox;
}

/** One expected leaf value for a document. `value: null` means the schema
 * field exists but the document does not carry it. */
export interface GroundTruthField {
  /** Dot path into the extraction schema, e.g. `lineItems.0.description`. */
  path: string;
  value: string | null;
  /** Other acceptable renderings when the value is printed more than once
   * with different text (e.g. two date formats). */
  altValues?: string[];
  compare: CompareKind;
  /** Every annotated region carrying the value; a predicted bbox is scored
   * against its best match. Empty when `value` is null or no box exists. */
  regions: GroundTruthRegion[];
}

export interface EvalDocument {
  /** Stable benchmark id, e.g. `cord/test/17`. */
  id: string;
  dataset: DatasetId;
  schema: SchemaId;
  bytes: Uint8Array;
  mediaType: SupportedMediaType;
  pages: number;
  fields: GroundTruthField[];
  /** Ground-truth line-item count, used to detect hallucinated items. */
  lineItemCount: number;
}

export interface EvalModel {
  /** Display name used in reports, e.g. `claude-sonnet-5`. */
  name: string;
  model: LanguageModel;
  pricing?: Pricing;
}

/** Per-field outcome of one extraction. */
export interface FieldResult {
  path: string;
  compare: CompareKind;
  expected: string | null;
  /** Predicted leaf value rendered to a string; null for extracted-null. */
  predicted: string | null;
  valueCorrect: boolean;
  /**
   * Grounding score: best IoU between the predicted bbox and the
   * ground-truth regions on the predicted page. 0 when the model gave no
   * bbox or the wrong page; null when not scoreable (value wrong, or no
   * ground-truth region for this field).
   */
  iou: number | null;
  predictedPage: number | null;
}

export interface DocResult {
  docId: string;
  dataset: DatasetId;
  schema: SchemaId;
  /**
   * Set when extraction threw. Fields are still scored against the partial
   * extraction when the error carried one (missing required fields);
   * otherwise every field counts as incorrect.
   */
  error: string | null;
  fields: FieldResult[];
  /** Predicted line items beyond the ground-truth count. */
  extraLineItems: number;
  usage: {
    inputTokens: number;
    outputTokens: number;
    modelCalls: number;
    costUSD: number | null;
  } | null;
}

export interface ModelRun {
  model: string;
  docs: DocResult[];
}

/** A completed benchmark run, serialized to results/<timestamp>.json. */
export interface RunRecord {
  startedAt: string;
  manifestChecksum: string;
  runs: ModelRun[];
}
