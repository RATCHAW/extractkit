import { z } from 'zod';
import type { SchemaInfo } from '../shared/api';

/**
 * Amounts are extracted as strings exactly as printed. Business documents mix
 * "." and "," as decimal/thousands separators, so parsing them to numbers would
 * test locale guessing rather than extraction — and a parsed number no longer
 * maps to a region of the page, which breaks the provenance guarantee. Callers
 * parse after extraction.
 */
const invoiceSchema = z.object({
  vendorName: z.string().nullable().describe('Legal name of the party issuing the invoice'),
  invoiceNumber: z.string().nullable().describe('Invoice identifier assigned by the vendor'),
  issueDate: z.string().nullable().describe('Date the invoice was issued, as printed'),
  dueDate: z.string().nullable().describe('Payment due date, as printed'),
  currency: z.string().nullable().describe('Currency code or symbol used for the amounts, e.g. "USD" or "€"'),
  subtotal: z.string().nullable().describe('Total before tax, as printed'),
  tax: z.string().nullable().describe('Total tax amount, as printed'),
  total: z.string().describe('Total amount due, as printed'),
  lineItems: z
    .array(
      z.object({
        description: z.string().describe('Line item description as printed'),
        quantity: z.string().nullable().describe('Quantity as printed'),
        unitPrice: z.string().nullable().describe('Per-unit price as printed'),
        amount: z.string().nullable().describe('Line total as printed'),
      }),
    )
    .describe('Every line item in printed order'),
});

const receiptSchema = z.object({
  merchant: z.string().nullable().describe('Store or merchant name as printed'),
  date: z.string().nullable().describe('Transaction date, as printed'),
  lineItems: z
    .array(
      z.object({
        description: z.string().describe('Item name as printed, e.g. "ICE BLACKCOFFE"'),
        quantity: z.string().nullable().describe('Quantity as printed, e.g. "2" or "1X"'),
        unitPrice: z.string().nullable().describe('Per-unit price as printed, e.g. "@11000"'),
        amount: z.string().nullable().describe('Line total as printed, e.g. "24,000"'),
      }),
    )
    .describe('Every purchased item in printed order, including sub-items listed under another item'),
  subtotal: z.string().nullable().describe('Subtotal before tax/discount/service, as printed'),
  tax: z.string().nullable().describe('Tax amount as printed'),
  total: z.string().describe('Final charged total as printed'),
});

interface Preset {
  schema: z.ZodObject;
  label: string;
  description: string;
}

/**
 * The playground offers a fixed set of business-document schemas rather than
 * accepting arbitrary Zod from the browser — the schema is the library's public
 * API surface, and running caller-supplied code server-side is out of scope.
 */
const PRESETS: Record<string, Preset> = {
  invoice: {
    schema: invoiceSchema,
    label: 'Invoice',
    description: 'Vendor, dates, currency, totals, and line items from an invoice.',
  },
  receipt: {
    schema: receiptSchema,
    label: 'Receipt',
    description: 'Merchant, date, line items, and totals from a store receipt.',
  },
};

export const DEFAULT_SCHEMA_ID = 'invoice';

export function getPreset(id: string): Preset | undefined {
  return PRESETS[id];
}

export function schemaInfos(): SchemaInfo[] {
  return Object.entries(PRESETS).map(([id, preset]) => ({
    id,
    label: preset.label,
    description: preset.description,
    topLevelFields: Object.keys(preset.schema.shape),
  }));
}
