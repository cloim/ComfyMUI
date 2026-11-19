import { describe, expect, it } from 'vitest';
import { defaults as defaultSettings, type ObjectInfo } from '../src/domain';
import {
  newScenario,
  newScene,
  promptContextKey,
  promptStale,
  pruneDeletedOutputs,
  sceneGeneration,
  sceneRevision,
  type Scenario,
  type SceneImage,
} from '../src/scenario';
import { mergeById, mergePresets } from '../src/storage';

const cut = (id: string, filename: string, type = 'output', base = '/comfy'): SceneImage => ({
  id,
  base,
  image: { filename, subfolder: 'scenario', type },
});

function storyboard(): Scenario {
  const scenario = newScenario(defaultSettings);
  const first = { ...newScene(), candidates: [cut('a', 'a.png'), cut('b', 'b.png')] };
  first.featuredId = 'a';
  const second = {
    ...newScene(),
    mode: 'edit' as const,
    reference: { ...cut('a', 'a.png'), sceneId: first.id },
  };
  const third = { ...newScene(), mode: 'edit' as const, reference: cut('u', 'u.png', 'input') };
  return { ...scenario, scenes: [first, second, third] };
}

describe('scenario prompts', () => {
  it('marks a prompt stale only when its scene input changed', () => {
    const scenario = newScenario(defaultSettings);
    const scene = { ...newScene(), description: '골목', prompt: 'An alley' };
    scene.promptContext = promptContextKey(scenario, scene);
    expect(promptStale(scenario, scene)).toBe(false);
    expect(promptStale(scenario, { ...scene, description: '카페' })).toBe(true);
    expect(promptStale({ ...scenario, style: '필름' }, scene)).toBe(true);
    expect(promptStale(scenario, { ...scene, prompt: '', description: '카페' })).toBe(false);
  });

  it('ignores the base model in the revision of an edit scene', () => {
    const scenario = newScenario(defaultSettings);
    const scene = { ...newScene(), mode: 'edit' as const };
    const other = { ...scenario, settings: { ...scenario.settings, model: 'other.safetensors' } };
    expect(sceneRevision(other, scene)).toBe(sceneRevision(scenario, scene));
    const resized = { ...scenario, settings: { ...scenario.settings, width: 640 } };
    expect(sceneRevision(resized, scene)).not.toBe(sceneRevision(scenario, scene));
  });
});

describe('scenario character LoRAs', () => {
  const info = {
    LoraLoaderModelOnly: {
      input: { required: { lora_name: [['Flux1.D/soft.safetensors', 'Krea2/hard.safetensors']] } },
    },
  } as unknown as ObjectInfo;

  it('refuses a LoRA from another model family', () => {
    const scenario = newScenario({ ...defaultSettings, architecture: 'krea2' });
    const character = {
      id: 'c',
      name: '지수',
      lora: 'Flux1.D/soft.safetensors',
      description: '',
      trigger: 'jisu',
      strength: 0.8,
    };
    const scene = { ...newScene(), prompt: 'A street', characters: ['c'] };
    const story = { ...scenario, characters: [character] };
    expect(() => sceneGeneration(story, scene, undefined, info, {}, '/comfy')).toThrow(
      '지수의 LoRA가 기본 모델 계열과 맞지 않아요',
    );
    const matching = { ...story, characters: [{ ...character, lora: 'Krea2/hard.safetensors' }] };
    const generation = sceneGeneration(matching, scene, undefined, info, {}, '/comfy');
    expect(generation.loras.map((lora) => lora.name)).toEqual(['Krea2/hard.safetensors']);
    expect(generation.positive).toBe('jisu, A street');
  });
});

describe('deleted scenario outputs', () => {
  it('drops deleted candidates, featured cuts and pinned references', () => {
    const scenarios = [storyboard()];
    const next = pruneDeletedOutputs(scenarios, '/comfy', new Set(['scenario/a.png']));
    const [first, second, third] = next[0].scenes;
    expect(first.candidates.map(({ id }) => id)).toEqual(['b']);
    expect(first.featuredId).toBeNull();
    expect(second.reference).toBeNull();
    // Uploaded references live in the input folder and stay.
    expect(third).toBe(scenarios[0].scenes[2]);
  });

  it('keeps the same objects when nothing was deleted from this server', () => {
    const scenarios = [storyboard()];
    expect(pruneDeletedOutputs(scenarios, '/comfy', new Set(['scenario/zzz.png']))).toBe(scenarios);
    expect(pruneDeletedOutputs(scenarios, 'http://other:8188', new Set(['scenario/a.png']))).toBe(
      scenarios,
    );
  });
});

describe('shared scenario merge', () => {
  it('merges edits to different scenarios and keeps overlapping edits as conflicts', () => {
    const a = { id: 'a', title: 'A' };
    const b = { id: 'b', title: 'B' };
    expect(mergeById([a, b], [{ ...a, title: 'A2' }, b], [a, { ...b, title: 'B2' }])).toEqual([
      { ...a, title: 'A2' },
      { ...b, title: 'B2' },
    ]);
    expect(mergeById([a], [{ ...a, title: 'local' }], [{ ...a, title: 'server' }])).toBeNull();
    expect(mergeById([a, b], [a], [a, b, { id: 'c' }])).toEqual([a, { id: 'c' }]);
  });

  it('keeps the preset limit', () => {
    const many = Array.from({ length: 101 }, (_, i) => ({ id: String(i) }));
    expect(mergePresets([], many, [])).toBeNull();
    expect(mergeById([], many, [])).toHaveLength(101);
  });
});
