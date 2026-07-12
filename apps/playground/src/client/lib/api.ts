import type { ConfigResponse, ExtractEvent } from '../../shared/api';
import { readSSE } from './sse';

/** Fetches the available schemas and models. */
export async function fetchConfig(signal?: AbortSignal): Promise<ConfigResponse> {
  const res = await fetch('/api/config', signal ? { signal } : undefined);
  if (!res.ok) throw new Error(`Failed to load config (${res.status}).`);
  return (await res.json()) as ConfigResponse;
}

export interface ExtractInput {
  file: File;
  schema: string;
  model: string;
  signal?: AbortSignal;
}

/**
 * Runs an extraction and yields each streamed event. Request-level failures
 * (bad input, too large) come back as a single synthetic `error` event so
 * callers only handle one shape.
 */
export async function* runExtract(input: ExtractInput): AsyncGenerator<ExtractEvent> {
  const form = new FormData();
  form.set('file', input.file);
  form.set('schema', input.schema);
  form.set('model', input.model);

  const res = await fetch('/api/extract', {
    method: 'POST',
    body: form,
    ...(input.signal ? { signal: input.signal } : {}),
  });

  if (!res.ok || res.body === null) {
    let message = `Extraction request failed (${res.status}).`;
    try {
      const body = (await res.json()) as { error?: string };
      if (typeof body.error === 'string') message = body.error;
    } catch {
      // Non-JSON error body; keep the status-based message.
    }
    yield { type: 'error', error: { name: 'RequestError', code: null, message } };
    return;
  }

  for await (const message of readSSE(res.body)) {
    yield JSON.parse(message.data) as ExtractEvent;
  }
}
