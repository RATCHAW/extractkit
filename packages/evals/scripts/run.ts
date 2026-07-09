// Runs the benchmark: every pinned document through every model, raw results
// serialized to results/ so reports are reproducible from the run record.
import { access, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { loadCordDocuments } from '../src/datasets/cord-source.js';
import { loadDocileDocuments } from '../src/datasets/docile-source.js';
import { loadManifest } from '../src/manifest.js';
import { benchmarkModels } from '../src/models.js';
import { runModel } from '../src/runner.js';
import type { EvalDocument, RunRecord } from '../src/types.js';
import { CORD_PARQUET_PATH, DOCILE_ROOT, RESULTS_DIR } from './paths.js';

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

const { manifest, checksum } = await loadManifest();
const models = benchmarkModels();

const docs: EvalDocument[] = [];
if (manifest.cord.docs.length > 0) {
  if (!(await exists(CORD_PARQUET_PATH))) throw new Error('cord parquet missing — run `pnpm fetch-data` first');
  docs.push(...(await loadCordDocuments(manifest, CORD_PARQUET_PATH)));
}
if (manifest.docile.docs.length > 0) {
  if (!(await exists(join(DOCILE_ROOT, 'annotations')))) {
    throw new Error('docile docs are pinned but the dataset is not fetched — run `pnpm fetch-data` with DOCILE_TOKEN');
  }
  docs.push(...(await loadDocileDocuments(manifest, DOCILE_ROOT)));
} else {
  console.log('docile: no pinned docs yet; running the receipt half only');
}
if (docs.length === 0) throw new Error('no benchmark documents to run — run `pnpm fetch-data` and `pnpm pin` first');

const startedAt = new Date().toISOString();
const record: RunRecord = { startedAt, manifestChecksum: checksum, runs: [] };

for (const model of models) {
  console.log(`\n=== ${model.name} — ${docs.length} docs ===`);
  const run = await runModel(model, docs, {
    onDocDone: (r) => {
      const correct = r.fields.filter((f) => f.valueCorrect).length;
      console.log(`  ${r.docId}: ${correct}/${r.fields.length} fields${r.error !== null ? ` (${r.error})` : ''}`);
    },
  });
  record.runs.push(run);
}

await mkdir(RESULTS_DIR, { recursive: true });
const outPath = join(RESULTS_DIR, `run-${startedAt.replace(/[:.]/g, '-')}.json`);
await writeFile(outPath, `${JSON.stringify(record, null, 2)}\n`);
console.log(`\nrun record written to ${outPath}\nGenerate the report with: pnpm report ${outPath}`);
