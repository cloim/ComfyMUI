import { describe, it, expect } from 'vitest';
import { defaults } from '../src/domain';
import { mapSampler, remixSettings } from '../src/remix';

const samplers = ['euler', 'euler_ancestral', 'dpmpp_2m', 'ipndm'];
const schedulers = ['simple', 'normal', 'karras', 'beta'];
const current = { ...defaults, model: 'Flux1.D/x.safetensors', architecture: 'flux' as const };

describe('remix from a CivitAI example', () => {
  it('maps A1111 sampler names and a scheduler suffix to ComfyUI ids', () => {
    expect(mapSampler('DPM++ 2M Karras', '', samplers, schedulers)).toEqual(['dpmpp_2m', 'karras']);
    expect(mapSampler('Euler a', 'Simple', samplers, schedulers)).toEqual(['euler_ancestral', 'simple']);
    expect(mapSampler('IPNDM', '', samplers, schedulers)).toEqual(['ipndm', '']);
    expect(mapSampler('Restart', 'Align Your Steps', samplers, schedulers)).toEqual(['', '']);
  });

  it('takes prompt, seed, size and sampling values but keeps the model and LoRA', () => {
    const { settings, applied } = remixSettings(
      { ...current, loras: [{ name: 'a', model: 1, clip: 1 }], random: true, batch: 3 },
      {
        prompt: 'a cabin',
        negativePrompt: 'blurry',
        seed: 564468657,
        Size: '896x1152',
        steps: 23,
        cfgScale: 1,
        sampler: 'Euler',
        'Schedule type': 'Simple',
        'Distilled CFG Scale': '3.5',
      },
      {},
      { samplers, schedulers },
    );
    expect(settings).toMatchObject({
      positive: 'a cabin',
      negative: 'blurry',
      seed: 564468657,
      random: false,
      width: 896,
      height: 1152,
      steps: 23,
      cfg: 1,
      guidance: 3.5,
      sampler: 'euler',
      scheduler: 'simple',
      batch: 1,
      model: 'Flux1.D/x.safetensors',
    });
    expect(settings.loras).toHaveLength(1);
    expect(applied).toEqual([
      '프롬프트',
      '네거티브',
      'Seed',
      '크기',
      'Steps',
      'CFG',
      'Guidance',
      'Sampler',
      'Scheduler',
    ]);
  });

  it('rounds the size to the family step and skips values outside the app ranges', () => {
    const { settings, applied } = remixSettings(
      { ...current, architecture: 'qwen21' },
      { prompt: 'x', seed: -4, steps: 400, cfgScale: 99 },
      { width: 1000, height: 1500 },
      { samplers, schedulers },
    );
    expect([settings.width, settings.height]).toEqual([992, 1504]);
    expect(settings.seed).toBe(current.seed);
    expect(applied).toEqual(['프롬프트', '크기']);
  });
});
