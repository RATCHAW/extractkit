import type { BBox } from 'extractkit';

/** A positioned text run from the PDF text layer, normalized 0–1, origin top-left. */
export interface TextSpan {
  text: string;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/**
 * Textual forms a value may take on the page, most specific first. Numbers get
 * plain, two-decimal, and thousands-separated renderings so `6000` can match
 * "$6,000.00".
 */
export function candidateStrings(value: unknown): string[] {
  if (typeof value === 'string') {
    const trimmed = value.replace(/\s+/g, ' ').trim();
    return trimmed === '' ? [] : [trimmed];
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    const plain = String(value);
    const fixed = value.toFixed(2);
    const grouped = (s: string) =>
      s.replace(/^(-?)(\d+)/, (_, sign: string, int: string) => sign + int.replace(/\B(?=(\d{3})+(?!\d))/g, ','));
    const forms = [grouped(fixed), fixed, grouped(plain), plain];
    return [...new Set(forms)].sort((a, b) => b.length - a.length);
  }
  if (typeof value === 'boolean') return [String(value)];
  return [];
}

interface LineChar {
  span: TextSpan;
  /** Fractional [start, end) position of this character within its span. */
  start: number;
  end: number;
}

interface Line {
  text: string;
  chars: (LineChar | null)[];
}

/**
 * Groups spans into visual lines (reading order), concatenating their text.
 * A space is inserted between spans separated by a visible horizontal gap;
 * inserted spaces map to `null` in `chars`.
 */
export function buildLines(spans: TextSpan[]): Line[] {
  const sorted = [...spans].sort((a, b) => (a.y0 + a.y1) / 2 - (b.y0 + b.y1) / 2 || a.x0 - b.x0);
  const groups: TextSpan[][] = [];
  for (const span of sorted) {
    const center = (span.y0 + span.y1) / 2;
    const group = groups.find((g) => {
      const last = g[g.length - 1]!;
      const tolerance = Math.max(span.y1 - span.y0, last.y1 - last.y0) * 0.6;
      return Math.abs(center - (last.y0 + last.y1) / 2) <= tolerance;
    });
    if (group !== undefined) group.push(span);
    else groups.push([span]);
  }

  return groups.map((group) => {
    group.sort((a, b) => a.x0 - b.x0);
    let text = '';
    const chars: (LineChar | null)[] = [];
    for (const [i, span] of group.entries()) {
      if (i > 0) {
        const prev = group[i - 1]!;
        const gap = span.x0 - prev.x1;
        const charWidth = (span.x1 - span.x0) / Math.max(1, span.text.length);
        if (gap > charWidth * 0.35 && !text.endsWith(' ')) {
          text += ' ';
          chars.push(null);
        }
      }
      const width = span.x1 - span.x0;
      for (let c = 0; c < span.text.length; c++) {
        text += span.text[c]!;
        chars.push({
          span,
          start: span.x0 + (width * c) / span.text.length,
          end: span.x0 + (width * (c + 1)) / span.text.length,
        });
      }
    }
    return { text, chars };
  });
}

const isWordChar = (ch: string | undefined): boolean => ch !== undefined && /[0-9a-z]/i.test(ch);

interface Match {
  bbox: BBox;
  candidateLength: number;
}

function findMatches(candidate: string, lines: Line[]): Match[] {
  const needle = candidate.toLowerCase();
  const matches: Match[] = [];
  for (const line of lines) {
    const haystack = line.text.toLowerCase();
    let from = 0;
    for (;;) {
      const at = haystack.indexOf(needle, from);
      if (at === -1) break;
      from = at + 1;
      // Reject matches glued to surrounding word characters ("40" inside "$400").
      if (isWordChar(haystack[at - 1]) || isWordChar(haystack[at + needle.length])) continue;
      const covered = line.chars.slice(at, at + needle.length).filter((c): c is LineChar => c !== null);
      if (covered.length === 0) continue;
      matches.push({
        bbox: {
          x0: Math.min(...covered.map((c) => c.start)),
          y0: Math.min(...covered.map((c) => c.span.y0)),
          x1: Math.max(...covered.map((c) => c.end)),
          y1: Math.max(...covered.map((c) => c.span.y1)),
        },
        candidateLength: candidate.length,
      });
    }
  }
  return matches;
}

const center = (b: BBox): [number, number] => [(b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2];

function distance(a: BBox, b: BBox): number {
  const [ax, ay] = center(a);
  const [bx, by] = center(b);
  return Math.hypot(ax - bx, ay - by);
}

/**
 * Locates a value in a page's text layer: the occurrence of its longest
 * matching textual form closest to the model's approximate bbox (or the first
 * occurrence when the model gave none). Null when the text isn't on the page.
 */
export function matchBBox(value: unknown, bbox: BBox | null, spans: TextSpan[]): BBox | null {
  if (spans.length === 0) return null;
  const lines = buildLines(spans);
  for (const candidate of candidateStrings(value)) {
    const matches = findMatches(candidate, lines);
    if (matches.length === 0) continue;
    if (bbox === null) return matches[0]!.bbox;
    matches.sort((a, b) => distance(a.bbox, bbox) - distance(b.bbox, bbox));
    return matches[0]!.bbox;
  }
  return null;
}

/**
 * Snaps a model-reported bbox to the actual text on the page; falls back to
 * the model bbox when the value can't be located in the text layer.
 */
export function snapBBox(value: unknown, bbox: BBox | null, spans: TextSpan[]): BBox | null {
  return matchBBox(value, bbox, spans) ?? bbox;
}

export interface LocatedField {
  page: number;
  bbox: BBox;
}

/**
 * Places a field on a document by searching every page's text layer, starting
 * from the model-reported page. Rescues fields the model failed to locate
 * (null bbox/page) and fields with an out-of-range page index (e.g. 1-based).
 * Falls back to the model's own provenance when the text can't be found;
 * null when there is nothing usable to show.
 */
export function locateField(
  value: unknown,
  page: number | null,
  bbox: BBox | null,
  spansByPage: TextSpan[][],
): LocatedField | null {
  const reported = page !== null && page >= 0 && page < spansByPage.length ? page : null;
  const order = [...spansByPage.keys()].sort((a, b) => (a === reported ? -1 : b === reported ? 1 : a - b));
  for (const p of order) {
    const match = matchBBox(value, p === reported ? bbox : null, spansByPage[p]!);
    if (match !== null) return { page: p, bbox: match };
  }
  if (bbox !== null) return { page: reported ?? 0, bbox };
  return null;
}
