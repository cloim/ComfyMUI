import { describe, expect, it } from 'vitest';
import { buildWorkflow, defaults as defaultSettings, type ObjectInfo } from '../src/domain';
import {
  characterJobId,
  characterReferences,
  charactersMissingImages,
  collectSceneResults,
  mentionsCharacter,
  normalizeScenarios,
  parseRatio,
  ratioPreset,
  ratioSize,
  newScenario,
  newScene,
  promptContextKey,
  promptStale,
  pruneDeletedOutputs,
  scenarioPromptInput,
  sceneGeneration,
  sceneRevision,
  uncastCharacters,
  type Character,
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

  it('adds a trigger word unless the prompt has it with the same case', () => {
    const scenario = newScenario({ ...defaultSettings, architecture: 'krea2' });
    const character = {
      id: 'c',
      name: 'omz',
      lora: 'Krea2/hard.safetensors',
      description: '',
      trigger: 'omz',
      strength: 0.8,
    };
    const story = { ...scenario, characters: [character] };
    const generate = (prompt: string) =>
      sceneGeneration(
        story,
        { ...newScene(), prompt, characters: ['c'] },
        undefined,
        info,
        {},
        '/comfy',
      ).positive;
    expect(generate('A photo of OMZ at a desk')).toBe('omz, A photo of OMZ at a desk');
    expect(generate('A photo of omz at a desk')).toBe('A photo of omz at a desk');
    expect(generate('omz, at a desk')).toBe('omz, at a desk');
    expect(generate('A photo of omzone')).toBe('omz, A photo of omzone');
  });
});

describe('scenario cast', () => {
  const character = (name: string, trigger = '') => ({
    id: name,
    name,
    lora: '',
    description: '',
    trigger,
    strength: 0.8,
  });

  it('finds characters by name or trigger word', () => {
    expect(mentionsCharacter('사무실에서 OMZ가 일한다', character('omz'))).toBe(true);
    expect(mentionsCharacter('omzone 간판', character('omz'))).toBe(false);
    expect(mentionsCharacter('지수가 우산을 접는다', character('지수'))).toBe(true);
    expect(mentionsCharacter('골목을 걷는다', character('지수', 'jisu_v1'))).toBe(false);
    expect(mentionsCharacter('jisu_v1 walks', character('지수', 'jisu_v1'))).toBe(true);
    // A one-letter Korean name would match almost any text.
    expect(mentionsCharacter('수요일 아침', character('수'))).toBe(false);
  });

  it('lists named characters missing from the cast', () => {
    const scenario = {
      ...newScenario(defaultSettings),
      characters: [character('omz'), character('지수')],
    };
    const scene = { ...newScene(), description: 'omz와 지수가 만난다', characters: ['지수'] };
    expect(uncastCharacters(scenario, scene).map((c) => c.id)).toEqual(['omz']);
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

describe('character reference images', () => {
  const editModel = {
    id: 'q',
    name: 'Qwen/qwen-image-2.1-edit.safetensors',
    loader: 'UNETLoader',
    family: 'qwen21' as const,
    format: 'safetensors',
  };
  const face = (id: string, base = '/comfy'): SceneImage => cut(id, `${id}.png`, 'input', base);
  const person = (id: string, name: string, extra: Partial<Character> = {}): Character => ({
    id,
    name,
    lora: '',
    description: '',
    trigger: '',
    strength: 0.8,
    ...extra,
  });
  function story(characters: Character[], extraRefs: string[] = []) {
    const scenario = { ...newScenario(defaultSettings), characters };
    const scene = {
      ...newScene(),
      mode: 'edit' as const,
      prompt: 'Make <image1> rainy',
      characters: characters.map((c) => c.id),
      reference: cut('r', 'r.png'),
      extraRefs,
    };
    return { scenario, scene };
  }

  it('sends each cast character face and full body, then chosen extras', () => {
    const { scenario, scene } = story(
      [
        person('a', 'omz', {
          face: face('fa'),
          body: face('ba'),
          extras: [face('x1'), face('x2')],
        }),
        person('b', '지수', { face: face('fb'), body: face('bb') }),
      ],
      ['x2'],
    );
    expect(
      characterReferences(scenario, scene).map((r) => [r.character.id, r.view, r.tag]),
    ).toEqual([
      ['a', 'face', '<image2>'],
      ['a', 'body', '<image3>'],
      ['a', 'extra', '<image4>'],
      ['b', 'face', '<image5>'],
      ['b', 'body', '<image6>'],
    ]);
    expect(scenarioPromptInput(scenario, scene).characters[1]).toEqual({
      name: '지수',
      description: '',
      references: [
        { tag: '<image5>', view: 'face' },
        { tag: '<image6>', view: 'full body' },
      ],
    });
    const generation = sceneGeneration(scenario, scene, editModel, null, {}, '/comfy');
    expect(generation.editReferences).toHaveLength(5);
    expect(generation.positive).toBe(
      'Make <image1> rainy omz looks like the person in <image2> (face), <image3> (full body), <image4> (extra). 지수 looks like the person in <image5> (face), <image6> (full body).',
    );
    const workflow = buildWorkflow({
      ...generation,
      clip1: 'Qwen/encoder.safetensors',
      vae: 'Qwen/vae.safetensors',
      random: false,
    });
    expect(workflow['60']).toMatchObject({ class_type: 'LoadImage' });
    expect(workflow['61']).toMatchObject({
      class_type: 'ImageScaleToTotalPixels',
      inputs: { image: ['60', 0] },
    });
    expect(workflow['2'].inputs['images.image_6']).toEqual(['69', 0]);
  });

  it('requires both front images in an edit scene only', () => {
    const { scenario, scene } = story([person('a', 'omz', { face: face('fa') })]);
    expect(charactersMissingImages(scenario, scene).map((c) => c.id)).toEqual(['a']);
    expect(() => sceneGeneration(scenario, scene, editModel, null, {}, '/comfy')).toThrow(
      'omz의 얼굴·전신 정면 이미지를 공통 설정에서 등록해 주세요',
    );
    expect(charactersMissingImages(scenario, { ...scene, mode: 'create' })).toEqual([]);
  });

  it('keeps the revision of scenes without character images', () => {
    const { scenario, scene } = story([person('a', 'omz')]);
    const plain = { ...scene, characters: [] };
    expect(JSON.parse(sceneRevision(scenario, plain))).toHaveLength(5);
    // The scene's own edit model counts; the default is used when it has none.
    expect(sceneRevision(scenario, { ...plain, editModelId: 'other' })).not.toBe(
      sceneRevision(scenario, plain),
    );
  });

  it('asks to upload again for an image on another server', () => {
    const { scenario, scene } = story([
      person('a', 'omz', { face: face('f', 'http://other:8188'), body: face('b') }),
    ]);
    expect(() => sceneGeneration(scenario, scene, editModel, null, {}, '/comfy')).toThrow(
      '현재 연결된 ComfyUI 서버에서 omz의 이미지를 다시 올려 주세요',
    );
  });

  it('moves an older single image to the face slot', () => {
    const older = {
      ...newScenario(defaultSettings),
      characters: [{ ...person('a', 'omz'), image: face('old') }],
    };
    const [migrated] = normalizeScenarios([older]);
    expect(migrated.characters[0].face).toEqual(face('old'));
    expect('image' in migrated.characters[0]).toBe(false);
    const list = [migrated];
    expect(normalizeScenarios(list)).toBe(list);
  });

  it('places a finished character image into its slot once', () => {
    const scenario = { ...newScenario(defaultSettings), characters: [person('a', 'omz')] };
    const job = {
      id: 'run-1',
      createdAt: 1,
      settings: defaultSettings,
      base: '/comfy',
      status: 'complete' as const,
      progress: 100,
      images: [{ filename: 'face.png', subfolder: 'scenario', type: 'output' }],
      scenario: { sceneId: characterJobId('a', 'face'), revision: '' },
    };
    const [filled] = collectSceneResults([scenario], [job]);
    expect(filled.characters[0].face?.image.filename).toBe('face.png');
    // Removing the image afterwards is not undone by the same finished run.
    const cleared = { ...filled, characters: [{ ...filled.characters[0], face: null }] };
    expect(collectSceneResults([cleared], [job])[0].characters[0].face).toBeNull();
  });
});

describe('frame ratios', () => {
  it('keeps a 1024px long side in 32px steps', () => {
    expect(ratioSize(16, 9)).toEqual({ width: 1024, height: 576 });
    expect(ratioSize(3, 4)).toEqual({ width: 768, height: 1024 });
    expect(ratioSize(21, 9)).toEqual({ width: 1024, height: 448 });
    expect(parseRatio('2.39:1')).toEqual({ w: 2.39, h: 1 });
    expect(parseRatio('16x9')).toEqual({ w: 16, h: 9 });
    expect(parseRatio('9:1')).toBeNull();
    expect(ratioPreset(1024, 576)?.ratio).toBe('16:9');
    expect(ratioPreset(1000, 576)).toBeUndefined();
  });
});
