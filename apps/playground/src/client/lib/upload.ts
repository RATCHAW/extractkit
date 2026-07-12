/** Mirrors the server's upload ceiling so the client can reject early. */
export const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;

const ACCEPTED_EXTENSIONS = ['.pdf', '.png', '.jpg', '.jpeg', '.webp'];
const ACCEPTED_TYPE = /^(application\/pdf|image\/(png|jpe?g|webp))$/;

/** The `accept` attribute for the file input. */
export const ACCEPT_ATTR = '.pdf,.png,.jpg,.jpeg,.webp,application/pdf,image/png,image/jpeg,image/webp';

export function isPdf(file: File): boolean {
  return file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
}

/** A client-side pre-check; the server validates authoritatively. Returns an error message, or null when acceptable. */
export function validateFile(file: File): string | null {
  const name = file.name.toLowerCase();
  const okExtension = ACCEPTED_EXTENSIONS.some((ext) => name.endsWith(ext));
  const okType = file.type === '' ? okExtension : ACCEPTED_TYPE.test(file.type);
  if (!okExtension && !okType) return 'Unsupported file type — upload a PDF, PNG, JPEG, or WebP.';
  if (file.size > MAX_UPLOAD_BYTES) return 'File is larger than the 15 MB limit.';
  return null;
}

/**
 * First acceptable file from a drop or picker, or an error message. Typed as
 * ArrayLike so it stays DOM-free (a browser FileList is assignable).
 */
export function pickFile(files: ArrayLike<File> | null): { file: File } | { error: string } {
  const file = files?.[0];
  if (file === undefined) return { error: 'No file selected.' };
  const error = validateFile(file);
  return error === null ? { file } : { error };
}
