// Regenerates docs/benchmark.md and the README benchmark table from a run
// record. Usage: pnpm report [results/run-....json] (defaults to the latest).
import '../src/env.js';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { renderBenchmarkPage, renderReadmeTable } from '../src/report.js';
import type { RunRecord } from '../src/types.js';
import { BENCHMARK_PAGE_PATH, README_PATH, RESULTS_DIR } from './paths.js';

const README_START = '<!-- benchmark:start -->';
const README_END = '<!-- benchmark:end -->';

async function latestRunPath(): Promise<string> {
  const files = (await readdir(RESULTS_DIR)).filter((f) => f.startsWith('run-') && f.endsWith('.json')).sort();
  const last = files[files.length - 1];
  if (last === undefined) throw new Error(`no run records in ${RESULTS_DIR} — run \`pnpm run-eval\` first`);
  return join(RESULTS_DIR, last);
}

const runPath = process.argv[2] ?? (await latestRunPath());
const record = JSON.parse(await readFile(runPath, 'utf8')) as RunRecord;

await writeFile(BENCHMARK_PAGE_PATH, renderBenchmarkPage(record));
console.log(`wrote ${BENCHMARK_PAGE_PATH}`);

const readme = await readFile(README_PATH, 'utf8');
const start = readme.indexOf(README_START);
const end = readme.indexOf(README_END);
if (start === -1 || end === -1) {
  console.log(`README has no ${README_START} … ${README_END} markers; README table:\n`);
  console.log(renderReadmeTable(record));
} else {
  const table = renderReadmeTable(record);
  const updated = `${readme.slice(0, start + README_START.length)}\n\n${table}\n\n${readme.slice(end)}`;
  await writeFile(README_PATH, updated);
  console.log(`updated benchmark table in ${README_PATH}`);
}
