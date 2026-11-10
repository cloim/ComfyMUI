import { describe, it, expect } from 'vitest';
import {
  defaults,
  DEFAULT_PROMPT_ASSEMBLE,
  hasPromptAttribute,
  togglePromptAttribute,
  parseAttributeList,
  buildWorkflow,
  parseWorkflow,
  importPresets,
  validateAgainstServer,
  parseSettings,
  isLegacyDefaultPrompt,
  migrateGenerationSettings,
  trimJobsPreservingFavorites,
  upscaleSettings,
  upscaleSize,
  baseSettings,
  type ObjectInfo,
} from '../src/domain';
const settings = {
  ...defaults,
  model: 'test.safetensors',
  clip1: 'Flux1.D/clip_l.safetensors',
  clip2: 'Flux1.D/t5xxl_fp8.safetensors',
  vae: 'Flux1.D/ae.safetensors',
};
describe('generation graph', () => {
  it('chains LoRA model and CLIP independently and preserves sampling parameters', () => {
    const w = buildWorkflow({
      ...settings,
      seed: 99,
      steps: 12,
      width: 512,
      batch: 3,
      loras: [
        { name: 'a', model: 0.7, clip: 0.3 },
        { name: 'b', model: -0.2, clip: 1 },
      ],
    });
    expect(w['100'].inputs.model).toEqual(['1', 0]);
    expect(w['101'].inputs.model).toEqual(['100', 0]);
    expect(w['101'].inputs.clip).toEqual(['100', 1]);
    expect(w['2'].inputs.clip).toEqual(['101', 1]);
    expect(w['5'].inputs.model).toEqual(['101', 0]);
    expect(w['5'].inputs.seed).toBe(99);
    expect(w['4'].inputs.batch_size).toBe(3);
  });
  it('uses Flux encoders, guidance and VAE without modifying CFG', () => {
    const w = buildWorkflow({
      ...settings,
      architecture: 'flux',
      clip1: 'clip_l',
      clip2: 't5',
      vae: 'ae',
      cfg: 1,
      loras: [{ name: 'style', model: 1, clip: 0.5 }],
    });
    expect(w['100'].inputs.clip).toEqual(['8', 0]);
    expect(w['6'].inputs.vae).toEqual(['9', 0]);
    expect(w['5'].inputs.positive).toEqual(['20', 0]);
    expect(w['5'].inputs.cfg).toBe(1);
    expect(w['4'].class_type).toBe('EmptySD3LatentImage');
  });
  it.each([
    { width: 769 },
    { seed: NaN },
    { steps: -1 },
    { batch: 1.1 },
    { denoise: 2 },
    { loras: [{ name: 'a', model: Infinity, clip: 1 }] },
  ])('rejects invalid generation settings: %o', (v) =>
    expect(() => buildWorkflow({ ...settings, ...v })).toThrow(),
  );
  it('preserves imported graph values rather than applying basic controls', () => {
    const w = buildWorkflow(settings);
    const copied = buildWorkflow({ ...settings, positive: 'changed', steps: 90, workflow: w });
    expect(copied).toEqual(w);
    copied['2'].inputs.text = 'edit';
    expect(w['2'].inputs.text).toBe(defaults.positive);
  });
});
describe('upscale graph', () => {
  const source = { filename: 'ComfyMUI_00001_.png', subfolder: 'day', type: 'output' };
  it('upscales the output image with the model and resizes to the exact target', () => {
    const s = upscaleSettings({ ...settings, batch: 4 }, source, '4x-UltraSharp.pth', 2, 0);
    expect([s.width, s.height, s.batch, s.random]).toEqual([1536, 2048, 1, false]);
    const w = buildWorkflow(s);
    expect(w['50'].inputs.image).toBe('day/ComfyMUI_00001_.png [output]');
    expect(w['52'].inputs).toEqual({ upscale_model: ['51', 0], image: ['50', 0] });
    expect(w['53'].inputs).toMatchObject({ width: 1536, height: 2048, upscale_method: 'lanczos' });
    expect(w['7'].inputs.images).toEqual(['53', 0]);
    expect(Object.keys(w).sort()).toEqual(['50', '51', '52', '53', '7']);
  });
  it('re-samples the upscaled image at the refine strength with the original model', () => {
    const w = buildWorkflow(upscaleSettings(settings, source, '4x-UltraSharp.pth', 1.5, 0.35));
    expect(w['4']).toBeUndefined();
    expect(w['54'].inputs).toEqual({ pixels: ['53', 0], vae: ['9', 0] });
    expect(w['5'].inputs).toMatchObject({ latent_image: ['54', 0], denoise: 0.35 });
    expect(w['5'].inputs.positive).toEqual(['20', 0]);
  });
  it('restores the source size when reused, caps the target and skips the image list check', () => {
    const s = upscaleSettings(settings, source, 'x.pth', 2, 0);
    expect(baseSettings(s)).toMatchObject({ width: 768, height: 1024, upscale: null });
    expect(upscaleSize(3000, 1024, 2)).toEqual({ width: 4096, height: 2048 });
    const info: ObjectInfo = {
      LoadImage: { input: { required: { image: [['other.png']] } } },
      UpscaleModelLoader: { input: { required: { model_name: [['x.pth']] } } },
      ImageUpscaleWithModel: { input: { required: {} } },
      ImageScale: { input: { required: {} } },
      SaveImage: { input: { required: {} } },
    };
    expect(() => validateAgainstServer(buildWorkflow(s), info)).not.toThrow();
  });
});
describe('API workflows and server schema', () => {
  it('rejects editor JSON and dangling graph links', () => {
    expect(() => parseWorkflow({ nodes: [] })).toThrow();
    expect(() =>
      parseWorkflow({ '1': { class_type: 'Test', inputs: { model: ['99', 0] } } }),
    ).toThrow();
  });
  it('validates installed options, required fields and numeric ranges', () => {
    const schema: ObjectInfo = {
      Test: { input: { required: { model: [['installed']], steps: ['INT', { min: 1, max: 5 }] } } },
    };
    expect(() =>
      validateAgainstServer(
        { '1': { class_type: 'Test', inputs: { model: 'missing', steps: 10 } } },
        schema,
      ),
    ).toThrow('설치값');
    expect(() =>
      validateAgainstServer(
        { '1': { class_type: 'Test', inputs: { model: 'installed' } } },
        schema,
      ),
    ).toThrow('입력이 필요');
    expect(() =>
      validateAgainstServer({ '1': { class_type: 'Missing', inputs: {} } }, schema),
    ).toThrow('서버에 없습니다');
    expect(() =>
      validateAgainstServer(
        { '1': { class_type: 'Test', inputs: { model: 'installed', steps: 4 } } },
        schema,
      ),
    ).not.toThrow();
  });
});
describe('portable presets', () => {
  it('imports new IDs and deep snapshots without overwriting originals', () => {
    const original = { id: 'old', name: '숲', description: '아침', settings, color: 'sage' };
    const [p] = importPresets(JSON.stringify({ version: 1, presets: [original] }));
    expect(p.id).not.toBe('old');
    expect(p.settings).toEqual(settings);
    p.settings.positive = 'new';
    expect(original.settings.positive).toBe(defaults.positive);
  });
  it('rejects malformed imports and bad advanced values', () => {
    expect(() => importPresets('{')).toThrow();
    expect(() => importPresets(JSON.stringify({ version: 2, presets: [] }))).toThrow();
    expect(() => parseSettings({ ...settings, cfg: NaN })).toThrow();
    expect(() =>
      importPresets(JSON.stringify({ version: 1, presets: [{ name: '', settings }] })),
    ).toThrow();
  });
  it('detects legacy alpine landscape prompt and migrates to adult portrait prompt', () => {
    const legacyText =
      'A quiet cabin nestled in a misty alpine forest, warm light glowing through the windows, towering mountains, cinematic composition, soft morning light, intricate details';
    expect(isLegacyDefaultPrompt(legacyText)).toBe(true);
    expect(isLegacyDefaultPrompt('A peaceful mountain cabin in a pine forest')).toBe(true);
    expect(isLegacyDefaultPrompt('Custom prompt for my art')).toBe(false);

    const migrated = migrateGenerationSettings({ ...settings, positive: legacyText });
    expect(migrated.positive).toBe(defaults.positive);
    expect(migrated.positive).toContain('portrait of an elegant adult woman');

    const custom = migrateGenerationSettings({ ...settings, positive: 'Custom prompt' });
    expect(custom.positive).toBe('Custom prompt');
  });
  it('corrects artifact-prone SDE sampler back to euler for flow matching models', () => {
    const badKrea = migrateGenerationSettings({
      ...settings,
      architecture: 'krea2',
      sampler: 'dpmpp_2m_sde',
      steps: 16,
    });
    expect(badKrea.sampler).toBe('euler');
    expect(badKrea.steps).toBe(8);

    const goodFlux = migrateGenerationSettings({
      ...settings,
      architecture: 'flux',
      sampler: 'euler',
      steps: 24,
    });
    expect(goodFlux.sampler).toBe('euler');
    expect(goodFlux.steps).toBe(24);
  });
  it('protects favorite jobs during job trimming when limit is reached', () => {
    const jobs = Array.from({ length: 10 }, (_, i) => ({
      id: `job-${i}`,
      createdAt: i * 1000,
      base: 'http://localhost:8188',
      preview: false,
      status: 'complete' as const,
      progress: 100,
      images: [],
      settings,
      favorite: i === 0 || i === 2, // 가장 오래된 0번과 2번이 즐겨찾기
    }));

    // limit을 5개로 줄였을 때
    const trimmed = trimJobsPreservingFavorites(jobs, 5);
    expect(trimmed.length).toBe(5);
    // 즐겨찾기 2건은 반드시 보존되어야 함
    expect(trimmed.some((j) => j.id === 'job-0')).toBe(true);
    expect(trimmed.some((j) => j.id === 'job-2')).toBe(true);
  });
  it('defines default prompt assemble elements and toggles multiple attributes cleanly', () => {
    expect(DEFAULT_PROMPT_ASSEMBLE.map((e) => e.name)).toEqual(['앵글', '구성', '구도']);
    expect(DEFAULT_PROMPT_ASSEMBLE[0].attributes).toEqual([
      'eye-level',
      'low',
      'high',
      'bird-eye',
      "worm's-eye",
    ]);
    expect(DEFAULT_PROMPT_ASSEMBLE[1].attributes).toEqual([
      'extreme close-up',
      'choker',
      'close-up',
      'portrait',
      'bust',
      'waist-up',
      'half body',
      'cowboy',
      'knee',
      'full shot',
    ]);
    expect(DEFAULT_PROMPT_ASSEMBLE[2].attributes).toEqual([
      'dutch',
      'over-the-shoulder',
      'POV',
      'center composition',
      'frame-in-frame',
    ]);

    let p = 'A portrait of a woman';
    p = togglePromptAttribute(p, 'eye-level');
    p = togglePromptAttribute(p, 'low');
    expect(hasPromptAttribute(p, 'eye-level')).toBe(true);
    expect(hasPromptAttribute(p, 'low')).toBe(true);
    expect(p).toBe('A portrait of a woman, eye-level, low');

    p = togglePromptAttribute(p, 'eye-level');
    expect(hasPromptAttribute(p, 'eye-level')).toBe(false);
    expect(hasPromptAttribute(p, 'low')).toBe(true);
    expect(p).toBe('A portrait of a woman, low');

    expect(parseAttributeList('a, b / c, A')).toEqual(['a', 'b', 'c']);
  });
});
