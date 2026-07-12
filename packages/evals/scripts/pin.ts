// Curates the benchmark selection and writes data/manifest.json.
// Deterministic: same source data in, same manifest out. Documents whose
// ground truth cannot be mapped confidently are skipped, never mis-scored.
import '../src/env.js';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { cordToGroundTruth, CordMappingError } from '../src/datasets/cord.js';
import { readCordRows } from '../src/datasets/cord-source.js';
import { docileToGroundTruth, DocileMappingError } from '../src/datasets/docile.js';
import { readDocileDoc, readDocileSplit } from '../src/datasets/docile-source.js';
import { MANIFEST_PATH, sha256Hex, type CordPin, type DocilePin, type Manifest } from '../src/manifest.js';
import { CORD_PARQUET_PATH, DOCILE_ROOT } from './paths.js';

const DOCS_PER_HALF = 25;

/** The pinned CORD-v2 source: main-branch test parquet at a fixed revision.
 * sha256 is the file's LFS oid, cross-checked against the download. */
const CORD_SOURCE = {
  dataset: 'naver-clova-ix/cord-v2',
  revision: '7f0115a4b758a71d6473b8d085751692da2fef98',
  file: 'data/test-00000-of-00001-9c204eb3f4e11791.parquet',
  sha256: '51c65f1788faff392abe2a0b55b023eb23e9be551c509138eaa3a832514224e7',
  split: 'test',
};

const DOCILE_SOURCE = { archive: 'annotated-trainval', split: 'val' };

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Deterministic diversity selection: bucket candidates by a key, then take
 * round-robin from each bucket in candidate order until `count` are chosen.
 */
function roundRobin<T>(candidates: T[], bucketOf: (c: T) => string, count: number): T[] {
  const buckets = new Map<string, T[]>();
  for (const c of candidates) {
    const key = bucketOf(c);
    const list = buckets.get(key) ?? [];
    list.push(c);
    buckets.set(key, list);
  }
  const keys = [...buckets.keys()].sort();
  const picked: T[] = [];
  for (let round = 0; picked.length < count; round++) {
    let took = false;
    for (const key of keys) {
      const bucket = buckets.get(key) as T[];
      if (round < bucket.length && picked.length < count) {
        picked.push(bucket[round] as T);
        took = true;
      }
    }
    if (!took) break;
  }
  return picked;
}

async function pinCord(): Promise<CordPin[]> {
  if (!(await exists(CORD_PARQUET_PATH))) {
    throw new Error(`cord: ${CORD_PARQUET_PATH} not found — run \`pnpm fetch-data\` first`);
  }
  const rows = await readCordRows(CORD_PARQUET_PATH);
  const candidates: Array<CordPin & { lineItemCount: number }> = [];
  for (const row of rows) {
    try {
      const { lineItemCount } = cordToGroundTruth(row.groundTruth);
      candidates.push({
        rowIndex: row.rowIndex,
        imageId: row.groundTruth.meta.image_id,
        imageSha256: sha256Hex(row.imageBytes),
        lineItemCount,
      });
    } catch (err) {
      if (!(err instanceof CordMappingError)) throw err;
      console.log(`cord row ${row.rowIndex}: skipped (${err.message})`);
    }
  }
  console.log(`cord: ${candidates.length}/${rows.length} rows map cleanly`);
  if (candidates.length < DOCS_PER_HALF) throw new Error('cord: not enough cleanly-mapping rows to pin');
  const picked = roundRobin(
    candidates,
    (c) => (c.lineItemCount === 1 ? 'single-item' : c.lineItemCount <= 3 ? 'few-items' : 'many-items'),
    DOCS_PER_HALF,
  ).sort((a, b) => a.rowIndex - b.rowIndex);
  return picked.map(({ rowIndex, imageId, imageSha256 }) => ({ rowIndex, imageId, imageSha256 }));
}

async function pinDocile(previous: DocilePin[]): Promise<DocilePin[]> {
  if (!(await exists(join(DOCILE_ROOT, `${DOCILE_SOURCE.split}.json`)))) {
    console.log(
      previous.length > 0
        ? 'docile: dataset not present locally — keeping existing pins'
        : 'docile: dataset not present locally — invoice half stays unpinned (needs DOCILE_TOKEN + `pnpm fetch-data`)',
    );
    return previous;
  }
  const docIds = (await readDocileSplit(DOCILE_ROOT, DOCILE_SOURCE.split)).sort();
  const candidates: Array<DocilePin & { multiPage: boolean }> = [];
  for (const docId of docIds) {
    try {
      const { pdfBytes, annotation } = await readDocileDoc(DOCILE_ROOT, docId);
      if (annotation.metadata.document_type !== 'tax_invoice') continue;
      const { fields, lineItemCount } = docileToGroundTruth(annotation);
      const byPath = new Map(fields.map((f) => [f.path, f.value]));
      const required = ['vendorName', 'invoiceNumber', 'issueDate', 'total'];
      if (required.some((path) => byPath.get(path) == null)) continue;
      if (lineItemCount === 0 || byPath.get('lineItems.0.description') == null) continue;
      candidates.push({
        docId,
        pdfSha256: sha256Hex(pdfBytes),
        annotationSha256: sha256Hex(await readFile(join(DOCILE_ROOT, 'annotations', `${docId}.json`))),
        multiPage: annotation.metadata.page_count > 1,
      });
    } catch (err) {
      if (!(err instanceof DocileMappingError)) throw err;
      console.log(`docile ${docId}: skipped (${err.message})`);
    }
  }
  console.log(`docile: ${candidates.length} candidate invoices in ${DOCILE_SOURCE.split}`);
  if (candidates.length < DOCS_PER_HALF) throw new Error('docile: not enough candidate invoices to pin');
  const picked = roundRobin(candidates, (c) => (c.multiPage ? 'multi-page' : 'single-page'), DOCS_PER_HALF).sort(
    (a, b) => a.docId.localeCompare(b.docId),
  );
  return picked.map(({ docId, pdfSha256, annotationSha256 }) => ({ docId, pdfSha256, annotationSha256 }));
}

let previousDocile: DocilePin[] = [];
try {
  const existing = JSON.parse(await readFile(MANIFEST_PATH, 'utf8')) as Manifest;
  previousDocile = existing.docile.docs;
} catch {
  // First pin run; no manifest yet.
}

const manifest: Manifest = {
  version: 1,
  cord: { ...CORD_SOURCE, docs: await pinCord() },
  docile: { ...DOCILE_SOURCE, docs: await pinDocile(previousDocile) },
};

await mkdir(dirname(MANIFEST_PATH), { recursive: true });
await writeFile(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(
  `pinned ${manifest.cord.docs.length} receipts + ${manifest.docile.docs.length} invoices → ${MANIFEST_PATH}`,
);
