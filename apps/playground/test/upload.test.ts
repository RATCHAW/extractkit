import { describe, expect, it } from 'vitest';
import { MAX_UPLOAD_BYTES, isPdf, pickFile, validateFile } from '../src/client/lib/upload';

function file(name: string, type: string, size = 100): File {
  const f = new File([new Uint8Array(4)], name, { type });
  Object.defineProperty(f, 'size', { value: size });
  return f;
}

describe('validateFile', () => {
  it('accepts supported documents', () => {
    expect(validateFile(file('invoice.pdf', 'application/pdf'))).toBeNull();
    expect(validateFile(file('receipt.PNG', 'image/png'))).toBeNull();
    expect(validateFile(file('scan.jpg', 'image/jpeg'))).toBeNull();
  });

  it('accepts by extension when the browser reports no type', () => {
    expect(validateFile(file('receipt.webp', ''))).toBeNull();
  });

  it('rejects unsupported types', () => {
    expect(validateFile(file('notes.txt', 'text/plain'))).toMatch(/unsupported/i);
    expect(validateFile(file('archive.zip', ''))).toMatch(/unsupported/i);
  });

  it('rejects files over the size limit', () => {
    expect(validateFile(file('big.pdf', 'application/pdf', MAX_UPLOAD_BYTES + 1))).toMatch(/15 MB/);
  });
});

describe('isPdf', () => {
  it('detects PDFs by type or extension', () => {
    expect(isPdf(file('a.pdf', 'application/pdf'))).toBe(true);
    expect(isPdf(file('a.PDF', ''))).toBe(true);
    expect(isPdf(file('a.png', 'image/png'))).toBe(false);
  });
});

describe('pickFile', () => {
  it('returns the first acceptable file', () => {
    const result = pickFile([file('a.pdf', 'application/pdf')]);
    expect('file' in result).toBe(true);
  });

  it('reports an error for an empty selection', () => {
    expect(pickFile(null)).toEqual({ error: 'No file selected.' });
    expect(pickFile([])).toEqual({ error: 'No file selected.' });
  });

  it('reports the validation error for an unsupported file', () => {
    const result = pickFile([file('a.txt', 'text/plain')]);
    expect('error' in result).toBe(true);
  });
});
