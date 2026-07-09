import { extract, ExtractKitError, MissingRequiredFieldsError } from 'extractkit';
import type { ExtractUsage } from 'extractkit';
import { scoreExtraction, scoreFailure } from './metrics.js';
import { schemas } from './schemas.js';
import type { DocResult, EvalDocument, EvalModel, ModelRun } from './types.js';

export interface RunOptions {
  /** Concurrent extractions per model. Default 4. */
  concurrency?: number;
  onDocDone?: (result: DocResult) => void;
}

function toUsage(usage: ExtractUsage): DocResult['usage'] {
  return {
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    modelCalls: usage.modelCalls,
    costUSD: usage.costUSD,
  };
}

async function runDoc(model: EvalModel, doc: EvalDocument): Promise<DocResult> {
  const base = { docId: doc.id, dataset: doc.dataset, schema: doc.schema };
  try {
    const result = await extract({
      schema: schemas[doc.schema],
      document: { data: doc.bytes, mediaType: doc.mediaType },
      model: model.model,
      temperature: 0,
      ...(model.pricing !== undefined ? { pricing: model.pricing } : {}),
    });
    return { ...base, error: null, ...scoreExtraction(doc, result), usage: toUsage(result.usage) };
  } catch (err) {
    const message = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    if (err instanceof MissingRequiredFieldsError) {
      return { ...base, error: message, ...scoreExtraction(doc, err.partial), usage: toUsage(err.usage) };
    }
    const usage = err instanceof ExtractKitError && 'usage' in err ? toUsage(err.usage as ExtractUsage) : null;
    return { ...base, error: message, ...scoreFailure(doc), usage };
  }
}

/** Run one model over the benchmark documents with bounded concurrency.
 * Document order in the result matches the input order. */
export async function runModel(model: EvalModel, docs: EvalDocument[], options: RunOptions = {}): Promise<ModelRun> {
  const concurrency = options.concurrency ?? 4;
  const results: DocResult[] = new Array(docs.length);
  let next = 0;

  async function worker(): Promise<void> {
    while (next < docs.length) {
      const index = next++;
      const doc = docs[index] as EvalDocument;
      const result = await runDoc(model, doc);
      results[index] = result;
      options.onDocDone?.(result);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, docs.length) }, worker));
  return { model: model.name, docs: results };
}
