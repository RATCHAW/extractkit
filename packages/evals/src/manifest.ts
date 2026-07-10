import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

/**
 * The pinned benchmark selection. Documents are never vendored: the manifest
 * holds ids + checksums, and the fetch script pulls the documents from their
 * canonical hosts. Every published number is computed on exactly this set.
 */
export interface Manifest {
  version: 1;
  cord: {
    dataset: string;
    /** Git revision of the dataset repo the parquet is fetched at. */
    revision: string;
    /** Repo-relative parquet path holding the split. */
    file: string;
    /** SHA-256 of the parquet file. */
    sha256: string;
    split: string;
    docs: CordPin[];
  };
  docile: {
    /** Archive name passed to the DocILE downloader. */
    archive: string;
    split: string;
    docs: DocilePin[];
  };
}

export interface CordPin {
  /** Row index within the split parquet. */
  rowIndex: number;
  /** image_id from the row's ground-truth metadata. */
  imageId: number;
  /** SHA-256 of the row's image bytes. */
  imageSha256: string;
}

export interface DocilePin {
  docId: string;
  /** SHA-256 of `pdfs/{docId}.pdf`. */
  pdfSha256: string;
  /** SHA-256 of `annotations/{docId}.json`. */
  annotationSha256: string;
}

export const MANIFEST_PATH = fileURLToPath(new URL('../data/manifest.json', import.meta.url));

export function sha256Hex(bytes: Uint8Array | string): string {
  return createHash('sha256').update(bytes).digest('hex');
}

export async function loadManifest(path: string = MANIFEST_PATH): Promise<{ manifest: Manifest; checksum: string }> {
  const raw = await readFile(path, 'utf8');
  const manifest = JSON.parse(raw) as Manifest;
  if (manifest.version !== 1) throw new Error(`Unsupported manifest version: ${String(manifest.version)}`);
  return { manifest, checksum: sha256Hex(raw) };
}
