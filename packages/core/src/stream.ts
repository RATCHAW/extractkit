import { NoObjectGeneratedError, Output, streamText } from 'ai';
import type { z } from 'zod';
import { normalizeDocument } from './document.js';
import { DocumentUnreadableError, ExtractionFailedError, MissingRequiredFieldsError } from './errors.js';
import { buildSystemPrompt, buildUserMessage } from './prompt.js';
import {
  buildWireSchema,
  collectCompletedLeaves,
  isOnlyMissingFields,
  unwrapWireOutput,
  zodIssueSummaries,
  type WireEnvelope,
} from './schema.js';
import type { ExtractOptions, ExtractResult, ExtractStream, ExtractStreamEvent, FieldMap } from './types.js';
import { addUsage, createUsage, finalizeUsage } from './usage.js';

class AsyncQueue<T> implements AsyncIterableIterator<T> {
  private readonly buffer: T[] = [];
  private readonly takers: Array<{
    resolve: (result: IteratorResult<T>) => void;
    reject: (err: unknown) => void;
  }> = [];
  private closed = false;
  private failure: { err: unknown } | null = null;

  push(value: T): void {
    if (this.closed || this.failure != null) return;
    const taker = this.takers.shift();
    if (taker != null) taker.resolve({ value, done: false });
    else this.buffer.push(value);
  }

  close(): void {
    if (this.closed || this.failure != null) return;
    this.closed = true;
    for (const taker of this.takers.splice(0)) taker.resolve({ value: undefined, done: true });
  }

  fail(err: unknown): void {
    if (this.closed || this.failure != null) return;
    this.failure = { err };
    for (const taker of this.takers.splice(0)) taker.reject(err);
  }

  next(): Promise<IteratorResult<T>> {
    if (this.buffer.length > 0) {
      return Promise.resolve({ value: this.buffer.shift() as T, done: false });
    }
    if (this.failure != null) return Promise.reject(this.failure.err);
    if (this.closed) return Promise.resolve({ value: undefined, done: true });
    return new Promise((resolve, reject) => this.takers.push({ resolve, reject }));
  }

  [Symbol.asyncIterator](): this {
    return this;
  }
}

/**
 * Streaming variant of extract(): emits a `field` event as each leaf's
 * provenance wrapper completes, and resolves `result` with the same validated
 * result extract() returns. Single-consumer. Streaming does not repair
 * invalid output; use extract() when repair matters more than latency.
 */
export function streamExtract<S extends z.ZodObject>(options: ExtractOptions<S>): ExtractStream<S> {
  const queue = new AsyncQueue<ExtractStreamEvent>();
  const result = run(options, queue);
  // The queue surfaces the same failure to iterating consumers; without this
  // a caller that only iterates would get an unhandled rejection warning.
  result.catch(() => {});
  return {
    [Symbol.asyncIterator]: () => queue,
    result,
  };
}

async function run<S extends z.ZodObject>(
  options: ExtractOptions<S>,
  queue: AsyncQueue<ExtractStreamEvent>,
): Promise<ExtractResult<S>> {
  try {
    const { schema, pricing } = options;
    const wire = buildWireSchema(schema);
    const doc = await normalizeDocument(options.document);
    const output = Output.object({
      schema: wire,
      name: options.schemaName ?? 'document_extraction',
      ...(options.schemaDescription != null ? { description: options.schemaDescription } : {}),
    });
    const usage = createUsage();

    const res = streamText({
      model: options.model,
      system: buildSystemPrompt(options.instructions),
      messages: [buildUserMessage(doc)],
      output,
      ...(options.temperature != null ? { temperature: options.temperature } : {}),
      ...(options.maxRetries != null ? { maxRetries: options.maxRetries } : {}),
      ...(options.abortSignal != null ? { abortSignal: options.abortSignal } : {}),
    });

    const emitted = new Set<string>();
    for await (const partial of res.partialOutputStream) {
      const fields = (partial as Partial<WireEnvelope> | undefined)?.fields;
      if (fields == null) continue;
      collectCompletedLeaves(schema, fields, doc.pages, emitted, (path, field) =>
        queue.push({ type: 'field', path, field }),
      );
    }

    let envelope: WireEnvelope;
    try {
      envelope = (await res.output) as unknown as WireEnvelope;
    } catch (err) {
      if (NoObjectGeneratedError.isInstance(err)) {
        usage.modelCalls = 1;
        addUsage(usage, err.usage);
        throw new ExtractionFailedError(
          'Model output was not valid extraction JSON. Streaming does not repair; use extract() for automatic repair.',
          {
            attempts: 1,
            usage: finalizeUsage(usage, pricing),
            ...(err.text != null ? { rawText: err.text } : {}),
            cause: err,
          },
        );
      }
      throw err;
    }
    usage.modelCalls = 1;
    addUsage(usage, await res.totalUsage);

    if (!envelope.readable) {
      throw new DocumentUnreadableError(envelope.issues, finalizeUsage(usage, pricing));
    }

    const unwrapped = unwrapWireOutput(schema, envelope.fields, doc.pages);
    const parsed = schema.safeParse(unwrapped.data);
    if (!parsed.success) {
      if (isOnlyMissingFields(parsed.error, unwrapped.missingPaths)) {
        throw new MissingRequiredFieldsError({
          missingPaths: unwrapped.missingPaths,
          partial: { data: unwrapped.data, fields: unwrapped.fields },
          attempts: 1,
          usage: finalizeUsage(usage, pricing),
        });
      }
      throw new ExtractionFailedError(
        `Extraction failed schema validation: ${zodIssueSummaries(parsed.error).join('; ')}`,
        { attempts: 1, usage: finalizeUsage(usage, pricing), cause: parsed.error },
      );
    }

    const result: ExtractResult<S> = {
      data: parsed.data as z.output<S>,
      fields: unwrapped.fields as FieldMap<z.output<S>>,
      issues: [...envelope.issues, ...unwrapped.issues],
      usage: finalizeUsage(usage, pricing),
      pages: doc.pages,
    };
    queue.close();
    return result;
  } catch (err) {
    queue.fail(err);
    throw err;
  }
}
