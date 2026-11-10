import { describe, expect, it } from 'vitest';
import { imageUrl, thumbnailUrl } from '../src/api';
import { validateThumbParams } from '../src/thumb';

describe('Thumbnail API and security parameter validation', () => {
  it('adds the content version so a reused file name never shows a cached older image', () => {
    const before = { filename: 'ComfyMUI_00001_.png', subfolder: '', type: 'output', v: 1000 };
    const after = { ...before, v: 2000 };
    expect(thumbnailUrl('/comfy', before)).toBe(
      '/comfy/thumb?filename=ComfyMUI_00001_.png&subfolder=&type=output&v=1000',
    );
    expect(thumbnailUrl('/comfy', after)).not.toBe(thumbnailUrl('/comfy', before));
    expect(imageUrl('/comfy', after)).toContain('&v=2000');
  });
  it('generates correct thumbnail URL for /comfy and falls back for external base', () => {
    const ref = { filename: 'test.png', subfolder: 'sub', type: 'output' };
    expect(thumbnailUrl('/comfy', ref)).toBe(
      '/comfy/thumb?filename=test.png&subfolder=sub&type=output',
    );
    expect(thumbnailUrl('http://127.0.0.1:8188', ref)).toBe(
      'http://127.0.0.1:8188/view?filename=test.png&subfolder=sub&type=output',
    );
  });

  it('validates safe thumbnail parameters and rejects directory traversal', () => {
    expect(validateThumbParams('valid.png', '', 'output')).toBe(true);
    expect(validateThumbParams('image.webp', 'my_subfolder', 'output')).toBe(true);

    // Directory traversal in filename
    expect(validateThumbParams('../secret.png')).toBe(false);
    expect(validateThumbParams('sub/image.png')).toBe(false);
    expect(validateThumbParams('sub\\image.png')).toBe(false);
    expect(validateThumbParams('')).toBe(false);

    // Directory traversal in subfolder
    expect(validateThumbParams('test.png', '../etc')).toBe(false);
    expect(validateThumbParams('test.png', '..\\etc')).toBe(false);

    // Invalid type
    expect(validateThumbParams('test.png', '', 'invalid')).toBe(false);
  });
});
