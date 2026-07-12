import { ExtractKitError, MissingRequiredFieldsError, streamExtract } from 'extractkit';
import type { ExtractResult } from 'extractkit';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { streamSSE } from 'hono/streaming';
import type { z } from 'zod';
import type { ApiError, ConfigResponse, ExtractEvent, SerializedResult } from '../shared/api';
import type { PlaygroundModel } from './models';
import { defaultModelId, modelInfos } from './models';
import { DEFAULT_SCHEMA_ID, getPreset, schemaInfos } from './schemas';

export interface AppOptions {
  /** Models this instance can run. Injected so tests can pass a mock model. */
  models: PlaygroundModel[];
}

/** Upload ceiling for the public demo; documents above this are rejected. */
const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;

function toSerialized(result: ExtractResult<z.ZodObject>): SerializedResult {
  return {
    data: result.data,
    fields: result.fields,
    issues: result.issues,
    usage: result.usage,
    pages: result.pages,
  };
}

function toApiError(err: unknown): ApiError {
  if (err instanceof ExtractKitError) {
    const mapped: ApiError = { name: err.name, code: err.code, message: err.message };
    if (err instanceof MissingRequiredFieldsError) {
      mapped.missingPaths = err.missingPaths;
      mapped.partial = { data: err.partial.data, fields: err.partial.fields, usage: err.usage };
    }
    return mapped;
  }
  if (err instanceof Error) return { name: err.name, code: null, message: err.message };
  return { name: 'Error', code: null, message: String(err) };
}

export function createApp(options: AppOptions) {
  const modelById = new Map(options.models.map((m) => [m.id, m]));
  const app = new Hono();

  app.get('/api/config', (c) => {
    const body: ConfigResponse = {
      schemas: schemaInfos(),
      models: modelInfos(options.models),
      defaults: { schema: DEFAULT_SCHEMA_ID, model: defaultModelId(options.models) },
    };
    return c.json(body);
  });

  app.post(
    '/api/extract',
    bodyLimit({
      maxSize: MAX_UPLOAD_BYTES,
      onError: (c) => c.json({ error: 'Document exceeds the 15 MB upload limit.' }, 413),
    }),
    async (c) => {
      const form = await c.req.parseBody();
      const file = form['file'];
      const schemaId = typeof form['schema'] === 'string' ? form['schema'] : '';
      const modelId = typeof form['model'] === 'string' ? form['model'] : '';

      if (!(file instanceof File)) {
        return c.json({ error: 'Upload a document in the "file" field.' }, 400);
      }
      const preset = getPreset(schemaId);
      if (preset === undefined) {
        return c.json({ error: `Unknown schema "${schemaId}".` }, 400);
      }
      const model = modelById.get(modelId);
      if (model === undefined) {
        return c.json({ error: `Unknown or unavailable model "${modelId}".` }, 400);
      }

      const bytes = new Uint8Array(await file.arrayBuffer());

      return streamSSE(c, async (sse) => {
        const send = (event: ExtractEvent) => sse.writeSSE({ event: event.type, data: JSON.stringify(event) });
        const stream = streamExtract({
          schema: preset.schema,
          document: { data: bytes, filename: file.name },
          model: model.create(),
          pricing: model.pricing,
        });
        try {
          for await (const ev of stream) {
            await send({ type: 'field', path: ev.path, field: ev.field });
          }
          const result = await stream.result;
          await send({ type: 'result', result: toSerialized(result) });
        } catch (err) {
          await send({ type: 'error', error: toApiError(err) });
        }
      });
    },
  );

  return app;
}
