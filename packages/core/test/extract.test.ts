import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { extract } from '../src/extract.js';
import {
  DocumentError,
  DocumentUnreadableError,
  ExtractionFailedError,
  MissingRequiredFieldsError,
  UnsupportedSchemaError,
} from '../src/errors.js';
import { envelopeJson, expectError, makePdf, sequenceModel, tinyPng, wireLeaf } from './helpers.js';

const schema = z.object({
  vendor: z.string(),
  total: z.number().min(0),
  notes: z.string().nullable(),
  currency: z.enum(['USD', 'EUR']).optional(),
});

const goodFields = {
  vendor: wireLeaf('ACME Corp'),
  total: wireLeaf(41.5),
  notes: wireLeaf(null),
  currency: wireLeaf('USD'),
};

describe('extract', () => {
  it('extracts, validates, and returns provenance and usage', async () => {
    const { model, calls } = sequenceModel([envelopeJson(goodFields)]);
    const result = await extract({ schema, document: { data: tinyPng() }, model });

    expect(result.data).toEqual({ vendor: 'ACME Corp', total: 41.5, notes: null, currency: 'USD' });
    expect(result.fields.vendor).toEqual({
      value: 'ACME Corp',
      confidence: 0.9,
      page: 0,
      bbox: { x0: 0.1, y0: 0.2, x1: 0.4, y1: 0.3 },
    });
    expect(result.fields.notes.value).toBeNull();
    expect(result.pages).toBe(1);
    expect(result.issues).toEqual([]);
    expect(result.usage).toEqual({ inputTokens: 10, outputTokens: 20, totalTokens: 30, modelCalls: 1, costUSD: null });
    expect(calls()).toBe(1);
  });

  it('computes cost only when pricing is provided', async () => {
    const { model } = sequenceModel([envelopeJson(goodFields)]);
    const result = await extract({
      schema,
      document: { data: tinyPng() },
      model,
      pricing: { inputPerMTokUSD: 3, outputPerMTokUSD: 15 },
    });
    expect(result.usage.costUSD).toBeCloseTo((10 * 3 + 20 * 15) / 1_000_000, 10);
  });

  it('validates model-reported pages against the real PDF page count', async () => {
    const fields = { ...goodFields, vendor: wireLeaf('ACME Corp', { page: 5 }) };
    const { model } = sequenceModel([envelopeJson(fields)]);
    const result = await extract({ schema, document: { data: await makePdf(2) }, model });

    expect(result.pages).toBe(2);
    expect(result.fields.vendor.page).toBeNull();
    expect(result.fields.vendor.bbox).toBeNull();
    expect(result.issues.some((i) => i.includes('$.vendor') && i.includes('page 5'))).toBe(true);
  });

  it('repairs unparseable output and accumulates usage across attempts', async () => {
    const { model, prompts, calls } = sequenceModel(['this is not json', envelopeJson(goodFields)]);
    const result = await extract({ schema, document: { data: tinyPng() }, model });

    expect(result.data.vendor).toBe('ACME Corp');
    expect(calls()).toBe(2);
    expect(result.usage.modelCalls).toBe(2);
    expect(result.usage.inputTokens).toBe(20);
    expect(result.usage.outputTokens).toBe(40);
    // The repair call carries the failed attempt and the correction request.
    expect((prompts[1] as unknown[]).length).toBe((prompts[0] as unknown[]).length + 2);
  });

  it('repairs schema-validation failures with the violation details', async () => {
    const belowMin = { ...goodFields, total: wireLeaf(-5) };
    const { model, calls } = sequenceModel([envelopeJson(belowMin), envelopeJson(goodFields)]);
    const result = await extract({ schema, document: { data: tinyPng() }, model });

    expect(result.data.total).toBe(41.5);
    expect(calls()).toBe(2);
  });

  it('throws ExtractionFailedError when repairs are exhausted', async () => {
    const { model, calls } = sequenceModel(['still not json']);
    const err = await expectError(
      extract({ schema, document: { data: tinyPng() }, model, maxRepairAttempts: 0 }),
      ExtractionFailedError,
    );
    expect(err.code).toBe('EXTRACTION_FAILED');
    expect(err.attempts).toBe(1);
    expect(err.rawText).toBe('still not json');
    expect(err.usage.modelCalls).toBe(1);
    expect(calls()).toBe(1);
  });

  it('throws MissingRequiredFieldsError with the partial extraction', async () => {
    const missingTotal = { ...goodFields, total: wireLeaf(null) };
    const { model, calls } = sequenceModel([envelopeJson(missingTotal)]);
    const err = await expectError(
      extract({ schema, document: { data: tinyPng() }, model }),
      MissingRequiredFieldsError,
    );
    expect(err.missingPaths).toEqual(['$.total']);
    expect((err.partial.data as { vendor: string }).vendor).toBe('ACME Corp');
    expect(calls()).toBe(2); // the repair attempt also came back without the field
  });

  it('throws DocumentUnreadableError without repairing', async () => {
    const nulls = {
      vendor: wireLeaf(null),
      total: wireLeaf(null),
      notes: wireLeaf(null),
      currency: wireLeaf(null),
    };
    const { model, calls } = sequenceModel([envelopeJson(nulls, { readable: false, issues: ['blank page'] })]);
    const err = await expectError(extract({ schema, document: { data: tinyPng() }, model }), DocumentUnreadableError);
    expect(err.code).toBe('DOCUMENT_UNREADABLE');
    expect(err.issues).toEqual(['blank page']);
    expect(err.message).toContain('blank page');
    expect(err.usage.modelCalls).toBe(1);
    expect(calls()).toBe(1);
  });

  it('merges model-reported issues with provenance issues', async () => {
    const fields = { ...goodFields, vendor: wireLeaf('ACME Corp', { confidence: 2 }) };
    const { model } = sequenceModel([envelopeJson(fields, { issues: ['document is skewed'] })]);
    const result = await extract({ schema, document: { data: tinyPng() }, model });
    expect(result.issues.some((i) => i === 'document is skewed')).toBe(true);
    expect(result.issues.some((i) => i.includes('confidence'))).toBe(true);
  });

  it('rejects bad documents before calling the model', async () => {
    const { model, calls } = sequenceModel([envelopeJson(goodFields)]);
    const err = await expectError(
      extract({ schema, document: { data: tinyPng(), mediaType: 'application/pdf' }, model }),
      DocumentError,
    );
    expect(err.code).toBe('MEDIA_TYPE_MISMATCH');
    expect(calls()).toBe(0);
  });

  it('rejects unsupported schemas before calling the model', async () => {
    const { model, calls } = sequenceModel([envelopeJson(goodFields)]);
    const bad = z.object({ when: z.date() });
    await expectError(extract({ schema: bad, document: { data: tinyPng() }, model }), UnsupportedSchemaError);
    expect(calls()).toBe(0);
  });
});
