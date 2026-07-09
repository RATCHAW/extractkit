import type { BBox } from 'extractkit';
import { normalizeValue } from '../normalize.js';
import type { CompareKind, GroundTruthField, GroundTruthRegion } from '../types.js';

/**
 * DocILE annotation file (`<root>/annotations/{docid}.json`) as shipped in
 * the annotated-trainval archive. bbox is [left, top, right, bottom] in
 * page-relative 0–1 coordinates, origin top-left; page is 0-based — the same
 * conventions extractkit uses.
 */
export interface DocileAnnotation {
  field_extractions: DocileField[];
  line_item_extractions: DocileField[];
  metadata: {
    page_count: number;
    document_type: string;
    currency: string;
    [key: string]: unknown;
  };
}

export interface DocileField {
  fieldtype: string;
  text: string;
  page: number;
  bbox: [number, number, number, number];
  line_item_id?: number;
}

/** Thrown when an annotation cannot be mapped confidently onto the invoice
 * schema; the pin script skips such documents. */
export class DocileMappingError extends Error {}

const HEADER_FIELDS = [
  { fieldtype: 'vendor_name', path: 'vendorName', compare: 'text' },
  { fieldtype: 'document_id', path: 'invoiceNumber', compare: 'text' },
  { fieldtype: 'date_issue', path: 'issueDate', compare: 'text' },
  { fieldtype: 'date_due', path: 'dueDate', compare: 'text' },
  { fieldtype: 'currency_code_amount_due', path: 'currency', compare: 'text' },
  { fieldtype: 'amount_total_net', path: 'subtotal', compare: 'money' },
  { fieldtype: 'amount_total_tax', path: 'tax', compare: 'money' },
  { fieldtype: 'amount_total_gross', path: 'total', compare: 'money' },
] as const;

/** Net preferred over gross so "subtotal + tax = total" stays coherent with
 * the header mapping (subtotal ← amount_total_net). */
const ITEM_FIELDS = [
  { fieldtypes: ['line_item_description'], path: 'description', compare: 'text' },
  { fieldtypes: ['line_item_quantity'], path: 'quantity', compare: 'count' },
  { fieldtypes: ['line_item_unit_price_net', 'line_item_unit_price_gross'], path: 'unitPrice', compare: 'money' },
  { fieldtypes: ['line_item_amount_net', 'line_item_amount_gross'], path: 'amount', compare: 'money' },
] as const;

function toRegion(field: DocileField): GroundTruthRegion {
  const [x0, y0, x1, y1] = field.bbox;
  const bbox: BBox = { x0, y0, x1, y1 };
  return { page: field.page, bbox };
}

function byReadingOrder(a: DocileField, b: DocileField): number {
  return a.page - b.page || a.bbox[1] - b.bbox[1] || a.bbox[0] - b.bbox[0];
}

/**
 * Collapse every annotated occurrence of one header fieldtype into a single
 * ground-truth field: the first occurrence (reading order) is canonical,
 * occurrences printed differently become altValues, and all boxes are
 * acceptable grounding regions.
 */
function headerField(
  occurrences: DocileField[],
  path: string,
  compare: CompareKind,
): GroundTruthField {
  if (occurrences.length === 0) return { path, value: null, compare, regions: [] };
  const sorted = [...occurrences].sort(byReadingOrder);
  const first = sorted[0] as DocileField;
  const canonical = first.text;
  const seen = new Set([normalizeValue(canonical, compare)]);
  const altValues: string[] = [];
  for (const occ of sorted.slice(1)) {
    const normalized = normalizeValue(occ.text, compare);
    if (!seen.has(normalized)) {
      seen.add(normalized);
      altValues.push(occ.text);
    }
  }
  return {
    path,
    value: canonical,
    ...(altValues.length > 0 ? { altValues } : {}),
    compare,
    regions: sorted.map(toRegion),
  };
}

/** One line-item field: fragments of the same fieldtype (multi-line values)
 * are joined in reading order; distinct-text duplicates are ambiguous and
 * reject the document. */
function itemField(
  occurrences: DocileField[],
  path: string,
  compare: CompareKind,
): GroundTruthField {
  if (occurrences.length === 0) return { path, value: null, compare, regions: [] };
  const sorted = [...occurrences].sort(byReadingOrder);
  const value = sorted.map((f) => f.text).join(' ');
  return { path, value, compare, regions: sorted.map(toRegion) };
}

/**
 * Map one DocILE annotation onto invoice-schema ground truth. Line items
 * are ordered by the reading order of their topmost annotation, matching
 * the "in printed order" instruction in the invoice schema. Throws
 * DocileMappingError when the annotation cannot be mapped confidently.
 */
export function docileToGroundTruth(annotation: DocileAnnotation): {
  fields: GroundTruthField[];
  lineItemCount: number;
} {
  const fields: GroundTruthField[] = [];

  for (const { fieldtype, path, compare } of HEADER_FIELDS) {
    const occurrences = annotation.field_extractions.filter((f) => f.fieldtype === fieldtype);
    fields.push(headerField(occurrences, path, compare));
  }

  const byItem = new Map<number, DocileField[]>();
  for (const field of annotation.line_item_extractions) {
    if (field.line_item_id === undefined) {
      throw new DocileMappingError(`line_item_extractions entry ${field.fieldtype} has no line_item_id`);
    }
    const list = byItem.get(field.line_item_id) ?? [];
    list.push(field);
    byItem.set(field.line_item_id, list);
  }

  const itemOrder = [...byItem.entries()]
    .map(([id, list]) => ({ id, list, first: [...list].sort(byReadingOrder)[0] as DocileField }))
    .sort((a, b) => byReadingOrder(a.first, b.first));

  itemOrder.forEach(({ list }, i) => {
    for (const { fieldtypes, path, compare } of ITEM_FIELDS) {
      // Prefer net over gross: use the first fieldtype that has occurrences.
      const present = fieldtypes.map((ft) => list.filter((f) => f.fieldtype === ft)).find((occ) => occ.length > 0) ?? [];
      fields.push({ ...itemField(present, path, compare), path: `lineItems.${i}.${path}` });
    }
  });

  return { fields, lineItemCount: itemOrder.length };
}
