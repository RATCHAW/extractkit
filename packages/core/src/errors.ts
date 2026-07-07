import type { ExtractUsage } from './types.js';

export type ExtractErrorCode =
  | 'SCHEMA_UNSUPPORTED'
  | 'UNSUPPORTED_MEDIA_TYPE'
  | 'MEDIA_TYPE_MISMATCH'
  | 'ENCRYPTED_DOCUMENT'
  | 'INVALID_DOCUMENT'
  | 'DOCUMENT_UNREADABLE'
  | 'EXTRACTION_FAILED'
  | 'MISSING_REQUIRED_FIELDS';

/**
 * Base class for all extractkit errors. Provider/transport errors from the
 * AI SDK (rate limits, auth, aborts) are not wrapped and propagate as-is.
 */
export class ExtractKitError extends Error {
  readonly code: ExtractErrorCode;

  constructor(code: ExtractErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.code = code;
    this.name = new.target.name;
  }
}

/** The extraction schema uses a type that cannot carry provenance. */
export class UnsupportedSchemaError extends ExtractKitError {
  /** Path of the offending schema node, e.g. `$.lineItems[].price`. */
  readonly path: string;

  constructor(path: string, message: string) {
    super('SCHEMA_UNSUPPORTED', `${message} (at ${path})`);
    this.path = path;
  }
}

export type DocumentErrorCode = Extract<
  ExtractErrorCode,
  'UNSUPPORTED_MEDIA_TYPE' | 'MEDIA_TYPE_MISMATCH' | 'ENCRYPTED_DOCUMENT' | 'INVALID_DOCUMENT'
>;

/** The input document could not be accepted; thrown before any model call. */
export class DocumentError extends ExtractKitError {
  declare readonly code: DocumentErrorCode;

  constructor(code: DocumentErrorCode, message: string, cause?: unknown) {
    super(code, message, { cause });
  }
}

/** The model reported the document as unreadable (blank, illegible, not a document). */
export class DocumentUnreadableError extends ExtractKitError {
  /** The model's stated reading problems. */
  readonly issues: string[];
  readonly usage: ExtractUsage;

  constructor(issues: string[], usage: ExtractUsage) {
    super(
      'DOCUMENT_UNREADABLE',
      `Model reported the document as unreadable${issues.length > 0 ? `: ${issues.join('; ')}` : '.'}`,
    );
    this.issues = issues;
    this.usage = usage;
  }
}

/** The model kept producing invalid output after all repair attempts. */
export class ExtractionFailedError extends ExtractKitError {
  /** Model calls made, including repairs. */
  readonly attempts: number;
  readonly usage: ExtractUsage;
  /** Raw text of the last model response, when available. */
  readonly rawText: string | undefined;

  constructor(message: string, opts: { attempts: number; usage: ExtractUsage; rawText?: string; cause?: unknown }) {
    super('EXTRACTION_FAILED', message, { cause: opts.cause });
    this.attempts = opts.attempts;
    this.usage = opts.usage;
    this.rawText = opts.rawText;
  }
}

/**
 * The document was readable but required fields were not found. Carries the
 * partial extraction so callers can decide what to do with it.
 */
export class MissingRequiredFieldsError extends ExtractKitError {
  /** Paths of the missing required fields, e.g. `$.total`. */
  readonly missingPaths: string[];
  /** Unvalidated partial extraction (missing fields omitted). */
  readonly partial: { data: unknown; fields: unknown };
  readonly attempts: number;
  readonly usage: ExtractUsage;

  constructor(opts: {
    missingPaths: string[];
    partial: { data: unknown; fields: unknown };
    attempts: number;
    usage: ExtractUsage;
  }) {
    super('MISSING_REQUIRED_FIELDS', `Required fields not found in document: ${opts.missingPaths.join(', ')}`);
    this.missingPaths = opts.missingPaths;
    this.partial = opts.partial;
    this.attempts = opts.attempts;
    this.usage = opts.usage;
  }
}
