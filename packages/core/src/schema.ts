import { z } from 'zod';
import { UnsupportedSchemaError } from './errors.js';
import type { BBox, ExtractedField, FieldPath } from './types.js';

/**
 * The wire format is what the model is asked to produce: the user's schema
 * with every leaf replaced by a wrapper carrying the value plus provenance.
 * `confidence` is deliberately the last wrapper key, so a wrapper found in
 * streamed partial JSON can be treated as final once `confidence` appears.
 */
export interface WireLeaf {
  value: unknown;
  page: number | null;
  bbox: number[] | null;
  confidence: number;
}

export interface WireEnvelope {
  readable: boolean;
  issues: string[];
  fields: Record<string, unknown>;
}

interface Modifiers {
  optional: boolean;
  nullable: boolean;
  description: string | undefined;
}

function unwrapModifiers(schema: z.ZodType): { node: z.ZodType; mods: Modifiers } {
  let node = schema;
  const mods: Modifiers = { optional: false, nullable: false, description: schema.description };
  for (;;) {
    if (node instanceof z.ZodOptional) {
      mods.optional = true;
      node = node.unwrap() as z.ZodType;
    } else if (node instanceof z.ZodNullable) {
      mods.nullable = true;
      node = node.unwrap() as z.ZodType;
    } else if (node instanceof z.ZodReadonly) {
      node = node.unwrap() as z.ZodType;
    } else {
      break;
    }
    mods.description ??= node.description;
  }
  return { node, mods };
}

function rejectUnsupported(node: z.ZodType, path: string): void {
  if (node instanceof z.ZodDate) {
    throw new UnsupportedSchemaError(
      path,
      'z.date() is not supported: models return text. Use z.iso.date() or z.iso.datetime() and convert after extraction',
    );
  }
  if (node instanceof z.ZodDefault || node instanceof z.ZodPrefault) {
    throw new UnsupportedSchemaError(
      path,
      'Defaults are not supported: a defaulted value has no document provenance. Make the field optional and apply defaults after extraction',
    );
  }
  if (node instanceof z.ZodPipe) {
    throw new UnsupportedSchemaError(
      path,
      'Transforms and pipes are not supported: a transformed value no longer maps to a document region. Apply transforms after extraction',
    );
  }
  if (node instanceof z.ZodCatch) {
    throw new UnsupportedSchemaError(path, 'z.catch() is not supported: a fallback value has no document provenance');
  }
}

function isLeaf(node: z.ZodType): boolean {
  return (
    node instanceof z.ZodString ||
    node instanceof z.ZodNumber ||
    node instanceof z.ZodBoolean ||
    node instanceof z.ZodEnum ||
    node instanceof z.ZodLiteral
  );
}

function wireLeaf(base: z.ZodType, description: string | undefined): z.ZodType {
  const wrapper = z.object({
    value: base.nullable().describe('The extracted value, or null when absent or illegible.'),
    page: z.number().int().nullable(),
    bbox: z.array(z.number()).length(4).nullable(),
    confidence: z.number(),
  });
  return description == null ? wrapper : wrapper.describe(description);
}

function withMods(wire: z.ZodType, mods: Modifiers): z.ZodType {
  let out = wire;
  if (mods.optional || mods.nullable) out = out.nullable();
  if (mods.description != null) out = out.describe(mods.description);
  return out;
}

function mirror(schema: z.ZodType, path: string): z.ZodType {
  const { node, mods } = unwrapModifiers(schema);
  rejectUnsupported(node, path);

  if (node instanceof z.ZodObject) {
    const shape: Record<string, z.ZodType> = {};
    for (const [key, child] of Object.entries(node.shape)) {
      shape[key] = mirror(child as z.ZodType, `${path}.${key}`);
    }
    return withMods(z.object(shape), mods);
  }
  if (node instanceof z.ZodArray) {
    return withMods(z.array(mirror(node.element as z.ZodType, `${path}[]`)), mods);
  }
  if (isLeaf(node)) {
    return wireLeaf(node, mods.description);
  }
  throw new UnsupportedSchemaError(
    path,
    `Unsupported schema type ${node.constructor.name}. Supported: object, array, string, number, boolean, enum, literal, plus optional/nullable/describe/refine`,
  );
}

/** Builds the response schema sent to the model. Throws before any model call. */
export function buildWireSchema(schema: z.ZodType): z.ZodObject {
  if (!(schema instanceof z.ZodObject)) {
    throw new UnsupportedSchemaError('$', 'Extraction schema root must be z.object(...)');
  }
  return z.object({
    readable: z.boolean().describe('False when the document is blank, unreadable, or not a document.'),
    issues: z
      .array(z.string())
      .describe('Reading problems worth surfacing (blur, cut-off regions, missing pages). Empty array when none.'),
    fields: mirror(schema, '$'),
  });
}

export interface UnwrappedExtraction {
  /** Data in the user's schema shape, ready for schema.parse(). */
  data: unknown;
  /** ExtractedField tree parallel to `data`. */
  fields: unknown;
  /** Provenance corrections made while reading the model output. */
  issues: string[];
  /** Paths of required fields the model reported as not found. */
  missingPaths: string[];
}

interface WalkCtx {
  pages: number;
  issues: string[];
  missingPaths: string[];
}

type NodeResult = { present: true; data: unknown; field: unknown } | { present: false };

const ABSENT: NodeResult = { present: false };

function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n));
}

function readProvenance(wrapper: WireLeaf, path: string, ctx: WalkCtx): ExtractedField<unknown> {
  let confidence = wrapper.confidence;
  if (typeof confidence !== 'number' || Number.isNaN(confidence)) {
    ctx.issues.push(`${path}: invalid confidence; set to 0`);
    confidence = 0;
  } else if (confidence < 0 || confidence > 1) {
    ctx.issues.push(`${path}: confidence ${confidence} outside [0, 1]; clamped`);
    confidence = clamp01(confidence);
  }

  let page = wrapper.page;
  if (page != null && (!Number.isInteger(page) || page < 0 || page >= ctx.pages)) {
    ctx.issues.push(`${path}: reported page ${page} is outside the ${ctx.pages}-page document; provenance dropped`);
    page = null;
  }

  let bbox: BBox | null = null;
  if (wrapper.bbox != null) {
    if (page == null) {
      ctx.issues.push(`${path}: bbox reported without a valid page; bbox dropped`);
    } else {
      const [rx0, ry0, rx1, ry1] = wrapper.bbox;
      if (rx0 == null || ry0 == null || rx1 == null || ry1 == null) {
        ctx.issues.push(`${path}: malformed bbox; dropped`);
      } else {
        const candidate = { x0: clamp01(rx0), y0: clamp01(ry0), x1: clamp01(rx1), y1: clamp01(ry1) };
        if (candidate.x0 < candidate.x1 && candidate.y0 < candidate.y1) {
          bbox = candidate;
        } else {
          ctx.issues.push(`${path}: degenerate bbox [${wrapper.bbox.join(', ')}]; dropped`);
        }
      }
    }
  }

  return { value: wrapper.value, confidence, page, bbox };
}

function missingNode(mods: Modifiers, path: string, ctx: WalkCtx, inArray: boolean, leafConfidence?: number): NodeResult {
  if (mods.nullable) {
    return { present: true, data: null, field: { value: null, confidence: leafConfidence ?? 0, page: null, bbox: null } };
  }
  if (mods.optional) return ABSENT;
  if (inArray) {
    ctx.issues.push(`${path}: array element with a missing required value was dropped`);
    return ABSENT;
  }
  ctx.missingPaths.push(path);
  return ABSENT;
}

function missingContainer(mods: Modifiers, path: string, ctx: WalkCtx, inArray: boolean): NodeResult {
  if (mods.nullable) return { present: true, data: null, field: null };
  if (mods.optional) return ABSENT;
  if (inArray) {
    ctx.issues.push(`${path}: array element with a missing required value was dropped`);
    return ABSENT;
  }
  ctx.missingPaths.push(path);
  return ABSENT;
}

function unwrapNode(schema: z.ZodType, wire: unknown, path: string, ctx: WalkCtx, inArray: boolean): NodeResult {
  const { node, mods } = unwrapModifiers(schema);

  if (node instanceof z.ZodObject) {
    if (wire == null) return missingContainer(mods, path, ctx, inArray);
    const data: Record<string, unknown> = {};
    const field: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(node.shape)) {
      const result = unwrapNode(child as z.ZodType, (wire as Record<string, unknown>)[key], `${path}.${key}`, ctx, false);
      if (result.present) {
        data[key] = result.data;
        field[key] = result.field;
      }
    }
    return { present: true, data, field };
  }

  if (node instanceof z.ZodArray) {
    if (wire == null) return missingContainer(mods, path, ctx, inArray);
    const data: unknown[] = [];
    const field: unknown[] = [];
    (wire as unknown[]).forEach((item, i) => {
      const result = unwrapNode(node.element as z.ZodType, item, `${path}[${i}]`, ctx, true);
      if (result.present) {
        data.push(result.data);
        field.push(result.field);
      }
    });
    return { present: true, data, field };
  }

  const wrapper = wire as WireLeaf | null | undefined;
  if (wrapper == null || wrapper.value == null) {
    return missingNode(mods, path, ctx, inArray, wrapper?.confidence);
  }
  return { present: true, data: wrapper.value, field: readProvenance(wrapper, path, ctx) };
}

/**
 * Converts validated wire output back into the user's schema shape plus a
 * parallel provenance tree, repairing or dropping implausible provenance
 * (out-of-range pages, degenerate bboxes) along the way.
 */
export function unwrapWireOutput(schema: z.ZodObject, wireFields: Record<string, unknown>, pages: number): UnwrappedExtraction {
  const ctx: WalkCtx = { pages, issues: [], missingPaths: [] };
  const result = unwrapNode(schema, wireFields, '$', ctx, false);
  return {
    data: result.present ? result.data : {},
    fields: result.present ? result.field : {},
    issues: ctx.issues,
    missingPaths: ctx.missingPaths,
  };
}

export function formatIssuePath(path: ReadonlyArray<PropertyKey>): string {
  let out = '$';
  for (const segment of path) {
    out += typeof segment === 'number' ? `[${segment}]` : `.${String(segment)}`;
  }
  return out;
}

export function zodIssueSummaries(error: z.ZodError): string[] {
  return error.issues.map((issue) => `${formatIssuePath(issue.path)}: ${issue.message}`);
}

/** True when every validation failure is explained by a model-reported missing field. */
export function isOnlyMissingFields(error: z.ZodError, missingPaths: readonly string[]): boolean {
  if (missingPaths.length === 0) return false;
  const missing = new Set(missingPaths);
  return error.issues.every((issue) => missing.has(formatIssuePath(issue.path)));
}

/**
 * Walks streamed partial wire output and emits every leaf whose wrapper is
 * complete (its `confidence` — the last wrapper key — has arrived) and whose
 * value is present. Used by streamExtract; final validation happens on the
 * complete output.
 */
export function collectCompletedLeaves(
  schema: z.ZodObject,
  partialFields: unknown,
  pages: number,
  emitted: Set<string>,
  emit: (path: FieldPath, field: ExtractedField<unknown>) => void,
): void {
  const ctx: WalkCtx = { pages, issues: [], missingPaths: [] };
  walkPartial(schema, partialFields, [], ctx, emitted, emit);
}

function walkPartial(
  schema: z.ZodType,
  wire: unknown,
  path: FieldPath,
  ctx: WalkCtx,
  emitted: Set<string>,
  emit: (path: FieldPath, field: ExtractedField<unknown>) => void,
): void {
  if (wire == null) return;
  const { node } = unwrapModifiers(schema);

  if (node instanceof z.ZodObject) {
    if (typeof wire !== 'object' || Array.isArray(wire)) return;
    for (const [key, child] of Object.entries(node.shape)) {
      walkPartial(child as z.ZodType, (wire as Record<string, unknown>)[key], [...path, key], ctx, emitted, emit);
    }
    return;
  }
  if (node instanceof z.ZodArray) {
    if (!Array.isArray(wire)) return;
    wire.forEach((item, i) => {
      walkPartial(node.element as z.ZodType, item, [...path, i], ctx, emitted, emit);
    });
    return;
  }

  const wrapper = wire as Partial<WireLeaf>;
  if (wrapper.value == null) return;
  if (wrapper.page === undefined || wrapper.bbox === undefined || typeof wrapper.confidence !== 'number') return;
  if (wrapper.bbox !== null && (!Array.isArray(wrapper.bbox) || wrapper.bbox.length !== 4)) return;

  const key = path.map(String).join(' ');
  if (emitted.has(key)) return;
  emitted.add(key);
  emit(path, readProvenance(wrapper as WireLeaf, formatIssuePath(path), ctx));
}
