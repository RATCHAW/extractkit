import { describe, expect, it } from 'vitest';
import { cordToGroundTruth, CordMappingError, type CordGroundTruth } from '../src/datasets/cord.js';

function quad(x0: number, y0: number, x1: number, y1: number) {
  return { x1: x0, y1: y0, x2: x1, y2: y0, x3: x1, y3: y1, x4: x0, y4: y1 };
}

function line(category: string, groupId: number, text: string, box: [number, number, number, number], subGroupId?: number) {
  return {
    category,
    group_id: groupId,
    ...(subGroupId !== undefined ? { sub_group_id: subGroupId } : {}),
    words: [{ text, quad: quad(...box) }],
  };
}

const META = { image_id: 0, image_size: { width: 100, height: 200 } };

describe('cordToGroundTruth', () => {
  it('maps a single-item receipt with scalars', () => {
    const gt: CordGroundTruth = {
      meta: META,
      gt_parse: {
        menu: { nm: 'TICKET CP', cnt: '2', price: '60.000' },
        sub_total: { subtotal_price: '60.000', tax_price: '5.455' },
        total: { total_price: '65.455' },
      },
      valid_line: [
        line('menu.nm', 1, 'TICKET CP', [10, 20, 50, 30]),
        line('menu.cnt', 1, '2', [5, 20, 8, 30]),
        line('menu.price', 1, '60.000', [60, 20, 90, 30]),
        line('sub_total.subtotal_price', 2, '60.000', [60, 40, 90, 50]),
        line('sub_total.tax_price', 2, '5.455', [60, 52, 90, 60]),
        line('total.total_price', 3, '65.455', [60, 64, 90, 72]),
      ],
    };
    const { fields, lineItemCount } = cordToGroundTruth(gt);
    expect(lineItemCount).toBe(1);

    const byPath = new Map(fields.map((f) => [f.path, f]));
    expect(byPath.get('lineItems.0.description')?.value).toBe('TICKET CP');
    expect(byPath.get('lineItems.0.quantity')?.value).toBe('2');
    expect(byPath.get('lineItems.0.unitPrice')?.value).toBeNull();
    expect(byPath.get('lineItems.0.amount')?.value).toBe('60.000');
    expect(byPath.get('subtotal')?.value).toBe('60.000');
    expect(byPath.get('tax')?.value).toBe('5.455');
    expect(byPath.get('discount')?.value).toBeNull();
    expect(byPath.get('serviceCharge')?.value).toBeNull();
    expect(byPath.get('total')?.value).toBe('65.455');

    // Boxes are normalized by image size, page 0.
    const nm = byPath.get('lineItems.0.description');
    expect(nm?.regions).toEqual([{ page: 0, bbox: { x0: 0.1, y0: 0.1, x1: 0.5, y1: 0.15 } }]);
    expect(byPath.get('lineItems.0.unitPrice')?.regions).toEqual([]);
  });

  it('maps an array menu in ascending group order', () => {
    const gt: CordGroundTruth = {
      meta: META,
      gt_parse: {
        menu: [
          { nm: 'FIRST', price: '1.000' },
          { nm: 'SECOND', price: '2.000' },
        ],
        total: { total_price: '3.000' },
      },
      valid_line: [
        // Deliberately unsorted input order.
        line('menu.nm', 7, 'SECOND', [10, 40, 50, 50]),
        line('menu.nm', 3, 'FIRST', [10, 20, 50, 30]),
        line('menu.price', 3, '1.000', [60, 20, 90, 30]),
        line('menu.price', 7, '2.000', [60, 40, 90, 50]),
        line('total.total_price', 9, '3.000', [60, 60, 90, 70]),
      ],
    };
    const { fields, lineItemCount } = cordToGroundTruth(gt);
    expect(lineItemCount).toBe(2);
    const byPath = new Map(fields.map((f) => [f.path, f]));
    expect(byPath.get('lineItems.0.description')?.value).toBe('FIRST');
    expect(byPath.get('lineItems.1.description')?.value).toBe('SECOND');
    expect(byPath.get('lineItems.1.amount')?.regions[0]?.bbox.y0).toBeCloseTo(0.2);
  });

  it('flattens sub-items after their parent', () => {
    const gt: CordGroundTruth = {
      meta: META,
      gt_parse: {
        menu: { nm: 'JASMINE MT', cnt: '1', price: '24,000', sub: { nm: 'COCONUT JELLY', price: '4,000' } },
        total: { total_price: '28,000' },
      },
      valid_line: [
        line('menu.nm', 1, 'JASMINE MT', [10, 20, 50, 30]),
        line('menu.cnt', 1, '1', [5, 20, 8, 30]),
        line('menu.price', 1, '24,000', [60, 20, 90, 30]),
        line('menu.sub.nm', 1, 'COCONUT JELLY', [15, 32, 55, 40], 0),
        line('menu.sub.price', 1, '4,000', [60, 32, 90, 40], 0),
        line('total.total_price', 2, '28,000', [60, 60, 90, 70]),
      ],
    };
    const { fields, lineItemCount } = cordToGroundTruth(gt);
    expect(lineItemCount).toBe(2);
    const byPath = new Map(fields.map((f) => [f.path, f]));
    expect(byPath.get('lineItems.0.description')?.value).toBe('JASMINE MT');
    expect(byPath.get('lineItems.1.description')?.value).toBe('COCONUT JELLY');
    expect(byPath.get('lineItems.1.amount')?.value).toBe('4,000');
    expect(byPath.get('lineItems.1.amount')?.regions).toHaveLength(1);
  });

  it('joins multi-line values into one bbox union', () => {
    const gt: CordGroundTruth = {
      meta: META,
      gt_parse: { menu: { nm: 'VERY LONG ITEM NAME' }, total: { total_price: '1.000' } },
      valid_line: [
        line('menu.nm', 1, 'VERY LONG', [10, 20, 50, 30]),
        line('menu.nm', 1, 'ITEM NAME', [10, 32, 45, 42]),
        line('total.total_price', 2, '1.000', [60, 60, 90, 70]),
      ],
    };
    const { fields } = cordToGroundTruth(gt);
    const nm = fields.find((f) => f.path === 'lineItems.0.description');
    expect(nm?.regions[0]?.bbox).toEqual({ x0: 0.1, y0: 0.1, x1: 0.5, y1: 0.21 });
  });

  it('grounds a labeled scalar on the value words only', () => {
    const gt: CordGroundTruth = {
      meta: META,
      gt_parse: { menu: { nm: 'A' }, sub_total: { tax_price: '3,650' }, total: { total_price: '40,150' } },
      valid_line: [
        line('menu.nm', 1, 'A', [10, 20, 50, 30]),
        {
          category: 'sub_total.tax_price',
          group_id: 2,
          words: [
            { text: 'PB1', quad: quad(10, 40, 25, 50) },
            { text: '10%', quad: quad(30, 40, 45, 50) },
            { text: '3,650', quad: quad(60, 40, 90, 50) },
          ],
        },
        line('total.total_price', 3, '40,150', [60, 60, 90, 70]),
      ],
    };
    const { fields } = cordToGroundTruth(gt);
    const tax = fields.find((f) => f.path === 'tax');
    expect(tax?.value).toBe('3,650');
    // Only the value word grounds the field, not the "PB1 10%" label.
    expect(tax?.regions).toEqual([{ page: 0, bbox: { x0: 0.6, y0: 0.2, x1: 0.9, y1: 0.25 } }]);
  });

  it('rejects a document whose annotated text disagrees with gt_parse', () => {
    const gt: CordGroundTruth = {
      meta: META,
      gt_parse: { menu: { nm: 'EXPECTED' }, total: { total_price: '1.000' } },
      valid_line: [
        line('menu.nm', 1, 'DIFFERENT', [10, 20, 50, 30]),
        line('total.total_price', 2, '1.000', [60, 60, 90, 70]),
      ],
    };
    expect(() => cordToGroundTruth(gt)).toThrow(CordMappingError);
  });

  it('rejects a document whose item count disagrees with the annotation groups', () => {
    const gt: CordGroundTruth = {
      meta: META,
      gt_parse: { menu: [{ nm: 'A' }, { nm: 'B' }], total: { total_price: '1.000' } },
      valid_line: [
        line('menu.nm', 1, 'A', [10, 20, 50, 30]),
        line('total.total_price', 2, '1.000', [60, 60, 90, 70]),
      ],
    };
    expect(() => cordToGroundTruth(gt)).toThrow(CordMappingError);
  });

  it('rejects non-string scalar values', () => {
    const gt: CordGroundTruth = {
      meta: META,
      gt_parse: { menu: { nm: 'A' }, total: { total_price: ['1.000', '2.000'] } },
      valid_line: [line('menu.nm', 1, 'A', [10, 20, 50, 30])],
    };
    expect(() => cordToGroundTruth(gt)).toThrow(CordMappingError);
  });
});
