# extractkit

**Extraction you can audit.** Define a Zod schema, feed it a PDF or image, get back schema-validated JSON where every field carries provenance — the page and bounding box it came from — plus a confidence score.

> Pre-1.0. The API may change until the public benchmark ships. Part of the [extractkit monorepo](https://github.com/RATCHAW/extractkit).

## Install

```sh
npm install extractkit ai zod
```

`ai` (Vercel AI SDK v7) and `zod` (v4) are peer dependencies. Bring any AI SDK provider — e.g. `@ai-sdk/anthropic`, `@ai-sdk/openai`, or `@ai-sdk/google` — and pass its model to `extract`.

## Quickstart

```ts
import { anthropic } from '@ai-sdk/anthropic';
import { extract } from 'extractkit';
import { readFile } from 'node:fs/promises';
import { z } from 'zod';

const invoice = z.object({
  vendor: z.string().describe('Legal name of the issuing company'),
  invoiceNumber: z.string(),
  issueDate: z.iso.date(),
  currency: z.string().describe('ISO 4217 code, e.g. USD'),
  total: z.number(),
  lineItems: z.array(
    z.object({
      description: z.string(),
      quantity: z.number(),
      unitPrice: z.number(),
      amount: z.number(),
    }),
  ),
});

const result = await extract({
  schema: invoice,
  document: { data: await readFile('invoice.pdf') },
  model: anthropic('claude-sonnet-5'),
});

result.data.total;           // 1250.5 — validated against the schema
result.fields.total;         // { value: 1250.5, confidence: 0.97, page: 0, bbox: { x0: 0.72, y0: 0.81, x1: 0.9, y1: 0.84 } }
result.usage;                // { inputTokens, outputTokens, totalTokens, modelCalls, costUSD }
result.issues;               // non-fatal anomalies, e.g. dropped implausible provenance
```

Every leaf of your schema comes back twice: the plain value in `data` (validated, typed `z.output` of your schema) and an `ExtractedField` in `fields` with:

- `page` — 0-based page index (always 0 for images), or `null` when the model couldn't locate the value.
- `bbox` — `{ x0, y0, x1, y1 }` normalized to page width/height (0–1, origin top-left), or `null`. Reported regions are validated: out-of-range pages and degenerate boxes are dropped and noted in `result.issues`.
- `confidence` — the model's self-reported probability (0–1) that the value is exactly right. It is **not calibrated**; treat it as a ranking signal. The eval harness in this repo measures how well it tracks reality per model.

## Streaming

```ts
import { streamExtract } from 'extractkit';

const stream = streamExtract({ schema: invoice, document, model });

for await (const event of stream) {
  // fires as each field's provenance wrapper completes
  console.log(event.path, event.field.value);
}

const result = await stream.result; // same validated result extract() returns
```

Field events are emitted before final validation (the finished `result` is authoritative), and streaming does not run repair attempts — use `extract()` when robustness matters more than latency.

## Documents

`document.data` accepts `Uint8Array`, `ArrayBuffer`, or a base64 string. PDF, PNG, JPEG, and WebP are supported; the type is sniffed from the file signature, and a declared `mediaType` must match it. PDFs are checked before any tokens are spent: encrypted files, empty files, and unparseable files fail fast with typed errors, and the real page count is used to validate the model's page references.

## Schemas

Supported: `z.object`, `z.array`, `z.string` (including formats like `z.iso.date()`), `z.number`, `z.boolean`, `z.enum`, `z.literal`, plus `.optional()`, `.nullable()`, `.describe()`, and `.refine()`. Field descriptions are forwarded to the model — use them.

Rejected by design, with an `UnsupportedSchemaError` naming the offending path: `.transform()`, `.default()`, `.catch()`, and `z.date()`. A transformed or defaulted value no longer maps to a region of the document, which breaks the provenance guarantee. Transform after extraction instead.

## Failure handling

| Error | `code` | Meaning |
| --- | --- | --- |
| `UnsupportedSchemaError` | `SCHEMA_UNSUPPORTED` | Schema contains an unsupported type; thrown before any model call |
| `DocumentError` | `UNSUPPORTED_MEDIA_TYPE`, `MEDIA_TYPE_MISMATCH`, `ENCRYPTED_DOCUMENT`, `INVALID_DOCUMENT` | Input rejected before any model call |
| `DocumentUnreadableError` | `DOCUMENT_UNREADABLE` | The model reported the document as blank/illegible/not a document; carries its stated `issues` |
| `MissingRequiredFieldsError` | `MISSING_REQUIRED_FIELDS` | Document was readable but required fields weren't found; carries `missingPaths` and the `partial` extraction |
| `ExtractionFailedError` | `EXTRACTION_FAILED` | Model kept returning invalid output after all repair attempts; carries `attempts`, `usage`, and the raw text |

All extend `ExtractKitError`. Transport and provider errors from the AI SDK propagate unwrapped, with the SDK's own `maxRetries` applied. When the model returns malformed or schema-violating output, extractkit re-prompts it with the specific violations (`maxRepairAttempts`, default 1); token usage is accumulated across attempts so costs stay visible.

## Cost tracking

`result.usage` always carries token counts and the number of model calls. Pass `pricing: { inputPerMTokUSD, outputPerMTokUSD }` to get `costUSD`; without it, `costUSD` is `null` — extractkit ships no built-in price table, so costs are never silently wrong.

## License

MIT
