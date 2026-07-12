import type { ExtractedField, ExtractUsage, FieldPath } from '@ratchaw/extractkit';

/** A single extracted leaf with its provenance, as sent over the wire. */
export type WireField = ExtractedField<unknown>;

/** A preset extraction schema the playground offers. */
export interface SchemaInfo {
  id: string;
  label: string;
  description: string;
  /** Top-level field names — a quick preview of what the schema pulls out. */
  topLevelFields: string[];
}

/** A model the server can run, resolved from the API keys present in its env. */
export interface ModelInfo {
  id: string;
  label: string;
  provider: string;
}

/** Everything the client needs to render its controls before any extraction. */
export interface ConfigResponse {
  schemas: SchemaInfo[];
  models: ModelInfo[];
  /** Ids the client should select initially; `model` is null when no key is set. */
  defaults: { schema: string; model: string | null };
}

/**
 * An extract result with the Zod generic erased for JSON transport. `data`
 * mirrors the schema; `fields` mirrors it with every leaf replaced by a
 * WireField (extractkit's FieldMap).
 */
export interface SerializedResult {
  data: unknown;
  fields: unknown;
  issues: string[];
  usage: ExtractUsage;
  pages: number;
}

/** What was extracted despite a failed run, so the client can still show it. */
export interface PartialResult {
  data: unknown;
  /** FieldMap of the extracted leaves; missing required fields are absent. */
  fields: unknown;
  usage: ExtractUsage;
}

/** A failed extraction, mapped from an extractkit or provider error. */
export interface ApiError {
  /** Error class name, e.g. "DocumentError" or "MissingRequiredFieldsError". */
  name: string;
  /** extractkit error code when present; null for provider/transport errors. */
  code: string | null;
  message: string;
  /** Set on MissingRequiredFieldsError. */
  missingPaths?: string[];
  /** Set on MissingRequiredFieldsError: the rest of the extraction. */
  partial?: PartialResult;
}

/**
 * SSE payloads streamed from POST /api/extract. Each event's `type` is also its
 * SSE `event:` name. Fields arrive as they complete; then exactly one terminal
 * `result` or `error`.
 */
export type ExtractEvent =
  | { type: 'field'; path: FieldPath; field: WireField }
  | { type: 'result'; result: SerializedResult }
  | { type: 'error'; error: ApiError };
