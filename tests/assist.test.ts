import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  assistEncoder,
  assistInstruction,
  buildAssistWorkflow,
  cleanAssistText,
  fitImageSize,
  runAssist,
} from '../src/assist';
import { checkQualityIssues, modelDefaults, selectModel } from '../src/models';
import {
  buildWorkflow,
  defaults,
  preferredUpscaleModel,
  reusableSettings,
  validateGeneration,
  type Generation,
  type ObjectInfo,
} from '../src/domain';

const clips = (names: string[]): ObjectInfo => ({
  CLIPLoader: { input: { required: { clip_name: [names] } } },
  TextGenerate: { input: { required: {} } },
  PreviewAny: { input: { required: {} } },
});

describe('prompt helper encoder', () => {
  it('prefers the fast 4B Qwen3-VL and falls back to 8B', () => {
    expect(
      assistEncoder(
        clips(['qwen3vl_8b_int8_convrot.safetensors', 'Qwen/qwen3vl_4b_fp8_scaled.safetensors']),
      ),
    ).toEqual({ clip: 'Qwen/qwen3vl_4b_fp8_scaled.safetensors', type: 'krea2' });
    expect(assistEncoder(clips(['qwen3vl_8b_int8_convrot.safetensors']))).toEqual({
      clip: 'qwen3vl_8b_int8_convrot.safetensors',
      type: 'qwen_image',
    });
  });
  it('needs a Qwen3-VL encoder and the text nodes', () => {
    // The LTX Gemma encoder cannot generate text, and T5 is not a language model.
    expect(
      assistEncoder(clips(['gemma4-12b-with-proj-ltx-2.5.safetensors', 't5xxl.safetensors'])),
    ).toBeNull();
    const { TextGenerate: _, ...old } = clips(['qwen3vl_4b_fp8_scaled.safetensors']);
    expect(assistEncoder(old)).toBeNull();
    expect(assistEncoder(null)).toBeNull();
  });
});

describe('prompt helper instructions', () => {
  it('writes an image prompt that keeps LoRA trigger words', () => {
    const text = assistInstruction({
      mode: 'write',
      idea: '비 오는 밤 네온',
      family: 'krea2',
      triggers: ['omz'],
    });
    expect(text).toContain('Request: 비 오는 밤 네온');
    expect(text).toContain('"omz"');
    expect(text).toContain('text-to-image');
    expect(text).toContain('Latin letters exactly');
  });
  it('writes a motion prompt for a video family, with sound when audio is on', () => {
    const video = assistInstruction({ mode: 'write', idea: '고양이', family: 'ltx2', audio: true });
    expect(video).toContain('text-to-video');
    expect(video).toContain('sounds');
    expect(assistInstruction({ mode: 'write', idea: 'x', family: 'ltx2' })).not.toContain('sounds');
  });
  it('describes the photo for each photo mode', () => {
    const remake = assistInstruction({
      mode: 'remake',
      idea: '배경을 바다로',
      family: 'krea2',
      triggers: ['yjy'],
    });
    expect(remake).toContain('Recreate the photo');
    expect(remake).toContain('do not describe their face');
    expect(remake).toContain('Apply this change: 배경을 바다로');
    expect(assistInstruction({ mode: 'remake', idea: '', family: 'krea2' })).not.toContain(
      'Apply this change',
    );
    const edit = assistInstruction({ mode: 'edit', idea: '금발로', family: 'qwen21' });
    expect(edit).toContain('image-editing model');
    expect(edit).toContain('stay the same');
    const motion = assistInstruction({ mode: 'motion', idea: '', family: 'ltx2' });
    expect(motion).toContain('first frame of a video');
    expect(motion).toContain('natural, subtle motion');
  });
});

describe('prompt helper output', () => {
  it('strips labels, quotes, thinking and line breaks', () => {
    expect(cleanAssistText('<think>hmm</think>\n"Prompt: A cat\nsits."')).toBe('A cat sits.');
    expect(cleanAssistText('**Instruction:** Change the hair.')).toBe('Change the hair.');
  });
  it('builds a text generation graph that can look at a photo', () => {
    const encoder = { clip: 'qwen3vl_4b.safetensors', type: 'krea2' };
    const w = buildAssistWorkflow(
      encoder,
      'do it',
      'edit',
      {
        filename: 'a.png',
        subfolder: 'assist',
        type: 'input',
      },
      5,
    );
    expect(w['1'].inputs).toEqual({ clip_name: 'qwen3vl_4b.safetensors', type: 'krea2' });
    expect(w['2'].inputs.image).toBe('assist/a.png [input]');
    expect(w['3'].inputs).toMatchObject({
      prompt: 'do it',
      image: ['2', 0],
      max_length: 160,
      'sampling_mode.temperature': 0.3,
      'sampling_mode.seed': 5,
    });
    expect(w['4']).toEqual({ class_type: 'PreviewAny', inputs: { source: ['3', 0] } });
    const text = buildAssistWorkflow(encoder, 'x', 'write');
    expect(text['2']).toBeUndefined();
    expect(text['3'].inputs.image).toBeUndefined();
    expect(text['3'].inputs['sampling_mode.temperature']).toBe(0.7);
  });
  it('fits a photo to about one megapixel in multiples of 32', () => {
    expect(fitImageSize(3000, 4000)).toEqual({ width: 896, height: 1216 });
    expect(fitImageSize(1920, 1080)).toEqual({ width: 1408, height: 800 });
    const square = fitImageSize(500, 500);
    expect(square.width).toBe(square.height);
    expect(square.width % 32).toBe(0);
  });
});

describe('running the prompt helper', () => {
  afterEach(() => vi.unstubAllGlobals());
  it('queues ahead with its own client and returns the cleaned text', async () => {
    vi.useFakeTimers();
    const calls: { url: string; body?: any }[] = [];
    let polls = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
        if (url.endsWith('/prompt')) return Response.json({ prompt_id: 'x' });
        const id = calls[0].body.prompt_id;
        if (++polls < 2) return Response.json({});
        return Response.json({
          [id]: { status: { completed: true }, outputs: { 4: { text: ['"A quiet harbor."'] } } },
        });
      }),
    );
    const done = runAssist('/comfy', { '1': { class_type: 'X', inputs: {} } });
    await vi.advanceTimersByTimeAsync(2000);
    expect(await done).toBe('A quiet harbor.');
    expect(calls[0].body.front).toBe(true);
    expect(calls[0].body.client_id).toMatch(/^comfymui-assist-/);
    vi.useRealTimers();
  });
  it('reports the ComfyUI error', async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.endsWith('/prompt')) return Response.json({});
        const id = JSON.parse(String((fetch as any).mock.calls[0][1].body)).prompt_id;
        return Response.json({
          [id]: {
            status: {
              status_str: 'error',
              messages: [['execution_error', { exception_message: 'out of memory' }]],
            },
          },
        });
      }),
    );
    const done = runAssist('/comfy', {}).catch((e) => e.message);
    await vi.advanceTimersByTimeAsync(1000);
    expect(await done).toBe('프롬프트를 쓰지 못했어요: out of memory');
    vi.useRealTimers();
  });
});

describe('high-quality finish', () => {
  const s: Generation = {
    ...defaults,
    architecture: 'krea2',
    modelLoader: 'UNETLoader',
    model: 'Krea2/kroma.safetensors',
    clip1: 'qwen3vl_4b.safetensors',
    vae: 'qwen_image_vae.safetensors',
    width: 768,
    height: 1024,
    positive: 'a harbor',
    finish: { model: 'ClearRealityV1/4x-ClearRealityV1_Soft.pth', scale: 1.5, refine: 0.35 },
  };
  it('enlarges and re-samples in the same run, keeping node 5 as the first pass', () => {
    const w = buildWorkflow(s);
    expect(w['5'].inputs.denoise).toBe(s.denoise);
    expect(w['71'].inputs.image).toEqual(['6', 0]);
    expect(w['72'].inputs).toMatchObject({ width: 1152, height: 1536 });
    expect(w['74'].inputs).toMatchObject({
      latent_image: ['73', 0],
      denoise: 0.35,
      seed: s.seed,
      model: w['5'].inputs.model,
    });
    expect(w['7'].inputs.images).toEqual(['75', 0]);
  });
  it('can only enlarge, and is skipped by upscale jobs and video', () => {
    const plain = buildWorkflow({ ...s, finish: { ...s.finish!, refine: 0 } });
    expect(plain['7'].inputs.images).toEqual(['72', 0]);
    expect(plain['74']).toBeUndefined();
    expect(buildWorkflow({ ...s, finish: null })['70']).toBeUndefined();
  });
  it('validates the result size and settings', () => {
    expect(() => validateGeneration(s)).not.toThrow();
    expect(() => validateGeneration({ ...s, width: 3072, height: 3072 })).toThrow('4096px');
    expect(() => validateGeneration({ ...s, finish: { ...s.finish!, scale: 3 } })).toThrow(
      '고화질 마무리 설정',
    );
    expect(() => validateGeneration({ ...s, finish: { ...s.finish!, model: '' } })).toThrow(
      '업스케일 모델',
    );
  });
  it('prefers photo upscalers and skips broken NCNN files', () => {
    expect(
      preferredUpscaleModel([
        '4x-AnimeSharp.pth',
        'ClearRealityV1/BROKEN_NCNN/4x-ClearRealityV1-fp16.bin',
        '4x-UltraSharp.pth',
        'ClearRealityV1/4x-ClearRealityV1.pth',
        'ClearRealityV1/4x-ClearRealityV1_Soft.pth',
      ]),
    ).toBe('ClearRealityV1/4x-ClearRealityV1_Soft.pth');
    expect(preferredUpscaleModel(['4x-AnimeSharp.pth'])).toBe('4x-AnimeSharp.pth');
    expect(preferredUpscaleModel([])).toBe('');
  });
});

describe('photo edits', () => {
  it('keep the photo for the next Qwen 2.1 run but drop scenario references', () => {
    const photo = { filename: 'a.png', subfolder: 'assist', type: 'input' };
    const s: Generation = {
      ...defaults,
      architecture: 'qwen21',
      editSource: photo,
      editReferences: [photo],
    };
    expect(reusableSettings(s).editSource).toEqual(photo);
    expect(reusableSettings(s).editReferences).toBeUndefined();
    expect(reusableSettings({ ...s, architecture: 'krea2' }).editSource).toBeUndefined();
  });
  it('skip the high-quality finish to keep the photo texture', () => {
    const photo = { filename: 'a.png', subfolder: 'assist', type: 'input' };
    const s: Generation = {
      ...defaults,
      architecture: 'qwen21',
      modelLoader: 'CheckpointLoaderSimple',
      model: 'Qwen 2.1/qwen_image_2.1_turbo_int8_convrot.safetensors',
      clip1: 'qwen3vl_8b.safetensors',
      vae: 'qwen_image_2.1_vae.safetensors',
      width: 928,
      height: 1184,
      steps: 8,
      cfg: 1,
      positive: 'Change the hair to blonde.',
      editSource: photo,
      finish: { model: '4x-UltraSharp.pth', scale: 2, refine: 0.35 },
    };
    expect(buildWorkflow(s)['70']).toBeUndefined();
    expect(() => validateGeneration({ ...s, width: 2560, height: 2560 })).not.toThrow();
    expect(buildWorkflow({ ...s, editSource: undefined })['70']).toBeDefined();
  });
});

describe('Qwen 2.1 turbo', () => {
  const turbo = 'Qwen 2.1/qwen_image_2.1_turbo_int8_convrot.safetensors';
  it('uses 8 steps without CFG, unlike the full model', () => {
    expect(modelDefaults('qwen21', turbo)).toEqual({ steps: 8, cfg: 1 });
    expect(modelDefaults('qwen21', 'Qwen2.1/NoctQ_V4.safetensors')).toEqual({ steps: 28, cfg: 4 });
    expect(modelDefaults('krea2', 'Krea2/krea2_turbo_fp8.safetensors')).toEqual({
      steps: 8,
      cfg: 1,
    });
  });
  it('retunes when switching between full and turbo builds of the family', () => {
    const full = {
      ...defaults,
      architecture: 'qwen21',
      model: 'Qwen2.1/NoctQ_V4.safetensors',
      steps: 28,
      cfg: 4,
    } as Generation;
    const next = selectModel(
      full,
      { name: turbo, loader: 'CheckpointLoaderSimple', family: 'qwen21' } as any,
      null,
    );
    expect([next.steps, next.cfg]).toEqual([8, 1]);
    const back = selectModel(
      next,
      { name: 'Qwen2.1/NoctQ_V4.safetensors', loader: 'UNETLoader', family: 'qwen21' } as any,
      null,
    );
    expect([back.steps, back.cfg]).toEqual([28, 4]);
  });
  it('warns about full-model settings on a turbo build', () => {
    const s = {
      ...defaults,
      architecture: 'qwen21',
      model: turbo,
      steps: 28,
      cfg: 4,
      sampler: 'euler',
    } as Generation;
    expect(checkQualityIssues(s).find((i) => i.id === 'qwen-turbo')?.fix).toEqual({
      steps: 8,
      cfg: 1,
    });
    expect(checkQualityIssues({ ...s, steps: 8, cfg: 1 }).some((i) => i.id === 'qwen-turbo')).toBe(
      false,
    );
  });
});
