import { describe, expect, it } from 'vitest';
import { galleryWindow, galleryRowHeight } from '../src/gallery-window';

describe('gallery viewport', () => {
  it('uses the image aspect ratio, footer, borders and row gap for exact row sizing', () => {
    // 412px content / two columns: 200px card, 198px image, 264px image height.
    expect(galleryRowHeight(412, 2)).toBe(264 + 76 + 2 + 12);
  });
  it('keeps small collections fully rendered', () => {
    expect(galleryWindow(12, 2, 300, 0, 600)).toEqual({ start: 0, end: 12, top: 0, bottom: 0 });
  });
  it('bounds a large collection to visible rows plus overscan', () => {
    const window = galleryWindow(5000, 4, 300, 3000, 900);
    expect(window.start).toBe(32);
    expect(window.end).toBe(60);
    expect(window.top).toBe(2400);
    expect(((window.end - window.start) / 4) * 300 + window.top + window.bottom).toBe(1250 * 300);
  });
  it('includes the last partial row and clamps a stale scroll position', () => {
    const window = galleryWindow(503, 3, 250, 999999, 700);
    expect(window.start).toBe(501);
    expect(window.end).toBe(503);
    expect(window.bottom).toBe(0);
  });
});
