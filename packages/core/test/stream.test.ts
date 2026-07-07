import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { DocumentUnreadableError, ExtractionFailedError } from '../src/errors.js';
import { streamExtract } from '../src/stream.js';
import type { ExtractStreamEvent } from '../src/types.js';
import { envelopeJson, expectError, splitEvery, streamModel, tinyPng, wireLeaf } from './helpers.js';

const schema = z.object({
  vendor: z.string(),
  total: z.number(),
  lineItems: z.array(z.object({ description: z.string() })),
});

const goodFields = {
  vendor: wireLeaf('ACME Corp'),
  total: wireLeaf(41.5),
  lineItems: [{ description: wireLeaf('Widget') }, { description: wireLeaf('Gadget') }],
};

async function collect(stream: AsyncIterable<ExtractStreamEvent>): Promise<ExtractStreamEvent[]> {
  const events: ExtractStreamEvent[] = [];
  for await (const event of stream) events.push(event);
  return events;
}

describe('streamExtract', () => {
  it('emits one field event per leaf, in document order, then resolves the result', async () => {
    // 7-char chunks force wrapper keys and string values to split mid-token.
    const model = streamModel(splitEvery(envelopeJson(goodFields), 7));
    const stream = streamExtract({ schema, document: { data: tinyPng() }, model });

    const events = await collect(stream);
    expect(events.map((e) => e.path)).toEqual([
      ['vendor'],
      ['total'],
      ['lineItems', 0, 'description'],
      ['lineItems', 1, 'description'],
    ]);
    expect(events[0]?.field).toEqual({
      value: 'ACME Corp',
      confidence: 0.9,
      page: 0,
      bbox: { x0: 0.1, y0: 0.2, x1: 0.4, y1: 0.3 },
    });

    const result = await stream.result;
    expect(result.data).toEqual({
      vendor: 'ACME Corp',
      total: 41.5,
      lineItems: [{ description: 'Widget' }, { description: 'Gadget' }],
    });
    expect(result.usage.modelCalls).toBe(1);
    expect(result.usage.inputTokens).toBe(5);
    expect(result.usage.outputTokens).toBe(15);
  });

  it('does not emit events for fields the model could not find', async () => {
    const withMissing = { ...goodFields, total: wireLeaf(null) };
    const model = streamModel(splitEvery(envelopeJson(withMissing), 11));
    const stream = streamExtract({
      schema: z.object({ vendor: z.string(), total: z.number().optional(), lineItems: z.array(z.object({ description: z.string() })) }),
      document: { data: tinyPng() },
      model,
    });
    const events = await collect(stream);
    expect(events.some((e) => e.path.join('.') === 'total')).toBe(false);
    const result = await stream.result;
    expect(result.data).not.toHaveProperty('total');
  });

  it('fails both the iterator and the result on invalid final output', async () => {
    const model = streamModel(splitEvery('{ definitely not the schema', 5));
    const stream = streamExtract({ schema, document: { data: tinyPng() }, model });

    await expectError(collect(stream), ExtractionFailedError);
    const err = await expectError(stream.result, ExtractionFailedError);
    expect(err.code).toBe('EXTRACTION_FAILED');
    expect(err.attempts).toBe(1);
  });

  it('rejects with DocumentUnreadableError when the model says so', async () => {
    const nulls = {
      vendor: wireLeaf(null),
      total: wireLeaf(null),
      lineItems: [],
    };
    const model = streamModel(splitEvery(envelopeJson(nulls, { readable: false, issues: ['photo of a cat, not a document'] }), 9));
    const stream = streamExtract({ schema, document: { data: tinyPng() }, model });

    const events = await collect(stream).catch(() => []);
    expect(events).toEqual([]);
    const err = await expectError(stream.result, DocumentUnreadableError);
    expect(err.issues).toEqual(['photo of a cat, not a document']);
  });

  it('reports missing required fields through the result promise', async () => {
    const withMissing = { ...goodFields, total: wireLeaf(null) };
    const model = streamModel(splitEvery(envelopeJson(withMissing), 8));
    const stream = streamExtract({ schema, document: { data: tinyPng() }, model });
    const err = await expectError(stream.result, Error);
    expect((err as { code?: string }).code).toBe('MISSING_REQUIRED_FIELDS');
    // Iterating after failure surfaces the same error.
    await expectError(collect(stream), Error);
  });
});
