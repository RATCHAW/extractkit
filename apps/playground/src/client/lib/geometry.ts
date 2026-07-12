import type { BBox } from '@ratchaw/extractkit';

export interface BoxStyle {
  left: string;
  top: string;
  width: string;
  height: string;
}

function clamp01(n: number): number {
  if (Number.isNaN(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

function pct(n: number): string {
  return `${(n * 100).toFixed(3)}%`;
}

/**
 * Converts a normalized bbox (0–1, origin top-left) into percentage CSS for an
 * overlay positioned inside a page container. Corners are ordered and clamped so
 * a mildly malformed box still renders as a valid rectangle.
 */
export function bboxToStyle(bbox: BBox): BoxStyle {
  const x0 = clamp01(Math.min(bbox.x0, bbox.x1));
  const y0 = clamp01(Math.min(bbox.y0, bbox.y1));
  const x1 = clamp01(Math.max(bbox.x0, bbox.x1));
  const y1 = clamp01(Math.max(bbox.y0, bbox.y1));
  return { left: pct(x0), top: pct(y0), width: pct(x1 - x0), height: pct(y1 - y0) };
}

/** Fit `intrinsicWidth` into `containerWidth` without upscaling past 1×. */
export function fitScale(intrinsicWidth: number, containerWidth: number): number {
  if (intrinsicWidth <= 0 || containerWidth <= 0) return 1;
  return Math.min(1, containerWidth / intrinsicWidth);
}
