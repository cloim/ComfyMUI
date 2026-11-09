import { describe, expect, it } from 'vitest';
import {
  appendTriggerWords,
  formatBytes,
  inferFamilyFromLoraItem,
  isVideoPreview,
  loraPreviewUrl,
  parseCivitaiInput,
  parseUsageTips,
  resolveComfyLoraName,
  serializeUsageTips,
} from '../src/lora-manager';

describe('LoRA Manager domain helpers', () => {
  it('parses CivitAI URLs and numeric IDs', () => {
    expect(
      parseCivitaiInput('https://civitai.com/models/840370?modelVersionId=940211'),
    ).toEqual({
      modelId: 840370,
      modelVersionId: 940211,
    });
    expect(parseCivitaiInput('https://civitai.com/models/840370/flux-detail')).toEqual({
      modelId: 840370,
    });
    expect(parseCivitaiInput('https://civitai.com/api/download/models/940211')).toEqual({
      modelVersionId: 940211,
    });
    expect(parseCivitaiInput('840370', 'auto')).toEqual({ modelId: 840370 });
    expect(parseCivitaiInput('940211', 'version')).toEqual({ modelVersionId: 940211 });
    expect(parseCivitaiInput('')).toEqual({});
  });

  it('parses and serializes usage_tips safely', () => {
    expect(parseUsageTips('{"strength":0.75,"clipStrength":0.8}')).toEqual({
      strength: 0.75,
      clipStrength: 0.8,
    });
    expect(parseUsageTips('invalid json')).toEqual({});
    expect(serializeUsageTips({ strength: 0.75, clipStrength: 0.8 })).toBe(
      '{"strength":0.75,"clipStrength":0.8}',
    );
  });

  it('infers ComfyMUI family from LoRA base_model and path', () => {
    expect(
      inferFamilyFromLoraItem({
        base_model: 'Flux.1 D',
        folder: 'commons',
        file_name: 'detail',
        file_path: 'E:/ComfyUI/models/loras/commons/detail.safetensors',
      }),
    ).toBe('flux');
    expect(
      inferFamilyFromLoraItem({
        base_model: 'Krea2',
        folder: 'Krea2',
        file_name: 'style',
        file_path: 'E:/ComfyUI/models/loras/Krea2/style.safetensors',
      }),
    ).toBe('krea2');
    expect(
      inferFamilyFromLoraItem({
        base_model: 'Qwen',
        folder: 'Qwen',
        file_name: 'portrait',
        file_path: 'E:/ComfyUI/models/loras/Qwen/portrait.safetensors',
      }),
    ).toBe('qwen21');
  });

  it('resolves LoRA Manager item to ComfyUI LoraLoader option string', () => {
    const comfyList = [
      'Flux1.D\\illust\\simple_drawing.safetensors',
      'Krea2/style.safetensors',
    ];
    expect(
      resolveComfyLoraName(
        {
          folder: 'Flux1.D/illust',
          file_name: 'simple_drawing',
          file_path: 'E:/ComfyUI/models/loras/Flux1.D/illust/simple_drawing.safetensors',
        },
        comfyList,
      ),
    ).toBe('Flux1.D\\illust\\simple_drawing.safetensors');
  });

  it('appends trigger words without duplicating existing prompt keywords', () => {
    const initial = 'a portrait of a woman, soft studio glow';
    const next = appendTriggerWords(initial, ['soft studio glow', 'skin detail']);
    expect(next).toBe('a portrait of a woman, soft studio glow, skin detail');
  });

  it('formats preview URLs and bytes accurately', () => {
    expect(loraPreviewUrl('/comfy', '/api/lm/previews?path=test.webp')).toBe(
      '/comfy/api/lm/previews?path=test.webp',
    );
    expect(isVideoPreview('/comfy/api/lm/previews?path=test.mp4&v=1')).toBe(true);
    expect(isVideoPreview('/comfy/api/lm/previews?path=test.webp')).toBe(false);
    expect(formatBytes(154200000)).toBe('147.1 MB');
  });
});
