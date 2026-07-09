import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { sha256Hex, type Manifest } from '../manifest.js';
import { docileToGroundTruth, type DocileAnnotation } from './docile.js';
import type { EvalDocument } from '../types.js';

/** Read one document from an extracted DocILE dataset directory
 * (`<root>/pdfs/{docId}.pdf` + `<root>/annotations/{docId}.json`). */
export async function readDocileDoc(
  root: string,
  docId: string,
): Promise<{ pdfBytes: Uint8Array; annotation: DocileAnnotation }> {
  const pdfBytes = new Uint8Array(await readFile(join(root, 'pdfs', `${docId}.pdf`)));
  const annotation = JSON.parse(await readFile(join(root, 'annotations', `${docId}.json`), 'utf8')) as DocileAnnotation;
  return { pdfBytes, annotation };
}

/** Doc ids in a DocILE split (`<root>/{split}.json` is a JSON array). */
export async function readDocileSplit(root: string, split: string): Promise<string[]> {
  return JSON.parse(await readFile(join(root, `${split}.json`), 'utf8')) as string[];
}

/** Load the pinned DocILE documents from a locally downloaded dataset,
 * verifying every pinned checksum. */
export async function loadDocileDocuments(manifest: Manifest, root: string): Promise<EvalDocument[]> {
  return Promise.all(
    manifest.docile.docs.map(async (pin) => {
      const { pdfBytes, annotation } = await readDocileDoc(root, pin.docId);
      const pdfDigest = sha256Hex(pdfBytes);
      if (pdfDigest !== pin.pdfSha256) {
        throw new Error(`docile ${pin.docId}: pdf sha256 ${pdfDigest} does not match pinned ${pin.pdfSha256}`);
      }
      const annotationDigest = sha256Hex(await readFile(join(root, 'annotations', `${pin.docId}.json`)));
      if (annotationDigest !== pin.annotationSha256) {
        throw new Error(
          `docile ${pin.docId}: annotation sha256 ${annotationDigest} does not match pinned ${pin.annotationSha256}`,
        );
      }
      const { fields, lineItemCount } = docileToGroundTruth(annotation);
      return {
        id: `docile/${manifest.docile.split}/${pin.docId}`,
        dataset: 'docile' as const,
        schema: 'invoice' as const,
        bytes: pdfBytes,
        mediaType: 'application/pdf' as const,
        pages: annotation.metadata.page_count,
        fields,
        lineItemCount,
      };
    }),
  );
}
