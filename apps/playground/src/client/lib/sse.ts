export interface SSEMessage {
  event: string;
  data: string;
}

function parseRecord(raw: string): SSEMessage | null {
  let event = 'message';
  const dataLines: string[] = [];
  for (const line of raw.replace(/\r/g, '').split('\n')) {
    if (line === '' || line.startsWith(':')) continue;
    if (line.startsWith('event:')) {
      event = line.slice('event:'.length).trim();
    } else if (line.startsWith('data:')) {
      dataLines.push(line.slice('data:'.length).replace(/^ /, ''));
    }
  }
  if (dataLines.length === 0) return null;
  return { event, data: dataLines.join('\n') };
}

/**
 * Parses a `fetch` response body as a Server-Sent Events stream, yielding one
 * message per `\n\n`-delimited record. Enough of the SSE grammar for the
 * playground's own server: `event:` and `data:` fields, comment lines ignored.
 */
export async function* readSSE(body: ReadableStream<Uint8Array>): AsyncGenerator<SSEMessage> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      // Fold CRLF to LF so records split on \n\n regardless of line endings. A
      // trailing lone \r is left for the next chunk's \n to complete the pair.
      buffer = buffer.replace(/\r\n/g, '\n');
      let boundary = buffer.indexOf('\n\n');
      while (boundary !== -1) {
        const record = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const message = parseRecord(record);
        if (message !== null) yield message;
        boundary = buffer.indexOf('\n\n');
      }
    }
    buffer += decoder.decode();
    const tail = parseRecord(buffer);
    if (tail !== null) yield tail;
  } finally {
    reader.releaseLock();
  }
}
