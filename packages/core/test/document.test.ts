import { describe, expect, it } from 'vitest';
import { normalizeDocument, sniffMediaType } from '../src/document.js';
import { DocumentError } from '../src/errors.js';
import { expectError, makeEncryptedPdf, makePdf, tinyJpeg, tinyPng, tinyWebp } from './helpers.js';

describe('sniffMediaType', () => {
  it('detects the four supported types from magic bytes', async () => {
    expect(sniffMediaType(tinyPng())).toBe('image/png');
    expect(sniffMediaType(tinyJpeg())).toBe('image/jpeg');
    expect(sniffMediaType(tinyWebp())).toBe('image/webp');
    expect(sniffMediaType(await makePdf(1))).toBe('application/pdf');
  });

  it('returns null for unknown signatures', () => {
    expect(sniffMediaType(new TextEncoder().encode('hello world'))).toBeNull();
    expect(sniffMediaType(new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x41, 0x56, 0x45]))).toBeNull(); // RIFF but WAVE
  });
});

describe('normalizeDocument', () => {
  it('normalizes images with pages = 1', async () => {
    const doc = await normalizeDocument({ data: tinyPng(), filename: 'r.png' });
    expect(doc.mediaType).toBe('image/png');
    expect(doc.pages).toBe(1);
    expect(doc.filename).toBe('r.png');
  });

  it('reads the page count from PDFs', async () => {
    const doc = await normalizeDocument({ data: await makePdf(3) });
    expect(doc.mediaType).toBe('application/pdf');
    expect(doc.pages).toBe(3);
  });

  it('accepts ArrayBuffer and base64 input', async () => {
    const png = tinyPng();
    const arrayBuffer = new ArrayBuffer(png.length);
    new Uint8Array(arrayBuffer).set(png);
    const fromArrayBuffer = await normalizeDocument({ data: arrayBuffer });
    expect(fromArrayBuffer.mediaType).toBe('image/png');

    const base64 = btoa(String.fromCharCode(...png));
    const fromBase64 = await normalizeDocument({ data: base64 });
    expect(fromBase64.mediaType).toBe('image/png');
    expect(fromBase64.bytes).toEqual(png);
  });

  it('rejects invalid base64', async () => {
    const err = await expectError(normalizeDocument({ data: '!!! not base64 !!!' }), DocumentError);
    expect(err.code).toBe('INVALID_DOCUMENT');
  });

  it('rejects empty documents', async () => {
    const err = await expectError(normalizeDocument({ data: new Uint8Array() }), DocumentError);
    expect(err.code).toBe('INVALID_DOCUMENT');
  });

  it('rejects unknown file signatures', async () => {
    const err = await expectError(normalizeDocument({ data: new TextEncoder().encode('plain text') }), DocumentError);
    expect(err.code).toBe('UNSUPPORTED_MEDIA_TYPE');
  });

  it('rejects a declared media type that contradicts the bytes', async () => {
    const err = await expectError(
      normalizeDocument({ data: tinyPng(), mediaType: 'application/pdf' }),
      DocumentError,
    );
    expect(err.code).toBe('MEDIA_TYPE_MISMATCH');
    expect(err.message).toContain('image/png');
  });

  it('rejects corrupt PDFs', async () => {
    const err = await expectError(
      normalizeDocument({ data: new TextEncoder().encode('%PDF-1.7 this is not a pdf') }),
      DocumentError,
    );
    expect(err.code).toBe('INVALID_DOCUMENT');
  });

  it('rejects encrypted PDFs with a dedicated code', async () => {
    const err = await expectError(normalizeDocument({ data: await makeEncryptedPdf() }), DocumentError);
    expect(err.code).toBe('ENCRYPTED_DOCUMENT');
  });
});
