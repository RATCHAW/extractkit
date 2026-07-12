import type { ExtractedField, FieldPath } from 'extractkit';

export type AnyField = ExtractedField<unknown>;

export interface FlatField {
  path: FieldPath;
  field: AnyField;
}

/** A flat field plus its stable key, ready for overlays and list rendering. */
export interface FieldEntry extends FlatField {
  key: string;
}

/** Stable string key for a field path, for map lookups and React keys. */
export function pathKey(path: FieldPath): string {
  return JSON.stringify(path);
}

/** True when `node` is a provenance leaf rather than a nested branch. */
export function isField(node: unknown): node is AnyField {
  if (typeof node !== 'object' || node === null) return false;
  const record = node as Record<string, unknown>;
  return (
    'value' in record &&
    'confidence' in record &&
    'page' in record &&
    'bbox' in record &&
    typeof record['confidence'] === 'number'
  );
}

/** Depth-first list of every provenance leaf under a FieldMap, with its path. */
export function flattenFields(node: unknown, base: FieldPath = []): FlatField[] {
  if (node === null || node === undefined) return [];
  if (isField(node)) return [{ path: base, field: node }];
  if (Array.isArray(node)) return node.flatMap((child, i) => flattenFields(child, [...base, i]));
  if (typeof node === 'object') {
    return Object.entries(node).flatMap(([key, child]) => flattenFields(child, [...base, key]));
  }
  return [];
}

/** Every provenance leaf under a FieldMap, each with its stable key. */
export function fieldEntries(node: unknown): FieldEntry[] {
  return flattenFields(node).map(({ path, field }) => ({ key: pathKey(path), path, field }));
}

/** Reads the plain value at `path` from an extraction's `data`. */
export function valueAtPath(data: unknown, path: FieldPath): unknown {
  let current: unknown = data;
  for (const key of path) {
    if (current === null || current === undefined) return undefined;
    current = (current as Record<string | number, unknown>)[key];
  }
  return current;
}

/** The last path segment, as a display label (e.g. `description`, `[0]`). */
export function leafLabel(path: FieldPath): string {
  const last = path.at(-1);
  if (last === undefined) return '(root)';
  return typeof last === 'number' ? `[${last}]` : last;
}

/** Dotted, index-aware rendering of a whole path (e.g. `lineItems[0].amount`). */
export function formatPath(path: FieldPath): string {
  let out = '';
  for (const segment of path) {
    if (typeof segment === 'number') out += `[${segment}]`;
    else out += out === '' ? segment : `.${segment}`;
  }
  return out === '' ? '(root)' : out;
}

/** Human-readable rendering of a leaf value for the field list. */
export function formatValue(value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'string') return value === '' ? '(empty)' : value;
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  return String(value);
}
