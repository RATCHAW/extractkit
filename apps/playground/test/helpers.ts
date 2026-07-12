import { MockLanguageModelV4, simulateReadableStream } from 'ai/test';
import type { LanguageModel } from 'ai';
import type { Pricing } from '@ratchaw/extractkit';
import type { PlaygroundModel } from '../src/server/models';

/** A 12-byte buffer with a valid PNG signature — enough for normalizeDocument. */
export function tinyPng(): Uint8Array<ArrayBuffer> {
  return new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]);
}

function splitEvery(text: string, size: number): string[] {
  const parts: string[] = [];
  for (let i = 0; i < text.length; i += size) parts.push(text.slice(i, i + size));
  return parts;
}

/** A mock model that streams `text` back in small chunks as one response. */
export function streamingModel(text: string): LanguageModel {
  return new MockLanguageModelV4({
    doStream: async () => ({
      stream: simulateReadableStream({
        chunks: [
          { type: 'text-start' as const, id: '1' },
          ...splitEvery(text, 24).map((delta) => ({ type: 'text-delta' as const, id: '1', delta })),
          { type: 'text-end' as const, id: '1' },
          {
            type: 'finish' as const,
            finishReason: { unified: 'stop' as const, raw: undefined },
            usage: {
              inputTokens: { total: 800, noCache: 800, cacheRead: undefined, cacheWrite: undefined },
              outputTokens: { total: 200, text: 200, reasoning: undefined },
            },
          },
        ],
      }),
    }),
  });
}

/** Wire-format leaf with plausible provenance defaults (bbox is a 4-number array). */
export function wireLeaf(value: unknown, over: Record<string, unknown> = {}) {
  const missing = value === null || value === undefined;
  return {
    value,
    page: missing ? null : 0,
    bbox: missing ? null : [0.1, 0.2, 0.4, 0.26],
    confidence: missing ? 0 : 0.94,
    ...over,
  };
}

/** Valid wire `fields` for the invoice preset schema (every leaf present). */
function invoiceFields() {
  return {
    vendorName: wireLeaf('Acme Corp', { bbox: [0.08, 0.05, 0.4, 0.09] }),
    invoiceNumber: wireLeaf('INV-2026-014', { bbox: [0.62, 0.05, 0.92, 0.09] }),
    issueDate: wireLeaf('2026-07-01'),
    dueDate: wireLeaf('2026-07-31'),
    currency: wireLeaf('USD'),
    subtotal: wireLeaf('1,200.00'),
    tax: wireLeaf('50.50'),
    total: wireLeaf('1,250.50', { bbox: [0.7, 0.8, 0.92, 0.84], confidence: 0.99 }),
    lineItems: [
      {
        description: wireLeaf('Consulting services', { bbox: [0.08, 0.4, 0.5, 0.44] }),
        quantity: wireLeaf('10'),
        unitPrice: wireLeaf('120.00'),
        amount: wireLeaf('1,200.00'),
      },
    ],
  };
}

/** A complete, valid wire envelope for the invoice preset schema. */
export function invoiceEnvelope(): string {
  return JSON.stringify({ readable: true, issues: [], fields: invoiceFields() });
}

/**
 * An "unreadable document" envelope: the wire schema still requires `fields`, so
 * they are present and valid — only the `readable` flag drives the error.
 */
export function unreadableEnvelope(): string {
  return JSON.stringify({ readable: false, issues: ['Page is blank.'], fields: invoiceFields() });
}

/** An invoice envelope where the required `total` was not found. */
export function missingTotalEnvelope(): string {
  const fields = invoiceFields();
  fields.total = wireLeaf(null);
  return JSON.stringify({ readable: true, issues: [], fields });
}

const DEMO_PRICING: Pricing = { inputPerMTokUSD: 3, outputPerMTokUSD: 15 };

/** A PlaygroundModel backed by a mock that streams `envelope`. */
export function mockPlaygroundModel(id: string, envelope: string): PlaygroundModel {
  return {
    id,
    label: id,
    provider: 'mock',
    pricing: DEMO_PRICING,
    create: () => streamingModel(envelope),
  };
}
