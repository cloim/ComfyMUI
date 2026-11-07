import { describe, it, expect } from 'vitest';
import {
  defaults,
  buildWorkflow,
  parseWorkflow,
  importPresets,
  validateAgainstServer,
  parseSettings,
  isLegacyDefaultPrompt,
  migrateGenerationSettings,
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
});
