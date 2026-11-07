import { describe, expect, it } from 'vitest';
import { parseBinaryPreview } from '../src/preview';

describe('ComfyUI binary preview protocol parser', () => {
  it('parses valid binary preview frame (type 1) with JPEG format (1)', () => {
    const raw = new Uint8Array(12);
    const view = new DataView(raw.buffer);
    view.setUint32(0, 1, false); // EventType 1 = PREVIEW_IMAGE
    view.setUint32(4, 1, false); // Format 1 = JPEG
    raw[8] = 0xff;
    raw[9] = 0xd8;
    raw[10] = 0xff;
    raw[11] = 0xd9;

    const parsed = parseBinaryPreview(raw.buffer);
    expect(parsed).not.toBeNull();
    expect(parsed?.mime).toBe('image/jpeg');
    expect(parsed?.blob.size).toBe(4);
  });

  it('parses valid binary preview frame (type 1) with PNG format (2)', () => {
    const raw = new Uint8Array(16);
    const view = new DataView(raw.buffer);
    view.setUint32(0, 1, false); // EventType 1 = PREVIEW_IMAGE
    view.setUint32(4, 2, false); // Format 2 = PNG

    const parsed = parseBinaryPreview(raw.buffer);
    expect(parsed).not.toBeNull();
    expect(parsed?.mime).toBe('image/png');
    expect(parsed?.blob.size).toBe(8);
  });

  it('ignores invalid event types or short buffers', () => {
    expect(parseBinaryPreview(new ArrayBuffer(6))).toBeNull();

    const raw = new Uint8Array(10);
    const view = new DataView(raw.buffer);
    view.setUint32(0, 99, false); // Unknown event type
    expect(parseBinaryPreview(raw.buffer)).toBeNull();
  });
});
