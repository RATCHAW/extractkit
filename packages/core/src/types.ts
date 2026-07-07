import type { LanguageModel } from 'ai';
import type { z } from 'zod';

/** Bounding box on a page, normalized to page width/height: 0–1, origin top-left. */
export interface BBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** An extracted leaf value together with its provenance. */
export interface ExtractedField<T> {
  value: T;
  /**
   * Model-reported probability (0–1) that `value` is exactly correct.
   * Self-reported and uncalibrated; treat as a ranking signal, not a guarantee.
   */
  confidence: number;
  /** 0-based page index the value was read from; null when the model could not locate it. */
  page: number | null;
  /** Source region of the value on `page`; null when not located. */
  bbox: BBox | null;
}

/**
 * Mirrors the shape of the extracted data with every leaf replaced by its
 * ExtractedField. Optional fields stay optional; fields extracted as null
 * (nullable leaves, nullable objects) stay null.
 */
export type FieldMap<T> = [NonNullable<T>] extends [ReadonlyArray<infer U>]
  ? FieldMap<U>[] | Extract<T, null>
  : [NonNullable<T>] extends [Record<string, unknown>]
    ? { [K in keyof NonNullable<T>]: FieldMap<NonNullable<T>[K]> } | Extract<T, null>
    : ExtractedField<Exclude<T, undefined>>;

export type SupportedMediaType = 'application/pdf' | 'image/png' | 'image/jpeg' | 'image/webp';

export interface DocumentInput {
  /** Raw document bytes, or a base64-encoded string of them. */
  data: Uint8Array | ArrayBuffer | string;
  /**
   * Declared media type. When provided it must match the sniffed file
   * signature; when omitted the type is detected from the bytes.
   */
  mediaType?: SupportedMediaType;
  /** Passed through to providers that use filenames (PDF inputs). */
  filename?: string;
}

export interface NormalizedDocument {
  bytes: Uint8Array;
  mediaType: SupportedMediaType;
  /** Page count read from the PDF itself; always 1 for images. */
  pages: number;
  filename?: string;
}

/** Token prices used to compute `ExtractUsage.costUSD`. */
export interface Pricing {
  /** USD per 1,000,000 input tokens. */
  inputPerMTokUSD: number;
  /** USD per 1,000,000 output tokens. */
  outputPerMTokUSD: number;
}

export interface ExtractUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  /** Model calls made, including repair attempts. */
  modelCalls: number;
  /** Computed when `pricing` was provided; otherwise null. Never estimated. */
  costUSD: number | null;
}

export interface ExtractOptions<S extends z.ZodObject> {
  /**
   * Extraction schema; the root must be z.object(...). Supported field types:
   * object, array, string (incl. string formats), number, boolean, enum,
   * literal, optional, nullable, describe, refine. Transforms, defaults, and
   * catch are rejected because their output no longer maps to a document
   * region.
   */
  schema: S;
  /** Name given to the response schema; some providers use it as guidance. */
  schemaName?: string;
  schemaDescription?: string;
  document: DocumentInput;
  /** Any AI SDK language model, e.g. anthropic('claude-sonnet-5'). */
  model: LanguageModel;
  /** Extra domain instructions appended to the extraction prompt. */
  instructions?: string;
  /** Transport-level retries per model call (handled by the AI SDK). Default 2. */
  maxRetries?: number;
  /**
   * Re-prompts after the model returns invalid output (unparseable JSON or
   * schema violations). Each repair costs one extra model call. Default 1.
   */
  maxRepairAttempts?: number;
  temperature?: number;
  abortSignal?: AbortSignal;
  /** Enables costUSD in the returned usage. */
  pricing?: Pricing;
}

export interface ExtractResult<S extends z.ZodObject> {
  /** The extraction, validated against `schema`. */
  data: z.output<S>;
  /** Provenance for every leaf in `data`. */
  fields: FieldMap<z.output<S>>;
  /**
   * Non-fatal anomalies: reading problems reported by the model plus
   * provenance corrections made during validation (e.g. an out-of-range page
   * reference that was dropped).
   */
  issues: string[];
  usage: ExtractUsage;
  /** Page count of the input document (1 for images). */
  pages: number;
}

export type FieldPath = Array<string | number>;

export interface FieldEvent {
  type: 'field';
  path: FieldPath;
  /**
   * The field as streamed. Field events are emitted before final validation;
   * the result returned by `ExtractStream.result` is authoritative.
   */
  field: ExtractedField<unknown>;
}

export type ExtractStreamEvent = FieldEvent;

export interface ExtractStream<S extends z.ZodObject> extends AsyncIterable<ExtractStreamEvent> {
  /** The final validated result; rejects with the same errors extract() throws. */
  result: Promise<ExtractResult<S>>;
}
