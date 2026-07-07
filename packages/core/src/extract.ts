import { generateText, NoObjectGeneratedError, Output } from 'ai';
import type { AssistantModelMessage, ModelMessage, UserModelMessage } from 'ai';
import type { z } from 'zod';
import { normalizeDocument } from './document.js';
import { DocumentUnreadableError, ExtractionFailedError, MissingRequiredFieldsError } from './errors.js';
import { buildRepairMessage, buildSystemPrompt, buildUserMessage } from './prompt.js';
import {
  buildWireSchema,
  isOnlyMissingFields,
  unwrapWireOutput,
  zodIssueSummaries,
  type WireEnvelope,
} from './schema.js';
import type { ExtractOptions, ExtractResult, FieldMap } from './types.js';
import { addUsage, createUsage, finalizeUsage } from './usage.js';

function appendRepair(messages: ModelMessage[], previousText: string | undefined, reasons: string[]): ModelMessage[] {
  const assistant: AssistantModelMessage = {
    role: 'assistant',
    content: previousText != null && previousText.trim() !== '' ? previousText : '[no valid output]',
  };
  const user: UserModelMessage = { role: 'user', content: buildRepairMessage(reasons) };
  return [...messages, assistant, user];
}

function truncate(text: string, max = 500): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function describeInvalidOutput(err: NoObjectGeneratedError): string {
  const detail = err.cause instanceof Error ? err.cause.message : err.message;
  return `Response was not valid JSON for the required schema: ${truncate(detail)}`;
}

/**
 * Extracts `schema` from a PDF or image: one model call (plus repair calls
 * when the model returns invalid output), then schema validation. Every leaf
 * in the result carries value, confidence, page, and bbox.
 */
export async function extract<S extends z.ZodObject>(options: ExtractOptions<S>): Promise<ExtractResult<S>> {
  const { schema, pricing } = options;
  const wire = buildWireSchema(schema);
  const doc = await normalizeDocument(options.document);
  const output = Output.object({
    schema: wire,
    name: options.schemaName ?? 'document_extraction',
    ...(options.schemaDescription != null ? { description: options.schemaDescription } : {}),
  });
  const system = buildSystemPrompt(options.instructions);
  const maxRepairAttempts = options.maxRepairAttempts ?? 1;
  const usage = createUsage();
  let messages: ModelMessage[] = [buildUserMessage(doc)];

  for (let attempt = 1; ; attempt++) {
    let envelope: WireEnvelope;
    let rawText: string;
    try {
      const res = await generateText({
        model: options.model,
        system,
        messages,
        output,
        ...(options.temperature != null ? { temperature: options.temperature } : {}),
        ...(options.maxRetries != null ? { maxRetries: options.maxRetries } : {}),
        ...(options.abortSignal != null ? { abortSignal: options.abortSignal } : {}),
      });
      usage.modelCalls = attempt;
      addUsage(usage, res.totalUsage);
      envelope = res.output as unknown as WireEnvelope;
      rawText = res.text;
    } catch (err) {
      if (NoObjectGeneratedError.isInstance(err)) {
        usage.modelCalls = attempt;
        addUsage(usage, err.usage);
        if (attempt <= maxRepairAttempts) {
          messages = appendRepair(messages, err.text, [describeInvalidOutput(err)]);
          continue;
        }
        throw new ExtractionFailedError('Model output was not valid extraction JSON after all repair attempts.', {
          attempts: attempt,
          usage: finalizeUsage(usage, pricing),
          ...(err.text != null ? { rawText: err.text } : {}),
          cause: err,
        });
      }
      // Transport, provider, and abort errors propagate as-is; the AI SDK
      // has already applied maxRetries to retryable ones.
      throw err;
    }

    if (!envelope.readable) {
      throw new DocumentUnreadableError(envelope.issues, finalizeUsage(usage, pricing));
    }

    const unwrapped = unwrapWireOutput(schema, envelope.fields, doc.pages);
    const parsed = schema.safeParse(unwrapped.data);
    if (parsed.success) {
      return {
        data: parsed.data as z.output<S>,
        fields: unwrapped.fields as FieldMap<z.output<S>>,
        issues: [...envelope.issues, ...unwrapped.issues],
        usage: finalizeUsage(usage, pricing),
        pages: doc.pages,
      };
    }

    if (attempt <= maxRepairAttempts) {
      const reasons = [
        ...unwrapped.missingPaths.map(
          (p) => `${p}: required field was null. Re-check the document; return null only if it is truly absent`,
        ),
        ...zodIssueSummaries(parsed.error),
      ];
      messages = appendRepair(messages, rawText, reasons);
      continue;
    }

    if (isOnlyMissingFields(parsed.error, unwrapped.missingPaths)) {
      throw new MissingRequiredFieldsError({
        missingPaths: unwrapped.missingPaths,
        partial: { data: unwrapped.data, fields: unwrapped.fields },
        attempts: attempt,
        usage: finalizeUsage(usage, pricing),
      });
    }
    throw new ExtractionFailedError(
      `Extraction failed schema validation after all repair attempts: ${zodIssueSummaries(parsed.error).join('; ')}`,
      { attempts: attempt, usage: finalizeUsage(usage, pricing), rawText, cause: parsed.error },
    );
  }
}
