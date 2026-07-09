import { MockLanguageModelV4 } from 'ai/test';
import { describe, expect, it } from 'vitest';
import { runModel } from '../src/runner.js';
import type { EvalDocument, GroundTruthField } from '../src/types.js';

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]);

function wireLeaf(value: unknown) {
  return value === null
    ? { value: null, page: null, bbox: null, confidence: 0 }
    : { value, page: 0, bbox: [0.1, 0.1, 0.5, 0.2], confidence: 0.9 };
}

function receiptEnvelope(total: string): string {
  return JSON.stringify({
    readable: true,
    issues: [],
    fields: {
      lineItems: [
        {
          description: wireLeaf('TICKET CP'),
          quantity: wireLeaf('2'),
          unitPrice: wireLeaf(null),
          amount: wireLeaf('60.000'),
        },
      ],
      subtotal: wireLeaf(null),
      discount: wireLeaf(null),
      serviceCharge: wireLeaf(null),
      tax: wireLeaf(null),
      total: wireLeaf(total),
    },
  });
}

function textModel(texts: string[]) {
  let call = 0;
  return new MockLanguageModelV4({
    doGenerate: async () => ({
      content: [{ type: 'text' as const, text: texts[Math.min(call++, texts.length - 1)] as string }],
      finishReason: { unified: 'stop' as const, raw: undefined },
      usage: {
        inputTokens: { total: 1000, noCache: 1000, cacheRead: undefined, cacheWrite: undefined },
        outputTokens: { total: 100, text: 100, reasoning: undefined },
      },
      warnings: [],
    }),
  });
}

const REGION = { page: 0, bbox: { x0: 0.1, y0: 0.1, x1: 0.5, y1: 0.2 } };

function receiptDoc(id: string): EvalDocument {
  const fields: GroundTruthField[] = [
    { path: 'lineItems.0.description', value: 'TICKET CP', compare: 'text', regions: [REGION] },
    { path: 'lineItems.0.quantity', value: '2', compare: 'count', regions: [REGION] },
    { path: 'lineItems.0.unitPrice', value: null, compare: 'money', regions: [] },
    { path: 'lineItems.0.amount', value: '60.000', compare: 'money', regions: [REGION] },
    { path: 'subtotal', value: null, compare: 'money', regions: [] },
    { path: 'discount', value: null, compare: 'money', regions: [] },
    { path: 'serviceCharge', value: null, compare: 'money', regions: [] },
    { path: 'tax', value: null, compare: 'money', regions: [] },
    { path: 'total', value: '60.000', compare: 'money', regions: [REGION] },
  ];
  return {
    id,
    dataset: 'cord',
    schema: 'receipt',
    bytes: PNG,
    mediaType: 'image/png',
    pages: 1,
    fields,
    lineItemCount: 1,
  };
}

describe('runModel', () => {
  it('extracts, scores, and reports usage with pricing', async () => {
    const run = await runModel(
      {
        name: 'mock',
        model: textModel([receiptEnvelope('60.000')]),
        pricing: { inputPerMTokUSD: 3, outputPerMTokUSD: 15 },
      },
      [receiptDoc('cord/test/0')],
    );
    expect(run.model).toBe('mock');
    const [doc] = run.docs;
    expect(doc?.error).toBeNull();
    expect(doc?.fields.every((f) => f.valueCorrect)).toBe(true);
    expect(doc?.fields.find((f) => f.path === 'total')?.iou).toBe(1);
    expect(doc?.extraLineItems).toBe(0);
    expect(doc?.usage).toMatchObject({ inputTokens: 1000, outputTokens: 100, modelCalls: 1 });
    expect(doc?.usage?.costUSD).toBeCloseTo(1000 * (3 / 1e6) + 100 * (15 / 1e6), 10);
  });

  it('records the error and scores all fields wrong when extraction fails', async () => {
    const run = await runModel(
      { name: 'mock', model: textModel(['not json', 'still not json']) },
      [receiptDoc('cord/test/1')],
    );
    const [doc] = run.docs;
    expect(doc?.error).toContain('ExtractionFailedError');
    expect(doc?.fields.every((f) => !f.valueCorrect)).toBe(true);
    // Usage from the failed attempts is still recorded.
    expect(doc?.usage?.modelCalls).toBe(2);
  });

  it('keeps document order with concurrency', async () => {
    const docs = ['a', 'b', 'c', 'd'].map((s) => receiptDoc(`cord/test/${s}`));
    const run = await runModel({ name: 'mock', model: textModel([receiptEnvelope('60.000')]) }, docs, {
      concurrency: 3,
    });
    expect(run.docs.map((d) => d.docId)).toEqual(docs.map((d) => d.id));
  });
});
