import { describe, expect, it } from 'vitest';
import type { TextSpan } from '../src/client/lib/snap';
import { candidateStrings, locateField, snapBBox } from '../src/client/lib/snap';

const span = (text: string, x0: number, y0: number, x1: number, y1: number): TextSpan => ({
  text,
  x0,
  y0,
  x1,
  y1,
});

describe('candidateStrings', () => {
  it('renders numbers as plain, two-decimal, and thousands-grouped forms', () => {
    expect(candidateStrings(6000)).toEqual(['6,000.00', '6000.00', '6,000', '6000']);
    expect(candidateStrings(760)).toEqual(['760.00', '760']);
    expect(candidateStrings(-1234.5)).toEqual(['-1,234.50', '-1234.50', '-1,234.5', '-1234.5']);
  });

  it('collapses whitespace in strings and skips empty values', () => {
    expect(candidateStrings('  ACME   CORP ')).toEqual(['ACME CORP']);
    expect(candidateStrings('')).toEqual([]);
    expect(candidateStrings(null)).toEqual([]);
    expect(candidateStrings(Number.NaN)).toEqual([]);
  });
});

describe('snapBBox', () => {
  const roughBox = { x0: 0.1, y0: 0.12, x1: 0.3, y1: 0.16 };

  it('snaps to the span containing the value', () => {
    const spans = [span('ACME CORPORATION', 0.12, 0.05, 0.4, 0.07)];
    expect(snapBBox('ACME CORPORATION', roughBox, spans)).toEqual({
      x0: 0.12,
      y0: 0.05,
      x1: 0.4,
      y1: 0.07,
    });
  });

  it('matches case-insensitively and inside a longer span, trimming to the substring', () => {
    const spans = [span('Currency: USD', 0.5, 0.2, 0.63, 0.22)];
    const snapped = snapBBox('usd', roughBox, spans);
    // "USD" is the last 3 of 13 characters: starts 10/13 of the way in.
    expect(snapped?.x0).toBeCloseTo(0.5 + 0.13 * (10 / 13), 5);
    expect(snapped?.x1).toBeCloseTo(0.63, 5);
    expect(snapped?.y0).toBe(0.2);
    expect(snapped?.y1).toBe(0.22);
  });

  it('matches formatted currency amounts for numeric values', () => {
    const spans = [span('$6,000.00', 0.8, 0.4, 0.9, 0.42)];
    const snapped = snapBBox(6000, roughBox, spans);
    expect(snapped?.y0).toBe(0.4);
    expect(snapped?.x0).toBeGreaterThan(0.8); // "$" is excluded
    expect(snapped?.x1).toBeCloseTo(0.9, 5);
  });

  it('rejects matches glued to other word characters', () => {
    const spans = [span('$400.00', 0.1, 0.1, 0.2, 0.12), span('40', 0.5, 0.5, 0.53, 0.52)];
    const snapped = snapBBox(40, { x0: 0.1, y0: 0.1, x1: 0.2, y1: 0.12 }, spans);
    // "40" inside "$400.00" is not a valid match even though it is closer.
    expect(snapped?.x0).toBe(0.5);
  });

  it('picks the occurrence nearest the model bbox when the value repeats', () => {
    const spans = [
      span('$500.00', 0.8, 0.3, 0.9, 0.32),
      span('$500.00', 0.8, 0.7, 0.9, 0.72),
    ];
    const nearTop = snapBBox(500, { x0: 0.75, y0: 0.25, x1: 0.95, y1: 0.35 }, spans);
    expect(nearTop?.y0).toBe(0.3);
    const nearBottom = snapBBox(500, { x0: 0.75, y0: 0.65, x1: 0.95, y1: 0.75 }, spans);
    expect(nearBottom?.y0).toBe(0.7);
  });

  it('matches values split across adjacent spans on one line', () => {
    const spans = [
      span('ACME', 0.1, 0.05, 0.18, 0.07),
      span('CORPORATION', 0.19, 0.05, 0.4, 0.07),
    ];
    expect(snapBBox('ACME CORPORATION', roughBox, spans)).toEqual({
      x0: 0.1,
      y0: 0.05,
      x1: 0.4,
      y1: 0.07,
    });
  });

  it('falls back to the model bbox when the text is not found', () => {
    const spans = [span('Something else', 0.1, 0.1, 0.3, 0.12)];
    expect(snapBBox('missing value', roughBox, spans)).toEqual(roughBox);
    expect(snapBBox('missing value', null, spans)).toBeNull();
  });

  it('returns the model bbox untouched when there is no text layer', () => {
    expect(snapBBox('anything', roughBox, [])).toEqual(roughBox);
  });

  it('uses the first occurrence when the model gave no bbox', () => {
    const spans = [
      span('$500.00', 0.8, 0.3, 0.9, 0.32),
      span('$500.00', 0.8, 0.7, 0.9, 0.72),
    ];
    expect(snapBBox(500, null, spans)?.y0).toBe(0.3);
  });
});

describe('locateField', () => {
  const page0 = [span('INVOICE', 0.4, 0.05, 0.6, 0.08), span('$760.00', 0.7, 0.5, 0.8, 0.52)];
  const page1 = [span('Terms and conditions', 0.1, 0.1, 0.5, 0.12)];
  const doc = [page0, page1];

  it('rescues a field the model could not locate (null page and bbox)', () => {
    expect(locateField(760, null, null, doc)).toEqual({
      page: 0,
      bbox: { x0: expect.any(Number) as number, y0: 0.5, x1: 0.8, y1: 0.52 },
    });
  });

  it('rescues an out-of-range page index (e.g. 1-based reporting)', () => {
    const located = locateField('INVOICE', 2, { x0: 0.4, y0: 0.05, x1: 0.6, y1: 0.08 }, doc);
    expect(located?.page).toBe(0);
    expect(located?.bbox.y0).toBe(0.05);
  });

  it('searches other pages when the reported page has no match', () => {
    const located = locateField('Terms and conditions', 0, null, doc);
    expect(located?.page).toBe(1);
  });

  it('falls back to the model provenance when the text is not found anywhere', () => {
    const bbox = { x0: 0.1, y0: 0.2, x1: 0.3, y1: 0.25 };
    expect(locateField('not on any page', 1, bbox, doc)).toEqual({ page: 1, bbox });
  });

  it('returns null when nothing can be located and the model gave no bbox', () => {
    expect(locateField('not on any page', null, null, doc)).toBeNull();
    expect(locateField(null, null, null, doc)).toBeNull();
  });
});
