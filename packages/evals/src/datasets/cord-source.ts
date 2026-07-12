import { asyncBufferFromFile, parquetMetadataAsync, parquetReadObjects } from 'hyparquet';
import { sniffMediaType } from '@ratchaw/extractkit';
import { sha256Hex, type CordPin, type Manifest } from '../manifest.js';
import { cordToGroundTruth, type CordGroundTruth } from './cord.js';
import type { EvalDocument } from '../types.js';

export interface CordRow {
  rowIndex: number;
  imageBytes: Uint8Array;
  groundTruth: CordGroundTruth;
}

/** Read specific rows (or all rows) of a CORD-v2 split parquet. */
export async function readCordRows(parquetPath: string, rowIndices?: number[]): Promise<CordRow[]> {
  const file = await asyncBufferFromFile(parquetPath);
  const metadata = await parquetMetadataAsync(file);
  const total = Number(metadata.num_rows);
  const indices = rowIndices ?? Array.from({ length: total }, (_, i) => i);
  const rows: CordRow[] = [];
  for (const rowIndex of indices) {
    if (rowIndex < 0 || rowIndex >= total) throw new Error(`Row ${rowIndex} out of range (parquet has ${total} rows)`);
    // utf8:false keeps image bytes binary; UTF8-annotated columns still decode.
    const [row] = await parquetReadObjects({ file, metadata, rowStart: rowIndex, rowEnd: rowIndex + 1, utf8: false });
    const record = row as { image: { bytes: Uint8Array }; ground_truth: string };
    rows.push({
      rowIndex,
      imageBytes: record.image.bytes,
      groundTruth: JSON.parse(record.ground_truth) as CordGroundTruth,
    });
  }
  return rows;
}

/** Load the pinned CORD documents from a locally fetched parquet, verifying
 * every pinned checksum. */
export async function loadCordDocuments(manifest: Manifest, parquetPath: string): Promise<EvalDocument[]> {
  const pins = manifest.cord.docs;
  const byIndex = new Map<number, CordPin>(pins.map((p) => [p.rowIndex, p]));
  const rows = await readCordRows(parquetPath, pins.map((p) => p.rowIndex));
  return rows.map((row) => {
    const pin = byIndex.get(row.rowIndex) as CordPin;
    const digest = sha256Hex(row.imageBytes);
    if (digest !== pin.imageSha256) {
      throw new Error(
        `cord row ${row.rowIndex}: image sha256 ${digest} does not match pinned ${pin.imageSha256} — dataset content changed?`,
      );
    }
    if (row.groundTruth.meta.image_id !== pin.imageId) {
      throw new Error(
        `cord row ${row.rowIndex}: image_id ${row.groundTruth.meta.image_id} does not match pinned ${pin.imageId}`,
      );
    }
    const mediaType = sniffMediaType(row.imageBytes);
    if (mediaType === null) throw new Error(`cord row ${row.rowIndex}: unrecognized image format`);
    const { fields, lineItemCount } = cordToGroundTruth(row.groundTruth);
    return {
      id: `cord/${manifest.cord.split}/${row.rowIndex}`,
      dataset: 'cord' as const,
      schema: 'receipt' as const,
      bytes: row.imageBytes,
      mediaType,
      pages: 1,
      fields,
      lineItemCount,
    };
  });
}
