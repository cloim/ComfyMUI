import { describe, expect, it, vi } from 'vitest';
import { replacePreview, matchLoraItem, type LoraItem } from '../src/lora-manager';
import { matchModelItem, type ModelManagerItem } from '../src/model-manager';

describe('Preview image replacement and matching helpers', () => {
  it('calls replace-preview endpoint with correct multipart form data order', async () => {
    let capturedUrl = '';
    let capturedBody: FormData | null = null;

    // Mock fetch
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi
      .fn()
      .mockImplementation(async (url: string | URL | Request, init?: RequestInit) => {
        capturedUrl = String(url);
        capturedBody = init?.body as FormData;
        return new Response(
          JSON.stringify({
            success: true,
            preview_url: '/api/lm/previews?path=test.png',
            preview_nsfw_level: 0,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      });

    try {
      const dummyBlob = new Blob(['dummy-image-data'], { type: 'image/png' });
      const res = await replacePreview(
        '/comfy',
        'checkpoints',
        '/data/models/Flux1.D/model.safetensors',
        dummyBlob,
        'output_001.png',
      );

      expect(res.preview_url).toBe('/api/lm/previews?path=test.png');
      expect(capturedUrl).toBe('/comfy/api/lm/checkpoints/replace-preview');
      expect(capturedBody).toBeInstanceOf(FormData);

      // Verify FormData entries
      const entries = Array.from((capturedBody as unknown as FormData).entries());
      expect(entries[0][0]).toBe('preview_file');
      expect(entries[1][0]).toBe('model_path');
      expect(entries[1][1]).toBe('/data/models/Flux1.D/model.safetensors');
      expect(entries[2][0]).toBe('nsfw_level');
      expect(entries[2][1]).toBe('0');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('handles replacePreview error when server returns failure', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          success: false,
          error: 'Model path does not exist',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    try {
      const dummyBlob = new Blob(['data'], { type: 'image/png' });
      await expect(
        replacePreview('/comfy', 'loras', '/nonexistent.safetensors', dummyBlob),
      ).rejects.toThrow('Model path does not exist');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('matches models and loras regardless of path separators and case', () => {
    const model: ModelManagerItem = {
      model_name: 'Flux Dev',
      file_name: 'flux1-dev-fp8',
      folder: 'Flux1.D',
      file_path: 'E:/Models/diffusion_models/Flux1.D/flux1-dev-fp8.safetensors',
      preview_url: '',
      preview_nsfw_level: 0,
      base_model: 'Flux.1 D',
      sha256: 'abc',
      file_size: 100,
      modified: 1,
      tags: [],
      from_civitai: false,
      notes: '',
      favorite: false,
      update_available: false,
    };

    const lora: LoraItem = {
      model_name: 'Detail Tweaker',
      file_name: 'detail_slider_v1.0',
      folder: 'Flux1.D/detail',
      file_path: 'E:/Models/loras/Flux1.D/detail/detail_slider_v1.0.safetensors',
      preview_url: '',
      preview_nsfw_level: 0,
      base_model: 'Flux.1 D',
      sha256: 'def',
      file_size: 50,
      modified: 1,
      tags: [],
      from_civitai: false,
      notes: '',
      favorite: false,
      update_available: false,
      usage_tips: '{}',
    };

    // Windows backslash vs Unix forward slash
    expect(matchModelItem('Flux1.D\\flux1-dev-fp8.safetensors', [model], null)).toBe(model);
    expect(matchModelItem('flux1.d/flux1-dev-fp8.safetensors', [model], null)).toBe(model);
    expect(matchModelItem('flux1-dev-fp8', [model], null)).toBe(model);

    expect(matchLoraItem('Flux1.D\\detail\\detail_slider_v1.0.safetensors', [lora])).toBe(lora);
    expect(matchLoraItem('Flux1.D/detail/detail_slider_v1.0.safetensors', [lora])).toBe(lora);
    expect(matchLoraItem('detail_slider_v1.0', [lora])).toBe(lora);
  });
});
