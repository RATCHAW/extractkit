import type { ExtractedField } from '@ratchaw/extractkit';
import { describe, expect, it } from 'vitest';
import { iou, scoreExtraction, scoreFailure, summarizeRun } from '../src/metrics.js';
import type { EvalDocument, GroundTruthField, ModelRun } from '../src/types.js';

function leaf(value: unknown, over: Partial<ExtractedField<unknown>> = {}): ExtractedField<unknown> {
  return { value, confidence: 0.9, page: 0, bbox: { x0: 0.1, y0: 0.1, x1: 0.5, y1: 0.2 }, ...over };
}

function gtField(over: Partial<GroundTruthField> & Pick<GroundTruthField, 'path' | 'value'>): GroundTruthField {
  return {
    compare: 'text',
    regions: over.value === null ? [] : [{ page: 0, bbox: { x0: 0.1, y0: 0.1, x1: 0.5, y1: 0.2 } }],
    ...over,
  };
}

function doc(fields: GroundTruthField[], lineItemCount = 1): EvalDocument {
  return {
    id: 'cord/test/0',
    dataset: 'cord',
    schema: 'receipt',
    bytes: new Uint8Array([1]),
    mediaType: 'image/png',
    pages: 1,
    fields,
    lineItemCount,
  };
}

describe('iou', () => {
  it('is 1 for identical boxes and 0 for disjoint boxes', () => {
    const a = { x0: 0, y0: 0, x1: 0.5, y1: 0.5 };
    expect(iou(a, a)).toBe(1);
    expect(iou(a, { x0: 0.6, y0: 0.6, x1: 1, y1: 1 })).toBe(0);
  });

  it('computes intersection over union', () => {
    const a = { x0: 0, y0: 0, x1: 0.2, y1: 0.1 };
    const b = { x0: 0.1, y0: 0, x1: 0.3, y1: 0.1 };
    expect(iou(a, b)).toBeCloseTo(1 / 3);
  });
});

describe('scoreExtraction', () => {
  it('scores values under the field normalizer and IoU against regions', () => {
    const document = doc([
      gtField({ path: 'total', value: '24.000', compare: 'money' }),
      gtField({ path: 'subtotal', value: null, compare: 'money' }),
    ]);
    const { fields } = scoreExtraction(document, {
      fields: { total: leaf('24,000'), subtotal: leaf(null, { page: null, bbox: null }), lineItems: [] },
    });
    const total = fields.find((f) => f.path === 'total');
    expect(total?.valueCorrect).toBe(true);
    expect(total?.iou).toBe(1);
    const subtotal = fields.find((f) => f.path === 'subtotal');
    expect(subtotal?.valueCorrect).toBe(true);
    expect(subtotal?.iou).toBeNull(); // no ground-truth region to score
  });

  it('accepts altValues', () => {
    const document = doc([gtField({ path: 'total', value: '01/15/2021', altValues: ['Jan 15, 2021'] })]);
    const { fields } = scoreExtraction(document, { fields: { total: leaf('jan 15, 2021') } });
    expect(fields[0]?.valueCorrect).toBe(true);
  });

  it('scores grounding 0 for a correct value with missing bbox or wrong page', () => {
    const document = doc([
      gtField({ path: 'a', value: 'x' }),
      gtField({ path: 'b', value: 'y' }),
    ]);
    const { fields } = scoreExtraction(document, {
      fields: { a: leaf('x', { bbox: null }), b: leaf('y', { page: 3 }) },
    });
    expect(fields.find((f) => f.path === 'a')?.iou).toBe(0);
    expect(fields.find((f) => f.path === 'b')?.iou).toBe(0);
  });

  it('leaves iou null when the value is wrong', () => {
    const document = doc([gtField({ path: 'a', value: 'x' })]);
    const { fields } = scoreExtraction(document, { fields: { a: leaf('wrong') } });
    expect(fields[0]?.valueCorrect).toBe(false);
    expect(fields[0]?.iou).toBeNull();
  });

  it('treats a missing line item as null predictions and counts extras', () => {
    const document = doc(
      [
        gtField({ path: 'lineItems.0.description', value: 'present' }),
        gtField({ path: 'lineItems.1.description', value: 'missing' }),
      ],
      2,
    );
    const { fields, extraLineItems } = scoreExtraction(document, {
      fields: { lineItems: [{ description: leaf('present') }, undefined, { description: leaf('extra 1') }].filter(
        (x) => x !== undefined,
      ) },
    });
    expect(fields.find((f) => f.path === 'lineItems.0.description')?.valueCorrect).toBe(true);
    expect(fields.find((f) => f.path === 'lineItems.1.description')?.valueCorrect).toBe(false);
    expect(extraLineItems).toBe(0); // 2 predicted, 2 in ground truth

    const overshoot = scoreExtraction(document, {
      fields: {
        lineItems: [
          { description: leaf('present') },
          { description: leaf('missing') },
          { description: leaf('hallucinated') },
        ],
      },
    });
    expect(overshoot.extraLineItems).toBe(1);
  });
});

describe('scoreFailure', () => {
  it('marks every field incorrect, grounding 0 where scoreable', () => {
    const document = doc([
      gtField({ path: 'a', value: 'x' }),
      gtField({ path: 'b', value: null }),
    ]);
    const { fields } = scoreFailure(document);
    expect(fields.every((f) => !f.valueCorrect)).toBe(true);
    expect(fields.find((f) => f.path === 'a')?.iou).toBe(0);
    expect(fields.find((f) => f.path === 'b')?.iou).toBeNull();
  });
});

describe('summarizeRun', () => {
  it('aggregates accuracy, grounding, and cost per schema', () => {
    const run: ModelRun = {
      model: 'test-model',
      docs: [
        {
          docId: 'cord/test/0',
          dataset: 'cord',
          schema: 'receipt',
          error: null,
          extraLineItems: 1,
          usage: { inputTokens: 1000, outputTokens: 500, modelCalls: 1, costUSD: 0.01 },
          fields: [
            { path: 'total', compare: 'money', expected: '1', predicted: '1', valueCorrect: true, iou: 0.8, predictedPage: 0 },
            { path: 'lineItems.0.amount', compare: 'money', expected: '2', predicted: '3', valueCorrect: false, iou: null, predictedPage: 0 },
            { path: 'lineItems.1.amount', compare: 'money', expected: '4', predicted: '4', valueCorrect: true, iou: 0.4, predictedPage: 0 },
          ],
        },
        {
          docId: 'cord/test/1',
          dataset: 'cord',
          schema: 'receipt',
          error: 'ExtractionFailedError: boom',
          extraLineItems: 0,
          usage: { inputTokens: 200, outputTokens: 0, modelCalls: 2, costUSD: 0.002 },
          fields: [
            { path: 'total', compare: 'money', expected: '1', predicted: null, valueCorrect: false, iou: 0, predictedPage: null },
          ],
        },
      ],
    };
    const summary = summarizeRun(run);
    const receipt = summary.perSchema.receipt;
    expect(receipt).toBeDefined();
    expect(receipt?.docs).toBe(2);
    expect(receipt?.failedDocs).toBe(1);
    expect(receipt?.fieldAccuracy).toBeCloseTo(2 / 4);
    expect(receipt?.grounding.scoreable).toBe(3);
    expect(receipt?.grounding.meanIoU).toBeCloseTo((0.8 + 0.4 + 0) / 3);
    expect(receipt?.grounding.hitAt50).toBeCloseTo(1 / 3);
    expect(receipt?.extraLineItems).toBe(1);
    expect(receipt?.cost.totalUSD).toBeCloseTo(0.012);
    expect(receipt?.cost.per1kDocsUSD).toBeCloseTo(6);
    // Line-item indices collapse into one field key.
    const amount = receipt?.perField.find((f) => f.field === 'lineItems[].amount');
    expect(amount).toEqual({ field: 'lineItems[].amount', accuracy: 0.5, count: 2 });
    expect(summary.perSchema.invoice).toBeUndefined();
  });
});
