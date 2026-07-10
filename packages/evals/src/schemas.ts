import { z } from 'zod';

/**
 * Receipt schema for the CORD-v2 half of the benchmark. Amount fields are
 * strings extracted as printed (CORD receipts mix "." and "," thousands
 * separators, so numeric parsing would test locale guessing, not extraction).
 * Only fields with CORD ground truth appear here — CORD does not annotate
 * merchant name or date.
 */
export const receiptSchema = z.object({
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
  discount: z.string().nullable().describe('Discount amount as printed, e.g. "-60.000" or "19,400"'),
  serviceCharge: z.string().nullable().describe('Service charge amount as printed'),
  tax: z.string().nullable().describe('Tax amount as printed'),
  total: z.string().describe('Final charged total as printed'),
});

export type Receipt = z.output<typeof receiptSchema>;

/**
 * Invoice schema for the DocILE half of the benchmark. Amounts are strings
 * as printed for the same reason as receipts.
 */
export const invoiceSchema = z.object({
  vendorName: z.string().nullable().describe('Name of the party issuing the invoice'),
  invoiceNumber: z.string().nullable().describe('Invoice identifier assigned by the vendor'),
  issueDate: z.string().nullable().describe('Date the invoice was issued, as printed'),
  dueDate: z.string().nullable().describe('Payment due date, as printed'),
  currency: z.string().nullable().describe('Currency code or symbol used for the amounts'),
  subtotal: z.string().nullable().describe('Total before tax, as printed'),
  tax: z.string().nullable().describe('Total tax amount, as printed'),
  total: z.string().nullable().describe('Total amount due, as printed'),
  lineItems: z
    .array(
      z.object({
        description: z.string().nullable().describe('Line item description as printed'),
        quantity: z.string().nullable().describe('Quantity as printed'),
        unitPrice: z.string().nullable().describe('Per-unit price as printed'),
        amount: z.string().nullable().describe('Line total as printed'),
      }),
    )
    .describe('Every line item in printed order'),
});

export type Invoice = z.output<typeof invoiceSchema>;

export const schemas = {
  receipt: receiptSchema,
  invoice: invoiceSchema,
} as const;
