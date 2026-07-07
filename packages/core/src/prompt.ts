import type { UserModelMessage } from 'ai';
import type { NormalizedDocument } from './types.js';

/**
 * Extraction rules shared by every call. Kept exported so the eval harness
 * can pin the exact prompt a benchmark run used.
 */
export const SYSTEM_PROMPT = `You are a precise document data extraction engine.

Extract the requested fields from the attached document and return JSON that matches the response schema exactly. Every leaf field is an object { "value", "page", "bbox", "confidence" }:

- "value": the value as it appears in the document. Never guess, compute, or infer a value that is not visibly present. Use null when the field is absent or illegible. When the schema or a field description requires a format (for example an ISO date), convert the document's text to that format.
- "page": 0-based index of the page the value was read from, or null when "value" is null. An image input is always page 0.
- "bbox": [x0, y0, x1, y1] — the tightest region containing the source text, normalized to page width and height (each coordinate between 0 and 1), origin at the top-left corner, x0 < x1 and y0 < y1. Use null when you cannot locate the value.
- "confidence": your honest probability (0 to 1) that "value" is exactly correct. Use low values for blurry, ambiguous, or partially cut-off text. Do not default to high confidence.

Numbers must be plain JSON numbers without currency symbols or thousands separators. Strings keep the document's spelling and casing unless a field description says otherwise.

Set "readable" to false and explain why in "issues" when the document is blank, unreadable, or not a document at all. Also use "issues" for notable problems (heavy skew, cut-off regions, watermarks) even when the document is readable.`;

export function buildSystemPrompt(instructions: string | undefined): string {
  if (instructions == null || instructions.trim() === '') return SYSTEM_PROMPT;
  return `${SYSTEM_PROMPT}\n\nAdditional instructions for this extraction:\n${instructions.trim()}`;
}

export const TASK_MESSAGE = 'Extract the fields defined by the response schema from the attached document.';

export function buildUserMessage(doc: NormalizedDocument): UserModelMessage {
  return {
    role: 'user',
    content: [
      {
        type: 'file',
        data: doc.bytes,
        mediaType: doc.mediaType,
        ...(doc.filename != null ? { filename: doc.filename } : {}),
      },
      { type: 'text', text: TASK_MESSAGE },
    ],
  };
}

export function buildRepairMessage(reasons: string[]): string {
  return `Your previous response was rejected:\n${reasons.map((r) => `- ${r}`).join('\n')}\n\nReturn the complete corrected extraction JSON in the same format. Keep values faithful to the document; use null for values that are not present.`;
}
