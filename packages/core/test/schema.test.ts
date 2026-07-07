import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { UnsupportedSchemaError } from '../src/errors.js';
import {
  buildWireSchema,
  formatIssuePath,
  isOnlyMissingFields,
  unwrapWireOutput,
} from '../src/schema.js';
import { wireLeaf } from './helpers.js';

const receipt = z.object({
  vendor: z.string().describe('Merchant name'),
  total: z.number(),
  currency: z.enum(['USD', 'EUR']).optional(),
  notes: z.string().nullable(),
  lineItems: z.array(z.object({ description: z.string(), amount: z.number() })),
});

function fieldsShape(schema: z.ZodObject): z.ZodObject {
  const wire = buildWireSchema(schema);
  return wire.shape.fields as z.ZodObject;
}

describe('buildWireSchema', () => {
  it('rejects a non-object root', () => {
    expect(() => buildWireSchema(z.string())).toThrow(UnsupportedSchemaError);
  });

  it('wraps every leaf with value, page, bbox, confidence — confidence last', () => {
    const fields = fieldsShape(receipt);
    const vendor = fields.shape.vendor as z.ZodObject;
    expect(Object.keys(vendor.shape)).toEqual(['value', 'page', 'bbox', 'confidence']);
    const lineItems = fields.shape.lineItems as z.ZodArray<z.ZodObject>;
    const amount = lineItems.element.shape.amount as z.ZodObject;
    expect(Object.keys(amount.shape)).toEqual(['value', 'page', 'bbox', 'confidence']);
  });

  it('keeps optional and nullable leaves as plain wrappers (value carries the null)', () => {
    const fields = fieldsShape(receipt);
    expect(fields.shape.currency).toBeInstanceOf(z.ZodObject);
    expect(fields.shape.notes).toBeInstanceOf(z.ZodObject);
  });

  it('makes optional/nullable containers nullable on the wire', () => {
    const fields = fieldsShape(
      z.object({
        shipping: z.object({ address: z.string() }).nullable(),
        items: z.array(z.string()).optional(),
      }),
    );
    expect(fields.shape.shipping).toBeInstanceOf(z.ZodNullable);
    expect(fields.shape.items).toBeInstanceOf(z.ZodNullable);
  });

  it('carries field descriptions onto the wire wrappers', () => {
    const fields = fieldsShape(receipt);
    expect((fields.shape.vendor as z.ZodType).description).toBe('Merchant name');
  });

  it('validates a well-formed envelope', () => {
    const wire = buildWireSchema(z.object({ vendor: z.string() }));
    const parsed = wire.safeParse({
      readable: true,
      issues: [],
      fields: { vendor: wireLeaf('ACME') },
    });
    expect(parsed.success).toBe(true);
  });

  it.each([
    ['z.date()', z.object({ when: z.date() }), '$.when', 'z.iso.date'],
    ['defaults', z.object({ qty: z.number().default(1) }), '$.qty', 'provenance'],
    ['transforms', z.object({ id: z.string().transform((s) => s.trim()) }), '$.id', 'Transforms'],
    ['catch', z.object({ qty: z.number().catch(0) }), '$.qty', 'catch'],
    ['unions', z.object({ v: z.union([z.string(), z.number()]) }), '$.v', 'Unsupported schema type'],
    ['records', z.object({ v: z.record(z.string(), z.string()) }), '$.v', 'Unsupported schema type'],
    ['array element unions', z.object({ xs: z.array(z.union([z.string(), z.number()])) }), '$.xs[]', 'Unsupported'],
  ])('rejects %s with the offending path', (_name, schema, path, messagePart) => {
    try {
      buildWireSchema(schema);
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(UnsupportedSchemaError);
      expect((err as UnsupportedSchemaError).path).toBe(path);
      expect((err as UnsupportedSchemaError).message).toContain(messagePart);
    }
  });

  it('supports refinements without affecting the wire shape', () => {
    const schema = z.object({ total: z.number() }).refine((v) => v.total >= 0);
    expect(() => buildWireSchema(schema)).not.toThrow();
  });
});

describe('unwrapWireOutput', () => {
  const wireFields = {
    vendor: wireLeaf('ACME Corp'),
    total: wireLeaf(41.5, { bbox: [0.5, 0.8, 0.9, 0.85] }),
    currency: wireLeaf('USD'),
    notes: wireLeaf(null),
    lineItems: [
      { description: wireLeaf('Widget'), amount: wireLeaf(41.5) },
    ],
  };

  it('rebuilds data and a parallel provenance tree', () => {
    const { data, fields, issues, missingPaths } = unwrapWireOutput(receipt, wireFields, 1);
    expect(data).toEqual({
      vendor: 'ACME Corp',
      total: 41.5,
      currency: 'USD',
      notes: null,
      lineItems: [{ description: 'Widget', amount: 41.5 }],
    });
    expect(issues).toEqual([]);
    expect(missingPaths).toEqual([]);
    const f = fields as Record<string, unknown>;
    expect(f.vendor).toEqual({ value: 'ACME Corp', confidence: 0.9, page: 0, bbox: { x0: 0.1, y0: 0.2, x1: 0.4, y1: 0.3 } });
    expect((f.total as { bbox: unknown }).bbox).toEqual({ x0: 0.5, y0: 0.8, x1: 0.9, y1: 0.85 });
    expect((f.lineItems as unknown[]).length).toBe(1);
  });

  it('omits missing optional fields and keeps nullable fields as null', () => {
    const { data, fields, missingPaths } = unwrapWireOutput(
      receipt,
      { ...wireFields, currency: wireLeaf(null), notes: wireLeaf(null) },
      1,
    );
    expect(data).not.toHaveProperty('currency');
    expect((data as { notes: unknown }).notes).toBeNull();
    expect(fields).not.toHaveProperty('currency');
    expect((fields as { notes: { value: unknown } }).notes.value).toBeNull();
    expect(missingPaths).toEqual([]);
  });

  it('records required fields the model returned as null', () => {
    const { data, missingPaths } = unwrapWireOutput(receipt, { ...wireFields, total: wireLeaf(null) }, 1);
    expect(missingPaths).toEqual(['$.total']);
    expect(data).not.toHaveProperty('total');
  });

  it('records missing required leaves inside array elements with their indexed path', () => {
    const { data, missingPaths } = unwrapWireOutput(
      receipt,
      {
        ...wireFields,
        lineItems: [
          { description: wireLeaf('Widget'), amount: wireLeaf(41.5) },
          { description: wireLeaf(null), amount: wireLeaf(1) },
        ],
      },
      1,
    );
    expect((data as { lineItems: unknown[] }).lineItems).toHaveLength(2);
    expect(missingPaths).toContain('$.lineItems[1].description');
  });

  it('drops null elements of primitive arrays with an issue', () => {
    const schema = z.object({ tags: z.array(z.string()) });
    const { data, issues, missingPaths } = unwrapWireOutput(
      schema,
      { tags: [wireLeaf('urgent'), wireLeaf(null)] },
      1,
    );
    expect((data as { tags: string[] }).tags).toEqual(['urgent']);
    expect(issues.some((i) => i.includes('$.tags[1]'))).toBe(true);
    expect(missingPaths).toEqual([]);
  });

  it('nulls provenance for out-of-range pages', () => {
    const { fields, issues } = unwrapWireOutput(receipt, { ...wireFields, vendor: wireLeaf('ACME', { page: 3 }) }, 1);
    const vendor = (fields as { vendor: { page: unknown; bbox: unknown } }).vendor;
    expect(vendor.page).toBeNull();
    expect(vendor.bbox).toBeNull();
    expect(issues.some((i) => i.includes('$.vendor') && i.includes('page 3'))).toBe(true);
  });

  it('drops degenerate bboxes and keeps the page', () => {
    const { fields, issues } = unwrapWireOutput(
      receipt,
      { ...wireFields, vendor: wireLeaf('ACME', { bbox: [0.5, 0.2, 0.1, 0.3] }) },
      1,
    );
    const vendor = (fields as { vendor: { page: unknown; bbox: unknown } }).vendor;
    expect(vendor.bbox).toBeNull();
    expect(vendor.page).toBe(0);
    expect(issues.some((i) => i.includes('degenerate bbox'))).toBe(true);
  });

  it('drops a bbox reported without a page', () => {
    const { fields, issues } = unwrapWireOutput(
      receipt,
      { ...wireFields, vendor: wireLeaf('ACME', { page: null }) },
      1,
    );
    expect((fields as { vendor: { bbox: unknown } }).vendor.bbox).toBeNull();
    expect(issues.some((i) => i.includes('bbox reported without a valid page'))).toBe(true);
  });

  it('clamps out-of-range confidence and coordinates', () => {
    const { fields, issues } = unwrapWireOutput(
      receipt,
      { ...wireFields, vendor: wireLeaf('ACME', { confidence: 1.4, bbox: [-0.1, 0.2, 1.2, 0.3] }) },
      1,
    );
    const vendor = (fields as { vendor: { confidence: number; bbox: { x0: number; x1: number } } }).vendor;
    expect(vendor.confidence).toBe(1);
    expect(vendor.bbox).toEqual({ x0: 0, y0: 0.2, x1: 1, y1: 0.3 });
    expect(issues.some((i) => i.includes('confidence'))).toBe(true);
  });

  it('maps nullable containers returned as null', () => {
    const schema = z.object({ shipping: z.object({ address: z.string() }).nullable() });
    const { data, fields } = unwrapWireOutput(schema, { shipping: null }, 1);
    expect(data).toEqual({ shipping: null });
    expect(fields).toEqual({ shipping: null });
  });
});

describe('path helpers', () => {
  it('formats paths like $.a[0].b', () => {
    expect(formatIssuePath(['a', 0, 'b'])).toBe('$.a[0].b');
    expect(formatIssuePath([])).toBe('$');
  });

  it('classifies pure missing-field failures', () => {
    const schema = z.object({ a: z.string(), b: z.number() });
    const missingOnly = schema.safeParse({ b: 1 });
    if (missingOnly.success) throw new Error('expected failure');
    expect(isOnlyMissingFields(missingOnly.error, ['$.a'])).toBe(true);

    const mixed = schema.safeParse({ b: 'nope' });
    if (mixed.success) throw new Error('expected failure');
    expect(isOnlyMissingFields(mixed.error, ['$.a'])).toBe(false);
    expect(isOnlyMissingFields(mixed.error, [])).toBe(false);
  });
});
