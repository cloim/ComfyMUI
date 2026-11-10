import { describe, expect, it } from 'vitest';
import {
  appendTriggerWords,
  formatBytes,
  inferFamilyFromLoraItem,
  isVideoPreview,
  loraPreviewUrl,
  civitaiAirProblem,
  parseCivitaiAir,
  parseUsageTips,
  resolveComfyLoraName,
  serializeUsageTips,
} from '../src/lora-manager';

describe('LoRA Manager domain helpers', () => {
  it('parses CivitAI AIR codes', () => {
    expect(parseCivitaiAir('urn:air:flux1:lora:civitai:840370@940211')).toEqual({
      ecosystem: 'flux1',
      type: 'lora',
      modelId: 840370,
      modelVersionId: 940211,
    });
    expect(parseCivitaiAir('  sdxl:checkpoint:civitai:101055  ')).toEqual({
      ecosystem: 'sdxl',
      type: 'checkpoint',
      modelId: 101055,
    });
    expect(parseCivitaiAir('urn:air:sdxl:lora:civitai:328553@368189.safetensors')).toMatchObject({
      modelVersionId: 368189,
    });
    expect(parseCivitaiAir('urn:air:krea2:checkpoint:civitai:2997793@3400188+3290672')).toEqual({
      ecosystem: 'krea2',
      type: 'checkpoint',
      modelId: 2997793,
      modelVersionId: 3400188,
      fileId: 3290672,
    });
    expect(parseCivitaiAir('air:sdxl:checkpoint:civitai:827184@2514310')).toMatchObject({
      modelId: 827184,
      modelVersionId: 2514310,
    });
    expect(parseCivitaiAir('urn:air:sdxl:checkpoint:civitai:827184+2402203')).toBeNull();
    expect(parseCivitaiAir('https://civitai.com/models/840370')).toBeNull();
    expect(parseCivitaiAir('840370')).toBeNull();
    expect(parseCivitaiAir('urn:air:sdxl:lora:huggingface:840370')).toBeNull();
    expect(parseCivitaiAir('')).toBeNull();
  });

  it('rejects AIR codes that do not fit the target screen', () => {
    expect(civitaiAirProblem('urn:air:flux1:lora:civitai:1@2', 'lora')).toBe('');
    expect(civitaiAirProblem('urn:air:flux1:checkpoint:civitai:1@2', 'model')).toBe('');
    expect(civitaiAirProblem('urn:air:flux1:checkpoint:civitai:1@2', 'lora')).toContain('LoRA');
    expect(civitaiAirProblem('urn:air:flux1:lora:civitai:1@2', 'model')).toContain('체크포인트');
    expect(civitaiAirProblem('urn:air:sdxl:vae:civitai:1@2', 'model')).toContain('체크포인트');
    expect(
      civitaiAirProblem('urn:air:krea2:checkpoint:civitai:2997793@3400188+3290672', 'model'),
    ).toBe('');
    expect(civitaiAirProblem('', 'model')).toContain('입력');
    expect(civitaiAirProblem('840370', 'model')).toContain('형식');
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
    const comfyList = ['Flux1.D\\illust\\simple_drawing.safetensors', 'Krea2/style.safetensors'];
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
