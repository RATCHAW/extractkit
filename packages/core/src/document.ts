import { PDFDocument } from 'pdf-lib';
import { DocumentError } from './errors.js';
import type { DocumentInput, NormalizedDocument, SupportedMediaType } from './types.js';

function decodeBase64(data: string): Uint8Array {
  let binary: string;
  try {
    binary = atob(data);
  } catch (err) {
    throw new DocumentError('INVALID_DOCUMENT', 'Document string is not valid base64.', err);
  }
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function toBytes(data: DocumentInput['data']): Uint8Array {
  if (typeof data === 'string') return decodeBase64(data);
  if (data instanceof Uint8Array) return data;
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  throw new DocumentError('INVALID_DOCUMENT', 'Document data must be a Uint8Array, ArrayBuffer, or base64 string.');
}

function matches(bytes: Uint8Array, offset: number, signature: number[]): boolean {
  return signature.every((byte, i) => bytes[offset + i] === byte);
}

export function sniffMediaType(bytes: Uint8Array): SupportedMediaType | null {
  if (matches(bytes, 0, [0x25, 0x50, 0x44, 0x46, 0x2d])) return 'application/pdf'; // %PDF-
  if (matches(bytes, 0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
  if (matches(bytes, 0, [0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (matches(bytes, 0, [0x52, 0x49, 0x46, 0x46]) && matches(bytes, 8, [0x57, 0x45, 0x42, 0x50])) return 'image/webp';
  return null;
}

/**
 * Validates and normalizes a document input: decodes bytes, verifies the file
 * signature against the declared media type, and reads the PDF page count.
 * Throws DocumentError before any tokens are spent on an unusable input.
 */
export async function normalizeDocument(input: DocumentInput): Promise<NormalizedDocument> {
  const bytes = toBytes(input.data);
  if (bytes.length === 0) {
    throw new DocumentError('INVALID_DOCUMENT', 'Document is empty (0 bytes).');
  }

  const sniffed = sniffMediaType(bytes);
  if (sniffed == null) {
    throw new DocumentError(
      'UNSUPPORTED_MEDIA_TYPE',
      'Unrecognized file signature; supported types are PDF, PNG, JPEG, and WebP.',
    );
  }
  if (input.mediaType != null && input.mediaType !== sniffed) {
    throw new DocumentError(
      'MEDIA_TYPE_MISMATCH',
      `Declared media type is ${input.mediaType} but the file signature is ${sniffed}.`,
    );
  }

  let pages = 1;
  if (sniffed === 'application/pdf') {
    let encrypted: boolean;
    try {
      // pdf-lib's error classes are ES5-compiled and fail instanceof checks,
      // so encryption is detected via the isEncrypted flag rather than by
      // catching EncryptedPDFError. getPageCount can also throw on structurally
      // broken files that load() tolerated, so it stays inside the try.
      const pdf = await PDFDocument.load(bytes, { ignoreEncryption: true });
      encrypted = pdf.isEncrypted;
      pages = encrypted ? 0 : pdf.getPageCount();
    } catch (err) {
      throw new DocumentError('INVALID_DOCUMENT', 'Failed to parse PDF.', err);
    }
    if (encrypted) {
      throw new DocumentError('ENCRYPTED_DOCUMENT', 'PDF is encrypted; decrypt it before extraction.');
    }
    if (pages === 0) {
      throw new DocumentError('INVALID_DOCUMENT', 'PDF has no pages.');
    }
  }

  return { bytes, mediaType: sniffed, pages, filename: input.filename };
}
