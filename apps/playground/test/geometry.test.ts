import { describe, expect, it } from 'vitest';
import { bboxToStyle, fitScale } from '../src/client/lib/geometry';

describe('bboxToStyle', () => {
  it('maps a normalized box to percentage offsets and size', () => {
    expect(bboxToStyle({ x0: 0.1, y0: 0.2, x1: 0.5, y1: 0.35 })).toEqual({
      left: '10.000%',
      top: '20.000%',
      width: '40.000%',
      height: '15.000%',
    });
  });

  it('orders swapped corners into a valid rectangle', () => {
    expect(bboxToStyle({ x0: 0.5, y0: 0.35, x1: 0.1, y1: 0.2 })).toEqual({
      left: '10.000%',
      top: '20.000%',
      width: '40.000%',
      height: '15.000%',
    });
  });

  it('clamps out-of-range coordinates to [0, 1]', () => {
    expect(bboxToStyle({ x0: -0.2, y0: 0, x1: 1.4, y1: 1 })).toEqual({
      left: '0.000%',
      top: '0.000%',
      width: '100.000%',
      height: '100.000%',
    });
  });
});

describe('fitScale', () => {
  it('scales down to fit and never upscales past 1×', () => {
    expect(fitScale(1000, 500)).toBe(0.5);
    expect(fitScale(400, 800)).toBe(1);
  });

  it('is safe for degenerate inputs', () => {
    expect(fitScale(0, 500)).toBe(1);
    expect(fitScale(500, 0)).toBe(1);
  });
});
