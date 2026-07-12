import { describe, expect, it } from 'vitest';
import { readSSE } from '../src/client/lib/sse';

function streamFrom(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}

async function collect(chunks: string[]) {
  const out: Array<{ event: string; data: string }> = [];
  for await (const message of readSSE(streamFrom(chunks))) out.push(message);
  return out;
}

describe('readSSE', () => {
  it('parses event and data fields', async () => {
    const out = await collect(['event: field\ndata: {"a":1}\n\n', 'event: result\ndata: {"b":2}\n\n']);
    expect(out).toEqual([
      { event: 'field', data: '{"a":1}' },
      { event: 'result', data: '{"b":2}' },
    ]);
  });

  it('reassembles records split across chunk boundaries', async () => {
    const out = await collect(['event: fie', 'ld\ndata: {"a"', ':1}\n\nevent: result\ndata:{"b":2}\n\n']);
    expect(out.map((m) => m.event)).toEqual(['field', 'result']);
    expect(out[0]?.data).toBe('{"a":1}');
    expect(out[1]?.data).toBe('{"b":2}');
  });

  it('defaults the event name and ignores comments and blank lines', async () => {
    const out = await collect([': keep-alive\ndata: hello\n\n']);
    expect(out).toEqual([{ event: 'message', data: 'hello' }]);
  });

  it('joins multi-line data with newlines', async () => {
    const out = await collect(['data: line1\ndata: line2\n\n']);
    expect(out[0]?.data).toBe('line1\nline2');
  });

  it('handles CRLF line endings across multiple records', async () => {
    const out = await collect(['event: field\r\ndata: {"a":1}\r\n\r\nevent: result\r\ndata: {"b":2}\r\n\r\n']);
    expect(out).toEqual([
      { event: 'field', data: '{"a":1}' },
      { event: 'result', data: '{"b":2}' },
    ]);
  });

  it('handles a CRLF pair split across chunk boundaries', async () => {
    const out = await collect(['event: field\r\ndata: {"a":1}\r', '\n\r\nevent: result\r\ndata: {"b":2}\r\n\r\n']);
    expect(out.map((m) => m.event)).toEqual(['field', 'result']);
  });

  it('emits a trailing record with no final blank line', async () => {
    const out = await collect(['event: result\ndata: done']);
    expect(out).toEqual([{ event: 'result', data: 'done' }]);
  });
});
