// Fetches the pinned benchmark data from its canonical hosts into .data/.
// CORD-v2 (ungated) always; DocILE only when DOCILE_TOKEN is set.
import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { access, mkdir, readFile, rm } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { loadManifest, sha256Hex } from '../src/manifest.js';
import { CORD_PARQUET_PATH, DATA_DIR, DOCILE_ROOT } from './paths.js';

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function download(url: string, dest: string): Promise<void> {
  const res = await fetch(url);
  if (!res.ok || res.body === null) throw new Error(`GET ${url} failed: ${res.status} ${res.statusText}`);
  await pipeline(Readable.fromWeb(res.body as import('node:stream/web').ReadableStream), createWriteStream(dest));
}

async function fetchCord(): Promise<void> {
  const { manifest } = await loadManifest();
  const { dataset, revision, file, sha256 } = manifest.cord;
  if (await exists(CORD_PARQUET_PATH)) {
    const digest = sha256Hex(await readFile(CORD_PARQUET_PATH));
    if (digest === sha256) {
      console.log(`cord: ${file} already cached and verified`);
      return;
    }
    console.log('cord: cached parquet has wrong checksum, re-downloading');
    await rm(CORD_PARQUET_PATH);
  }
  const url = `https://huggingface.co/datasets/${dataset}/resolve/${revision}/${file}`;
  console.log(`cord: downloading ${url}`);
  await download(url, CORD_PARQUET_PATH);
  const digest = sha256Hex(await readFile(CORD_PARQUET_PATH));
  if (digest !== sha256) {
    await rm(CORD_PARQUET_PATH);
    throw new Error(`cord: downloaded parquet sha256 ${digest} does not match pinned ${sha256}`);
  }
  console.log('cord: downloaded and verified');
}

async function fetchDocile(): Promise<void> {
  const { manifest } = await loadManifest();
  if (await exists(`${DOCILE_ROOT}/annotations`)) {
    console.log('docile: dataset already present');
    return;
  }
  const token = process.env['DOCILE_TOKEN'];
  if (token === undefined) {
    console.log(
      'docile: skipped — set DOCILE_TOKEN to fetch the invoice half.\n' +
        '  Request a free token at https://docile.rossum.ai/ (the CORD receipt half works without it).',
    );
    return;
  }
  const archive = manifest.docile.archive;
  const zipPath = `${DOCILE_ROOT}.zip`;
  // Download URL shape from rossumai/docile download_dataset.sh; the token is
  // a path segment, so never log the URL.
  console.log(`docile: downloading ${archive}.zip (several GB, this takes a while)`);
  await download(`https://docile-dataset-rossum.s3.eu-west-1.amazonaws.com/${token}/${archive}.zip`, zipPath);
  await mkdir(DOCILE_ROOT, { recursive: true });
  console.log('docile: extracting');
  await new Promise<void>((resolve, reject) => {
    const child = spawn('unzip', ['-quo', zipPath, '-d', DOCILE_ROOT], { stdio: 'inherit' });
    child.on('error', reject);
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`unzip exited with ${code}`))));
  });
  await rm(zipPath);
  console.log('docile: done');
}

await mkdir(DATA_DIR, { recursive: true });
await fetchCord();
await fetchDocile();
