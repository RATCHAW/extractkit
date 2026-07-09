import { describe, expect, it } from 'vitest';
import { docileToGroundTruth, type DocileAnnotation, type DocileField } from '../src/datasets/docile.js';

function field(
  fieldtype: string,
  text: string,
  over: Partial<DocileField> = {},
): DocileField {
  return { fieldtype, text, page: 0, bbox: [0.1, 0.1, 0.3, 0.12], ...over };
}

function annotation(over: Partial<DocileAnnotation> = {}): DocileAnnotation {
  return {
    field_extractions: [],
    line_item_extractions: [],
    metadata: { page_count: 1, document_type: 'tax_invoice', currency: 'USD' },
    ...over,
  };
}

describe('docileToGroundTruth', () => {
  it('maps header fieldtypes onto the invoice schema', () => {
    const { fields } = docileToGroundTruth(
      annotation({
        field_extractions: [
          field('vendor_name', 'ACME Corp'),
          field('document_id', 'INV-99'),
          field('date_issue', '01/15/2021'),
          field('amount_total_net', '100.00'),
          field('amount_total_tax', '8.00'),
          field('amount_total_gross', '108.00'),
        ],
      }),
    );
    const byPath = new Map(fields.map((f) => [f.path, f]));
    expect(byPath.get('vendorName')?.value).toBe('ACME Corp');
    expect(byPath.get('invoiceNumber')?.value).toBe('INV-99');
    expect(byPath.get('issueDate')?.value).toBe('01/15/2021');
    expect(byPath.get('dueDate')?.value).toBeNull();
    expect(byPath.get('subtotal')?.value).toBe('100.00');
    expect(byPath.get('tax')?.value).toBe('8.00');
    expect(byPath.get('total')?.value).toBe('108.00');
    expect(byPath.get('vendorName')?.regions).toHaveLength(1);
    expect(byPath.get('dueDate')?.regions).toEqual([]);
  });

  it('collects repeated occurrences: all regions, differing texts as altValues', () => {
    const { fields } = docileToGroundTruth(
      annotation({
        field_extractions: [
          field('document_id', 'INV-99', { page: 1, bbox: [0.7, 0.05, 0.9, 0.07] }),
          field('document_id', 'INV-99', { page: 0, bbox: [0.7, 0.05, 0.9, 0.07] }),
          field('date_issue', 'Jan 15, 2021', { page: 0, bbox: [0.1, 0.3, 0.3, 0.32] }),
          field('date_issue', '01/15/2021', { page: 0, bbox: [0.1, 0.1, 0.3, 0.12] }),
        ],
      }),
    );
    const byPath = new Map(fields.map((f) => [f.path, f]));
    const invoiceNumber = byPath.get('invoiceNumber');
    // Same text on both pages: one canonical value, two acceptable regions.
    expect(invoiceNumber?.value).toBe('INV-99');
    expect(invoiceNumber?.altValues).toBeUndefined();
    expect(invoiceNumber?.regions).toHaveLength(2);
    expect(invoiceNumber?.regions[0]?.page).toBe(0);
    // Different rendering: reading-order first is canonical, other is an alt.
    const issueDate = byPath.get('issueDate');
    expect(issueDate?.value).toBe('01/15/2021');
    expect(issueDate?.altValues).toEqual(['Jan 15, 2021']);
  });

  it('orders line items by reading order of their topmost field', () => {
    const { fields, lineItemCount } = docileToGroundTruth(
      annotation({
        line_item_extractions: [
          field('line_item_description', 'Second item', { line_item_id: 5, bbox: [0.1, 0.5, 0.4, 0.52] }),
          field('line_item_description', 'First item', { line_item_id: 9, bbox: [0.1, 0.3, 0.4, 0.32] }),
          field('line_item_amount_net', '10.00', { line_item_id: 9, bbox: [0.7, 0.3, 0.9, 0.32] }),
          field('line_item_quantity', '2', { line_item_id: 5, bbox: [0.5, 0.5, 0.6, 0.52] }),
        ],
      }),
    );
    expect(lineItemCount).toBe(2);
    const byPath = new Map(fields.map((f) => [f.path, f]));
    expect(byPath.get('lineItems.0.description')?.value).toBe('First item');
    expect(byPath.get('lineItems.0.amount')?.value).toBe('10.00');
    expect(byPath.get('lineItems.1.description')?.value).toBe('Second item');
    expect(byPath.get('lineItems.1.quantity')?.value).toBe('2');
    expect(byPath.get('lineItems.1.amount')?.value).toBeNull();
  });

  it('prefers net over gross for unit price and amount', () => {
    const { fields } = docileToGroundTruth(
      annotation({
        line_item_extractions: [
          field('line_item_description', 'Widget', { line_item_id: 1 }),
          field('line_item_unit_price_gross', '12.00', { line_item_id: 1, bbox: [0.5, 0.1, 0.6, 0.12] }),
          field('line_item_amount_net', '10.00', { line_item_id: 1, bbox: [0.7, 0.1, 0.9, 0.12] }),
        ],
      }),
    );
    const byPath = new Map(fields.map((f) => [f.path, f]));
    // Only gross unit price exists → fall back to it.
    expect(byPath.get('lineItems.0.unitPrice')?.value).toBe('12.00');
    expect(byPath.get('lineItems.0.amount')?.value).toBe('10.00');
  });

  it('joins multi-fragment line-item values in reading order', () => {
    const { fields } = docileToGroundTruth(
      annotation({
        line_item_extractions: [
          field('line_item_description', 'continued on line two', { line_item_id: 1, bbox: [0.1, 0.32, 0.4, 0.34] }),
          field('line_item_description', 'A long description', { line_item_id: 1, bbox: [0.1, 0.3, 0.4, 0.32] }),
        ],
      }),
    );
    const description = fields.find((f) => f.path === 'lineItems.0.description');
    expect(description?.value).toBe('A long description continued on line two');
    expect(description?.regions).toHaveLength(2);
  });
});
