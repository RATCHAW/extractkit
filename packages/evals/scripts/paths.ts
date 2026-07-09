import { fileURLToPath } from 'node:url';

/** Local cache for fetched benchmark data; gitignored, never vendored. */
export const DATA_DIR = fileURLToPath(new URL('../.data', import.meta.url));
export const CORD_PARQUET_PATH = fileURLToPath(new URL('../.data/cord-test.parquet', import.meta.url));
export const DOCILE_ROOT = fileURLToPath(new URL('../.data/docile', import.meta.url));
export const RESULTS_DIR = fileURLToPath(new URL('../results', import.meta.url));
export const BENCHMARK_PAGE_PATH = fileURLToPath(new URL('../../../docs/benchmark.md', import.meta.url));
export const README_PATH = fileURLToPath(new URL('../../../README.md', import.meta.url));
