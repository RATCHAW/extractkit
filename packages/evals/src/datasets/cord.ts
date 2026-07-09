import type { BBox } from 'extractkit';
import { valuesMatch } from '../normalize.js';
import type { CompareKind, GroundTruthField, GroundTruthRegion } from '../types.js';

/** CORD-v2 per-document ground truth, as stored in the `ground_truth` column. */
export interface CordGroundTruth {
  gt_parse: CordParse;
  meta: { image_id: number; image_size: { width: number; height: number } };
  valid_line: CordLine[];
}

interface CordParse {
  menu?: CordMenuItem | CordMenuItem[];
  sub_total?: Record<string, unknown>;
  total?: Record<string, unknown>;
  [key: string]: unknown;
}

interface CordMenuItem {
  nm?: string;
  cnt?: string;
  unitprice?: string;
  price?: string;
  sub?: CordMenuItem | CordMenuItem[];
  [key: string]: unknown;
}

interface CordLine {
  category: string;
  group_id: number;
  sub_group_id?: number;
  words: Array<{
    text: string;
    quad: { x1: number; y1: number; x2: number; y2: number; x3: number; y3: number; x4: number; y4: number };
  }>;
}

/** Thrown when a document's gt_parse cannot be mapped confidently onto the
 * receipt schema; the pin script skips such documents. */
export class CordMappingError extends Error {}

function asArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

function itemValue(item: CordMenuItem, key: 'nm' | 'cnt' | 'unitprice' | 'price'): string | null {
  const value = item[key];
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') {
    throw new CordMappingError(`menu ${key}: expected a string, got ${Array.isArray(value) ? 'array' : typeof value}`);
  }
  return value;
}

function scalarValue(parse: CordParse, section: string, key: string): string | null {
  const record = parse[section];
  if (record === undefined || record === null) return null;
  if (typeof record !== 'object' || Array.isArray(record)) {
    throw new CordMappingError(`${section}: expected an object`);
  }
  const value = (record as Record<string, unknown>)[key];
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') {
    throw new CordMappingError(`${section}.${key}: expected a string, got ${Array.isArray(value) ? 'array' : typeof value}`);
  }
  return value;
}

type CordWord = CordLine['words'][number];

function unionBBox(words: CordWord[], width: number, height: number): BBox {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const { quad } of words) {
    x0 = Math.min(x0, quad.x1, quad.x2, quad.x3, quad.x4);
    x1 = Math.max(x1, quad.x1, quad.x2, quad.x3, quad.x4);
    y0 = Math.min(y0, quad.y1, quad.y2, quad.y3, quad.y4);
    y1 = Math.max(y1, quad.y1, quad.y2, quad.y3, quad.y4);
  }
  const clamp = (v: number, max: number) => Math.min(Math.max(v / max, 0), 1);
  return { x0: clamp(x0, width), y0: clamp(y0, height), x1: clamp(x1, width), y1: clamp(y1, height) };
}

function joinWords(words: CordWord[]): string {
  return words
    .map((w) => w.text)
    .join(' ')
    .trim();
}

/**
 * The word spans that carry `value` within the annotated line(s). CORD lines
 * often include label words around the value ("PB1 10% 3,650" for tax_price
 * "3,650"), so we accept every word suffix whose text matches the value —
 * each is an acceptable grounding region. Empty when no suffix matches,
 * which means the annotation cannot be reconciled with gt_parse.
 */
function matchingSuffixes(words: CordWord[], value: string, compare: CompareKind): CordWord[][] {
  const spans: CordWord[][] = [];
  for (let k = 1; k <= words.length; k++) {
    const span = words.slice(words.length - k);
    if (valuesMatch(value, joinWords(span), compare)) spans.push(span);
  }
  return spans;
}

/** A flattened line item paired with the valid_line selector that owns its
 * annotation lines. Sub-items (`menu.sub.*` categories) become their own
 * line items, in printed order after their parent. */
interface FlatItem {
  values: { nm: string | null; cnt: string | null; unitprice: string | null; price: string | null };
  categoryPrefix: 'menu' | 'menu.sub';
  groupId: number;
  subGroupId: number | null;
}

const ITEM_FIELDS = [
  { key: 'nm', path: 'description', compare: 'text' },
  { key: 'cnt', path: 'quantity', compare: 'count' },
  { key: 'unitprice', path: 'unitPrice', compare: 'money' },
  { key: 'price', path: 'amount', compare: 'money' },
] as const;

const SCALAR_FIELDS = [
  { section: 'sub_total', key: 'subtotal_price', path: 'subtotal', compare: 'money' },
  { section: 'sub_total', key: 'discount_price', path: 'discount', compare: 'money' },
  { section: 'sub_total', key: 'service_price', path: 'serviceCharge', compare: 'money' },
  { section: 'sub_total', key: 'tax_price', path: 'tax', compare: 'money' },
  { section: 'total', key: 'total_price', path: 'total', compare: 'money' },
] as const;

/**
 * Flatten gt_parse menu items and pair each with its valid_line group.
 * Pairing assumes ascending group_id (and sub_group_id within a group)
 * follows printed order, which matches gt_parse order; the text-consistency
 * check in fieldRegions() rejects any document where that assumption fails.
 */
function flattenItems(gt: CordGroundTruth): FlatItem[] {
  const items = asArray(gt.gt_parse.menu);
  const parentGroupIds = [
    ...new Set(gt.valid_line.filter((l) => l.category === 'menu.nm').map((l) => l.group_id)),
  ].sort((a, b) => a - b);
  if (parentGroupIds.length !== items.length) {
    throw new CordMappingError(
      `menu has ${items.length} gt_parse items but ${parentGroupIds.length} annotated menu.nm groups`,
    );
  }
  const flat: FlatItem[] = [];
  items.forEach((item, i) => {
    const groupId = parentGroupIds[i] as number;
    flat.push({
      values: {
        nm: itemValue(item, 'nm'),
        cnt: itemValue(item, 'cnt'),
        unitprice: itemValue(item, 'unitprice'),
        price: itemValue(item, 'price'),
      },
      categoryPrefix: 'menu',
      groupId,
      subGroupId: null,
    });
    const subs = asArray(item.sub);
    if (subs.length === 0) return;
    const subGroupIds = [
      ...new Set(
        gt.valid_line
          .filter((l) => l.category.startsWith('menu.sub.') && l.group_id === groupId)
          .map((l) => l.sub_group_id ?? 0),
      ),
    ].sort((a, b) => a - b);
    if (subGroupIds.length !== subs.length) {
      throw new CordMappingError(
        `menu item ${i} has ${subs.length} sub-items but ${subGroupIds.length} annotated sub-groups`,
      );
    }
    subs.forEach((sub, j) => {
      flat.push({
        values: {
          nm: itemValue(sub, 'nm'),
          cnt: itemValue(sub, 'cnt'),
          unitprice: itemValue(sub, 'unitprice'),
          price: itemValue(sub, 'price'),
        },
        categoryPrefix: 'menu.sub',
        groupId,
        subGroupId: subGroupIds[j] as number,
      });
    });
  });
  return flat;
}

/**
 * Grounding regions for one gt_parse value: the matching word suffix(es) of
 * the valid_line entries selected by category/group. Empty when no line
 * carries the category (some gt_parse values have no annotated region);
 * throws when lines exist but none of their word suffixes carries the value —
 * that means the pairing misfired and the document should not be pinned.
 */
function fieldRegions(
  gt: CordGroundTruth,
  category: string,
  value: string,
  compare: CompareKind,
  groupId: number | null,
  subGroupId: number | null,
): GroundTruthRegion[] {
  const lines = gt.valid_line.filter(
    (l) =>
      l.category === category &&
      (groupId === null || l.group_id === groupId) &&
      (subGroupId === null || (l.sub_group_id ?? 0) === subGroupId),
  );
  if (lines.length === 0) return [];
  const words = lines.flatMap((l) => l.words);
  const spans = matchingSuffixes(words, value, compare);
  if (spans.length === 0) {
    throw new CordMappingError(
      `${category}: annotated text ${JSON.stringify(joinWords(words))} does not carry gt_parse value ${JSON.stringify(value)}`,
    );
  }
  const { width, height } = gt.meta.image_size;
  return spans.map((span) => ({ page: 0, bbox: unionBBox(span, width, height) }));
}

/**
 * Map one CORD-v2 ground-truth record onto receipt-schema ground truth.
 * Throws CordMappingError when the record cannot be mapped confidently;
 * such documents are excluded at pin time, never silently mis-scored.
 */
export function cordToGroundTruth(gt: CordGroundTruth): { fields: GroundTruthField[]; lineItemCount: number } {
  const fields: GroundTruthField[] = [];
  const items = flattenItems(gt);

  items.forEach((item, i) => {
    for (const { key, path, compare } of ITEM_FIELDS) {
      const value = item.values[key];
      fields.push({
        path: `lineItems.${i}.${path}`,
        value,
        compare,
        regions:
          value === null
            ? []
            : fieldRegions(gt, `${item.categoryPrefix}.${key}`, value, compare, item.groupId, item.subGroupId),
      });
    }
  });

  for (const { section, key, path, compare } of SCALAR_FIELDS) {
    const value = scalarValue(gt.gt_parse, section, key);
    fields.push({
      path,
      value,
      compare,
      regions: value === null ? [] : fieldRegions(gt, `${section}.${key}`, value, compare, null, null),
    });
  }

  return { fields, lineItemCount: items.length };
}
