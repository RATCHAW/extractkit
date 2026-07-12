import { describe, expect, it } from 'vitest';
import type { ConfigResponse, ExtractEvent } from '../src/shared/api';
import { createApp } from '../src/server/app';
import { readSSE } from '../src/client/lib/sse';
import { invoiceEnvelope, missingTotalEnvelope, mockPlaygroundModel, tinyPng, unreadableEnvelope } from './helpers';

function appWith(envelope: string) {
  return createApp({ models: [mockPlaygroundModel('mock-model', envelope)] });
}

function extractForm(opts: { file?: Blob; schema?: string; model?: string }): FormData {
  const form = new FormData();
  if (opts.file !== undefined) form.set('file', opts.file, 'doc.png');
  if (opts.schema !== undefined) form.set('schema', opts.schema);
  if (opts.model !== undefined) form.set('model', opts.model);
  return form;
}

function pngFile(): File {
  return new File([tinyPng()], 'doc.png', { type: 'image/png' });
}

async function collectEvents(body: ReadableStream<Uint8Array>): Promise<ExtractEvent[]> {
  const events: ExtractEvent[] = [];
  for await (const msg of readSSE(body)) {
    events.push(JSON.parse(msg.data) as ExtractEvent);
  }
  return events;
}

describe('GET /api/config', () => {
  it('returns preset schemas, injected models, and defaults', async () => {
    const app = appWith(invoiceEnvelope());
    const res = await app.request('/api/config');
    expect(res.status).toBe(200);
    const body = (await res.json()) as ConfigResponse;

    expect(body.schemas.map((s) => s.id)).toEqual(['invoice', 'receipt']);
    const invoice = body.schemas.find((s) => s.id === 'invoice');
    expect(invoice?.topLevelFields).toContain('total');
    expect(body.models).toEqual([{ id: 'mock-model', label: 'mock-model', provider: 'mock' }]);
    expect(body.defaults).toEqual({ schema: 'invoice', model: 'mock-model' });
  });

  it('reports a null default model when no keys are set', async () => {
    const app = createApp({ models: [] });
    const body = (await (await app.request('/api/config')).json()) as ConfigResponse;
    expect(body.models).toEqual([]);
    expect(body.defaults.model).toBeNull();
  });
});

describe('POST /api/extract', () => {
  it('streams field events then a validated result', async () => {
    const app = appWith(invoiceEnvelope());
    const res = await app.request('/api/extract', {
      method: 'POST',
      body: extractForm({ file: pngFile(), schema: 'invoice', model: 'mock-model' }),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/event-stream');

    const events = await collectEvents(res.body as ReadableStream<Uint8Array>);
    const fields = events.filter((e) => e.type === 'field');
    const terminal = events.at(-1);

    expect(fields.length).toBeGreaterThan(0);
    expect(terminal?.type).toBe('result');
    if (terminal?.type !== 'result') throw new Error('expected a result event');

    const data = terminal.result.data as { total: string; vendorName: string; lineItems: unknown[] };
    expect(data.total).toBe('1,250.50');
    expect(data.vendorName).toBe('Acme Corp');
    expect(data.lineItems).toHaveLength(1);
    expect(terminal.result.pages).toBe(1);
    // pricing was supplied, so cost is computed from the mock's token usage.
    expect(terminal.result.usage.costUSD).toBeCloseTo((800 * 3 + 200 * 15) / 1_000_000, 10);
  });

  it('carries per-field provenance through to the result', async () => {
    const app = appWith(invoiceEnvelope());
    const res = await app.request('/api/extract', {
      method: 'POST',
      body: extractForm({ file: pngFile(), schema: 'invoice', model: 'mock-model' }),
    });
    const events = await collectEvents(res.body as ReadableStream<Uint8Array>);
    const terminal = events.at(-1);
    if (terminal?.type !== 'result') throw new Error('expected a result event');

    const fields = terminal.result.fields as { total: { page: number; bbox: { x0: number } } };
    expect(fields.total.page).toBe(0);
    expect(fields.total.bbox.x0).toBeCloseTo(0.7, 10);
  });

  it('emits an error event when the model reports the document unreadable', async () => {
    const app = appWith(unreadableEnvelope());
    const res = await app.request('/api/extract', {
      method: 'POST',
      body: extractForm({ file: pngFile(), schema: 'invoice', model: 'mock-model' }),
    });
    expect(res.status).toBe(200);
    const events = await collectEvents(res.body as ReadableStream<Uint8Array>);
    const terminal = events.at(-1);
    if (terminal?.type !== 'error') throw new Error('expected an error event');
    expect(terminal.error.code).toBe('DOCUMENT_UNREADABLE');
  });

  it('carries the partial extraction on a missing-required-fields error', async () => {
    const app = appWith(missingTotalEnvelope());
    const res = await app.request('/api/extract', {
      method: 'POST',
      body: extractForm({ file: pngFile(), schema: 'invoice', model: 'mock-model' }),
    });
    const events = await collectEvents(res.body as ReadableStream<Uint8Array>);
    const terminal = events.at(-1);
    if (terminal?.type !== 'error') throw new Error('expected an error event');

    expect(terminal.error.code).toBe('MISSING_REQUIRED_FIELDS');
    expect(terminal.error.missingPaths).toEqual(['$.total']);
    const partial = terminal.error.partial;
    expect(partial).toBeDefined();
    expect((partial?.data as { vendorName: string }).vendorName).toBe('Acme Corp');
    const fields = partial?.fields as { vendorName: { bbox: { x0: number } } };
    expect(fields.vendorName.bbox.x0).toBeCloseTo(0.08, 10);
    expect(partial?.usage.modelCalls).toBeGreaterThan(0);
  });

  it('rejects an unknown schema id with 400', async () => {
    const app = appWith(invoiceEnvelope());
    const res = await app.request('/api/extract', {
      method: 'POST',
      body: extractForm({ file: pngFile(), schema: 'nope', model: 'mock-model' }),
    });
    expect(res.status).toBe(400);
  });

  it('rejects an unknown model id with 400', async () => {
    const app = appWith(invoiceEnvelope());
    const res = await app.request('/api/extract', {
      method: 'POST',
      body: extractForm({ file: pngFile(), schema: 'invoice', model: 'ghost' }),
    });
    expect(res.status).toBe(400);
  });

  it('rejects a request with no file with 400', async () => {
    const app = appWith(invoiceEnvelope());
    const res = await app.request('/api/extract', {
      method: 'POST',
      body: extractForm({ schema: 'invoice', model: 'mock-model' }),
    });
    expect(res.status).toBe(400);
  });
});
