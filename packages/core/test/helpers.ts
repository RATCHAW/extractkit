import { MockLanguageModelV4, simulateReadableStream } from 'ai/test';
import { PDFDocument } from 'pdf-lib';
import { expect } from 'vitest';

export function tinyPng(): Uint8Array {
  return new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]);
}

export function tinyJpeg(): Uint8Array {
  return new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);
}

export function tinyWebp(): Uint8Array {
  // RIFF....WEBP
  return new Uint8Array([0x52, 0x49, 0x46, 0x46, 0x1a, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50]);
}

export async function makePdf(pages: number): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i++) doc.addPage([200, 200]);
  return doc.save({ useObjectStreams: false });
}

function indexOfSeq(haystack: Uint8Array, needle: Uint8Array): number {
  outer: for (let i = 0; i <= haystack.length - needle.length; i++) {
    for (let j = 0; j < needle.length; j++) {
      if (haystack[i + j] !== needle[j]) continue outer;
    }
    return i;
  }
  return -1;
}

/** A structurally valid PDF whose trailer references an Encrypt dictionary. */
export async function makeEncryptedPdf(): Promise<Uint8Array> {
  const bytes = await makePdf(1);
  const marker = new TextEncoder().encode('trailer\n<<');
  const insert = new TextEncoder().encode('\n/Encrypt 1 0 R');
  const idx = indexOfSeq(bytes, marker);
  if (idx < 0) throw new Error('fixture bug: PDF trailer not found');
  const at = idx + marker.length;
  const out = new Uint8Array(bytes.length + insert.length);
  out.set(bytes.subarray(0, at), 0);
  out.set(insert, at);
  out.set(bytes.subarray(at), at + insert.length);
  return out;
}

export interface UsageSpec {
  input: number;
  output: number;
}

export function mockUsage({ input, output }: UsageSpec) {
  return {
    inputTokens: { total: input, noCache: input, cacheRead: undefined, cacheWrite: undefined },
    outputTokens: { total: output, text: output, reasoning: undefined },
  };
}

export function textResponse(text: string, usage: UsageSpec = { input: 10, output: 20 }) {
  return {
    content: [{ type: 'text' as const, text }],
    finishReason: { unified: 'stop' as const, raw: undefined },
    usage: mockUsage(usage),
    warnings: [],
  };
}

/** A mock model that replies with each text in order (repeating the last). */
export function sequenceModel(texts: string[], usage?: UsageSpec) {
  const prompts: unknown[] = [];
  const model = new MockLanguageModelV4({
    doGenerate: async (options: { prompt: unknown }) => {
      prompts.push(options.prompt);
      const i = Math.min(prompts.length - 1, texts.length - 1);
      return textResponse(texts[i] as string, usage);
    },
  });
  return { model, prompts, calls: () => prompts.length };
}

export function streamModel(deltas: string[], usage: UsageSpec = { input: 5, output: 15 }) {
  return new MockLanguageModelV4({
    doStream: async () => ({
      stream: simulateReadableStream({
        chunks: [
          { type: 'text-start' as const, id: '1' },
          ...deltas.map((delta) => ({ type: 'text-delta' as const, id: '1', delta })),
          { type: 'text-end' as const, id: '1' },
          {
            type: 'finish' as const,
            finishReason: { unified: 'stop' as const, raw: undefined },
            usage: mockUsage(usage),
          },
        ],
      }),
    }),
  });
}

export function splitEvery(text: string, size: number): string[] {
  const parts: string[] = [];
  for (let i = 0; i < text.length; i += size) parts.push(text.slice(i, i + size));
  return parts;
}

/** Wire-format leaf wrapper with plausible provenance defaults. */
export function wireLeaf(value: unknown, over: Record<string, unknown> = {}) {
  const missing = value == null;
  return {
    value,
    page: missing ? null : 0,
    bbox: missing ? null : [0.1, 0.2, 0.4, 0.3],
    confidence: missing ? 0 : 0.9,
    ...over,
  };
}

export function envelopeJson(fields: unknown, over: Record<string, unknown> = {}): string {
  return JSON.stringify({ readable: true, issues: [], fields, ...over });
}

export async function expectError<T extends Error>(
  promise: Promise<unknown>,
  cls: abstract new (...args: never[]) => T,
): Promise<T> {
  try {
    await promise;
  } catch (err) {
    expect(err).toBeInstanceOf(cls);
    return err as T;
  }
  throw new Error(`Expected ${cls.name} to be thrown`);
}
