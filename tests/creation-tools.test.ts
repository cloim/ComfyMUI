import { describe, expect, it } from 'vitest';
import { defaults, type Generation } from '../src/domain';
import {
  buildExperiment,
  makeDraftSettings,
  makeFinalSettings,
  parseExperimentValues,
  reusableSettings,
} from '../src/creation-tools';

const settings = (): Generation => ({
  ...defaults,
  model: 'portrait.safetensors',
  positive: 'a tree',
  width: 1024,
  height: 768,
  steps: 24,
  seed: 42,
  random: false,
  loras: [{ name: 'style.safetensors', model: 0.7, clip: 0.6 }],
});

describe('draft and final generation', () => {
  it.each([
    ['flux', 24, 12, 16],
    ['krea2', 8, 4, 16],
    ['moss', 24, 12, 32],
    ['qwen21', 28, 14, 32],
  ] as const)(
    'keeps %s assets and restores the original final settings',
    (architecture, steps, expectedSteps, multiple) => {
      const base = { ...settings(), architecture, steps };
      const draft = makeDraftSettings(base);
      expect([draft.width, draft.height, draft.steps]).toEqual([768, 576, expectedSteps]);
      expect(draft.width % multiple).toBe(0);
      expect(draft.height % multiple).toBe(0);
      expect(draft.draftTarget).toEqual({ width: 1024, height: 768, steps });
      expect(draft.model).toBe(base.model);
      expect(draft.positive).toBe(base.positive);
      expect(draft.loras).toEqual(base.loras);
      expect(makeDraftSettings(draft)).toEqual(draft);
      const final = makeFinalSettings({ ...draft, seed: 912, random: true });
      expect([final.width, final.height, final.steps, final.seed, final.random]).toEqual([
        1024,
        768,
        steps,
        912,
        false,
      ]);
      expect(final.draftTarget).toBeUndefined();
      expect(base).toEqual({ ...settings(), architecture, steps });
    },
  );

  it('does not enlarge a small image or raise low steps', () => {
    const draft = makeDraftSettings({ ...settings(), width: 64, height: 64, steps: 2 });
    expect([draft.width, draft.height, draft.steps]).toEqual([64, 64, 2]);
  });

  it('rejects custom graphs, upscale jobs and invalid source sizes', () => {
    expect(() => makeDraftSettings({ ...settings(), workflow: {} })).toThrow('기본 이미지');
    expect(() => makeDraftSettings({ ...settings(), width: 4097 })).toThrow('원래 해상도');
    expect(() => makeFinalSettings(settings())).toThrow('원래 설정');
  });

  it('rejects incomplete persisted final targets and ignores extra restored properties', () => {
    const draft = makeDraftSettings(settings());
    for (const target of [
      { width: 1024 },
      { width: 1024, height: 768, steps: 0 },
      { width: 1001, height: 768, steps: 24 },
    ]) {
      expect(() =>
        makeFinalSettings({ ...draft, draftTarget: target as Generation['draftTarget'] }),
      ).toThrow();
    }
    const final = makeFinalSettings({
      ...draft,
      draftTarget: {
        width: 1024,
        height: 768,
        steps: 24,
        model: 'unexpected.safetensors',
        positive: 'unexpected prompt',
      } as Generation['draftTarget'],
    });
    expect(final.model).toBe(draft.model);
    expect(final.positive).toBe(draft.positive);
  });

  it('makes reused settings independent of experiment and draft metadata', () => {
    const original = {
      ...makeDraftSettings(settings()),
      experiment: { id: 'group', label: 'Steps 12' },
    };
    const editable = reusableSettings(original);
    expect(editable.draftTarget).toBeUndefined();
    expect(editable.experiment).toBeUndefined();
    expect(editable.width).toBe(original.width);
    expect(editable.steps).toBe(original.steps);
    editable.loras[0].model = 0.1;
    expect(original.loras[0].model).toBe(0.7);
    expect(original.draftTarget).toBeDefined();
    expect(original.experiment.id).toBe('group');
  });
});

describe('controlled experiments', () => {
  it('changes exactly one condition while fixing one random Seed for the whole group', () => {
    const base = { ...settings(), random: true };
    const jobs = buildExperiment(base, 'steps', [8, 12, 16]);
    expect(new Set(jobs.map((j) => j.seed)).size).toBe(1);
    expect(new Set(jobs.map((j) => j.experiment!.id)).size).toBe(1);
    expect(jobs.map((j) => j.steps)).toEqual([8, 12, 16]);
    for (const job of jobs) {
      const { experiment, steps, seed, random, ...rest } = job;
      const { steps: baseSteps, seed: baseSeed, random: baseRandom, ...original } = base;
      expect(rest).toEqual(original);
      expect(random).toBe(false);
      expect(experiment!.label).toBe(`Steps ${steps}`);
    }
    expect(base.random).toBe(true);
  });

  it('changes only the selected LoRA model strength and preserves CLIP', () => {
    const base = settings();
    base.loras.push({ name: 'second.safetensors', model: 1, clip: 0.8 });
    const jobs = buildExperiment(base, 'lora', [0.2, 0.8], 1);
    expect(jobs.map((j) => j.loras[1].model)).toEqual([0.2, 0.8]);
    for (const job of jobs) {
      expect(job.seed).toBe(42);
      expect(job.loras[0]).toEqual(base.loras[0]);
      expect(job.loras[1].clip).toBe(0.8);
      expect(job.loras[1]).not.toBe(base.loras[1]);
    }
    expect(base.loras[1].model).toBe(1);
  });

  it('rejects duplicate, excessive, nonfinite and out of range requests before submission', () => {
    expect(parseExperimentValues('0.4, 0.7, 1')).toEqual([0.4, 0.7, 1]);
    for (const text of ['1', '1, 1', '1, 2, 3, 4, 5, 6, 7', '1, abc', '1, Infinity'])
      expect(() => parseExperimentValues(text)).toThrow();
    expect(() => buildExperiment(settings(), 'steps', [1.5, 4])).toThrow();
    expect(() => buildExperiment(settings(), 'cfg', [2, 31])).toThrow();
    expect(() => buildExperiment(settings(), 'lora', [-3, 0])).toThrow();
    expect(() => buildExperiment({ ...settings(), loras: [] }, 'lora', [0, 1])).toThrow('LoRA');
  });
});
