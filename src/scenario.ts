import { uploadImage } from './api';
import {
  hasPromptAttribute,
  newId,
  reusableSettings,
  type Generation,
  type ImageRef,
  type Job,
} from './domain';
import {
  compatibleAssets,
  families,
  selectModel,
  type FamilyAssignments,
  type ModelEntry,
  type ModelFamily,
} from './models';
import { outputKey } from './outputs';
import type { ObjectInfo } from './domain';

export type SceneImage = { id: string; base: string; image: ImageRef };
export type Scene = {
  id: string;
  title: string;
  description: string;
  prompt: string;
  promptContext: string;
  // Who wrote the prompt. A missing value (older data) counts as a manual prompt.
  promptSource?: 'ai' | 'manual';
  mode: 'create' | 'edit';
  characters: string[];
  reference: (SceneImage & { sceneId?: string }) | null;
  // Edit scenes: a model other than the scenario's default, and the extra character
  // images chosen as references besides each character's face and full body.
  editModelId?: string;
  extraRefs?: string[];
  count: number;
  candidates: SceneImage[];
  featuredId: string | null;
  renderedRevision: string;
};
export type CharacterSlot = 'face' | 'body';
export type Character = {
  id: string;
  name: string;
  lora: string;
  description: string;
  trigger: string;
  strength: number;
  // Front-facing face and full-body images. Edit scenes need both; extras are optional.
  // Uploaded to ComfyUI's input folder or generated into its output folder.
  face?: SceneImage | null;
  body?: SceneImage | null;
  extras?: SceneImage[];
  // Generation runs already placed into a slot, so a finished run is applied only once.
  appliedRuns?: string[];
  // Older data kept one image; normalizeScenarios moves it to the face.
  image?: SceneImage | null;
};
export type Scenario = {
  id: string;
  title: string;
  settings: Generation;
  // Style text sent to the AI prompt writer, and the preset it came from ('custom' when
  // written or edited by hand).
  style: string;
  styleId?: string;
  editModelId: string;
  characters: Character[];
  scenes: Scene[];
};

// Moves older single character images to the face slot. Returns the same array when
// nothing changed, so stored data is rewritten only when needed.
export function normalizeScenarios(list: Scenario[]): Scenario[] {
  if (!Array.isArray(list)) return [];
  let changed = false;
  const next = list.map((scenario) => {
    if (!scenario.characters?.some((c) => 'image' in c)) return scenario;
    changed = true;
    return {
      ...scenario,
      characters: scenario.characters.map(({ image, ...c }) => ({
        ...c,
        face: c.face ?? image ?? null,
      })),
    };
  });
  return changed ? next : list;
}

// Frame sizes keep a 1024px long side and 32px steps, which suits every model family.
export const RATIO_PRESETS = [
  { ratio: '1:1', label: '정사각 1:1' },
  { ratio: '3:4', label: '세로 3:4' },
  { ratio: '2:3', label: '세로 2:3' },
  { ratio: '9:16', label: '세로 9:16' },
  { ratio: '4:3', label: '가로 4:3' },
  { ratio: '3:2', label: '가로 3:2' },
  { ratio: '16:9', label: '와이드 16:9' },
  { ratio: '21:9', label: '시네마 21:9' },
];

// Reads "16:9", "16/9", "16x9" or "2.39:1". Ratios beyond 4:1 are refused.
export function parseRatio(text: string) {
  const match = /^\s*(\d+(?:\.\d+)?)\s*[:/x×]\s*(\d+(?:\.\d+)?)\s*$/i.exec(text);
  if (!match) return null;
  const [w, h] = [Number(match[1]), Number(match[2])];
  if (!(w > 0 && h > 0) || Math.max(w, h) / Math.min(w, h) > 4) return null;
  return { w, h };
}

export function ratioSize(w: number, h: number) {
  const short = Math.max(256, Math.round((1024 * Math.min(w, h)) / Math.max(w, h) / 32) * 32);
  return w >= h ? { width: 1024, height: short } : { width: short, height: 1024 };
}

// The preset that produces this frame size, if any.
export function ratioPreset(width: number, height: number) {
  return RATIO_PRESETS.find(({ ratio }) => {
    const size = ratioSize(...(ratio.split(':').map(Number) as [number, number]));
    return size.width === width && size.height === height;
  });
}

// Written in Korean like the rest of the scenario; the AI prompt writer translates it.
export const STYLE_PRESETS = [
  {
    id: 'photo',
    label: '사실적인 사진',
    text: '사실적인 고해상도 사진, 자연스러운 피부 질감, 부드러운 자연광',
  },
  {
    id: 'film',
    label: '필름 사진',
    text: '35mm 필름 사진, 은은한 필름 그레인, 빛바랜 색감과 낮은 채도',
  },
  {
    id: 'cinematic',
    label: '시네마틱',
    text: '영화 스틸컷, 시네마틱 조명, 얕은 피사계 심도, 넓은 화면 구도',
  },
  { id: 'anime', label: '애니메이션', text: '일본 TV 애니메이션 셀화, 선명한 선화, 평면적인 채색' },
  { id: 'webtoon', label: '웹툰', text: '한국 웹툰 스타일, 깔끔한 선화, 밝고 부드러운 채색' },
  { id: 'watercolor', label: '수채화', text: '수채화 일러스트, 번지는 물감 질감, 파스텔 색감' },
  {
    id: '3d',
    label: '3D 애니메이션',
    text: '3D 애니메이션 영화 렌더, 부드러운 전역 조명, 과장된 표정',
  },
  { id: 'noir', label: '흑백 누아르', text: '흑백 누아르, 강한 명암 대비, 짙은 그림자' },
];

// Shots for the character reference images, described like a scene.
export const CHARACTER_SHOTS: Record<
  CharacterSlot,
  { label: string; description: string; width: number; height: number; fallback: string }
> = {
  face: {
    label: '얼굴 정면',
    description:
      '정면을 똑바로 바라보는 얼굴 클로즈업, 어깨 위까지, 무표정, 밝은 회색 단색 배경, 고른 스튜디오 조명',
    width: 1024,
    height: 1024,
    fallback:
      'close-up front view portrait, looking straight at the camera, head and shoulders, neutral expression, plain light grey background, even studio lighting',
  },
  body: {
    label: '전신 정면',
    description:
      '머리부터 발끝까지 보이는 전신, 정면으로 똑바로 선 자세, 팔은 자연스럽게 내림, 밝은 회색 단색 배경, 고른 스튜디오 조명',
    width: 768,
    height: 1024,
    fallback:
      'full body front view from head to toe, standing straight facing the camera, arms relaxed at the sides, plain light grey background, even studio lighting',
  },
};

// Jobs that make a character image carry this id in place of a scene id.
export const characterJobId = (characterId: string, slot: CharacterSlot) =>
  `character:${characterId}:${slot}`;

export function newScene(): Scene {
  return {
    id: newId(),
    title: '',
    description: '',
    prompt: '',
    promptContext: '',
    mode: 'create',
    characters: [],
    reference: null,
    count: 1,
    candidates: [],
    featuredId: null,
    renderedRevision: '',
  };
}

export function newScenario(settings: Generation): Scenario {
  return {
    id: newId(),
    title: '새 시나리오',
    settings: { ...reusableSettings(settings), positive: '', workflow: null, batch: 1, loras: [] },
    style: '',
    editModelId: '',
    characters: [],
    scenes: [],
  };
}

// Whether `word` appears in `text`. Latin words must stand alone (`omz` is not found in
// `omzone`); other scripts match inside a word, since Korean attaches particles (`지수가`).
function containsWord(text: string, word: string, ignoreCase: boolean) {
  if (!/^[\x00-\x7F]+$/.test(word)) return text.includes(word);
  const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^A-Za-z0-9_])${escaped}($|[^A-Za-z0-9_])`, ignoreCase ? 'i' : '').test(
    text,
  );
}

// A character is mentioned when the text names it or uses one of its trigger words.
export function mentionsCharacter(
  text: string,
  character: Pick<Scenario['characters'][number], 'name' | 'trigger'>,
) {
  return [character.name, ...character.trigger.split(',')]
    .map((word) => word.trim())
    .filter((word) => word.length >= (/^[\x00-\x7F]+$/.test(word) ? 1 : 2))
    .some((word) => containsWord(text, word, true));
}

// Characters named in a description but not cast in the scene. Only cast characters get
// their LoRA, trigger words and description.
export function uncastCharacters(scenario: Scenario, scene: Scene) {
  return scenario.characters.filter(
    (c) => !scene.characters.includes(c.id) && mentionsCharacter(scene.description, c),
  );
}

export function sceneCharacters(scenario: Scenario, scene: Scene) {
  return scenario.characters.filter((character) => scene.characters.includes(character.id));
}

export function featuredImage(scene: Scene) {
  return scene.candidates.find((candidate) => candidate.id === scene.featuredId);
}

export function sceneTitle(scene: Scene) {
  return (
    scene.title.trim() || scene.description.trim().split('\n')[0].slice(0, 80) || '이름 없는 씬'
  );
}

export const REFERENCE_VIEWS = { face: 'face', body: 'full body', extra: 'extra' } as const;
export type ReferenceView = keyof typeof REFERENCE_VIEWS;
// Qwen2.1 takes 16 reference images; <image1> is the scene's own reference.
export const MAX_CHARACTER_REFERENCES = 15;

// Character images an edit scene sends, numbered as the edit model sees them (<image2>,
// ...): each cast character's face and full body, then the extras chosen in the scene.
export function characterReferences(scenario: Scenario, scene: Scene) {
  if (scene.mode !== 'edit') return [];
  const chosen = new Set(scene.extraRefs || []);
  return sceneCharacters(scenario, scene)
    .flatMap((character) => [
      ...(character.face ? [{ character, image: character.face, view: 'face' as const }] : []),
      ...(character.body ? [{ character, image: character.body, view: 'body' as const }] : []),
      ...(character.extras || [])
        .filter((image) => chosen.has(image.id))
        .map((image) => ({ character, image, view: 'extra' as const })),
    ])
    .slice(0, MAX_CHARACTER_REFERENCES)
    .map((reference, i) => ({ ...reference, tag: `<image${i + 2}>` }));
}

// Cast characters an edit scene cannot use yet: both front images are required.
export function charactersMissingImages(scenario: Scenario, scene: Scene) {
  if (scene.mode !== 'edit') return [];
  return sceneCharacters(scenario, scene).filter((c) => !c.face || !c.body);
}

export function scenarioPromptInput(scenario: Scenario, scene: Scene) {
  const references = characterReferences(scenario, scene);
  return {
    description: scene.description.trim(),
    mode: scene.mode,
    style: scenario.style.trim(),
    model: scene.mode === 'edit' ? 'Qwen2.1' : scenario.settings.architecture,
    characters: sceneCharacters(scenario, scene).map(({ id, name, description }) => {
      const own = references.filter(({ character }) => character.id === id);
      return {
        name: name.trim(),
        description: description.trim(),
        ...(own.length && {
          references: own.map(({ tag, view }) => ({ tag, view: REFERENCE_VIEWS[view] })),
        }),
      };
    }),
  };
}

export function promptContextKey(scenario: Scenario, scene: Scene) {
  return JSON.stringify(scenarioPromptInput(scenario, scene));
}

// The prompt was written for a different description or common setting.
export function promptStale(scenario: Scenario, scene: Scene) {
  return Boolean(scene.prompt.trim() && scene.promptContext !== promptContextKey(scenario, scene));
}

export function sceneRevision(scenario: Scenario, scene: Scene) {
  // An edit scene uses only the frame size of the common settings.
  const { width, height } = scenario.settings;
  // Added only when present, so scenes without character images keep their revision.
  const references = characterReferences(scenario, scene).map(({ image }) => image.id);
  return JSON.stringify([
    scenarioPromptInput(scenario, scene),
    scene.prompt.trim(),
    scene.mode === 'edit' ? { width, height } : scenario.settings,
    scene.mode === 'edit'
      ? scene.editModelId || scenario.editModelId
      : sceneCharacters(scenario, scene),
    scene.mode === 'edit' ? scene.reference?.id : null,
    ...(references.length ? [references] : []),
  ]);
}

export function sceneGeneration(
  scenario: Scenario,
  scene: Scene,
  editModel: ModelEntry | undefined,
  info: ObjectInfo | null,
  assignments: FamilyAssignments,
  base: string,
) {
  const settings = {
    ...scenario.settings,
    positive: scene.prompt.trim(),
    batch: scene.count,
    random: true,
  };
  if (scene.mode === 'edit') {
    if (!editModel) throw new Error('이어 만들기에 사용할 Qwen2.1 편집 모델을 선택해 주세요');
    if (!scene.reference) throw new Error('참조 이미지로 사용할 컷을 선택하거나 업로드해 주세요');
    if (scene.reference.base !== base)
      throw new Error('현재 연결된 ComfyUI 서버에서 참조 이미지를 다시 선택해 주세요');
    const missing = charactersMissingImages(scenario, scene);
    if (missing.length)
      throw new Error(
        `${missing.map((c) => c.name.trim() || '이름 없는 캐릭터').join(', ')}의 얼굴·전신 정면 이미지를 공통 설정에서 등록해 주세요`,
      );
    const references = characterReferences(scenario, scene);
    const elsewhere = references.find(({ image }) => image.base !== base);
    if (elsewhere)
      throw new Error(
        `현재 연결된 ComfyUI 서버에서 ${elsewhere.character.name.trim() || '캐릭터'}의 이미지를 다시 올려 주세요`,
      );
    let prompt = settings.positive.includes('<image1>')
      ? settings.positive
      : `Edit <image1>. ${settings.positive}`;
    // A prompt written by hand may not name the character references.
    for (const character of sceneCharacters(scenario, scene)) {
      const own = references.filter((r) => r.character.id === character.id);
      if (!own.length || own.some(({ tag }) => prompt.includes(tag))) continue;
      const views = own.map(({ tag, view }) => `${tag} (${REFERENCE_VIEWS[view]})`).join(', ');
      prompt += ` ${character.name.trim() || 'The character'} looks like the person in ${views}.`;
    }
    return {
      ...selectModel({ ...settings, loras: [] }, editModel, info, assignments),
      positive: prompt,
      width: Math.round(settings.width / 32) * 32,
      height: Math.round(settings.height / 32) * 32,
      steps: /turbo/i.test(editModel.name) ? 8 : 25,
      cfg: 1,
      sampler: 'euler',
      scheduler: 'simple',
      denoise: 1,
      editSource: scene.reference.image,
      editReferences: references.map(({ image }) => image.image),
    };
  }
  const loras = new Map(settings.loras.map((lora) => [lora.name, lora]));
  const characters = sceneCharacters(scenario, scene);
  if (info) {
    const compatible = compatibleAssets(info, 'lora', settings.architecture, assignments);
    const mismatch = characters.find((c) => c.lora && !compatible.includes(c.lora));
    if (mismatch)
      throw new Error(
        `${mismatch.name.trim() || '캐릭터'}의 LoRA가 기본 모델 계열과 맞지 않아요. 공통 설정에서 LoRA를 다시 선택해 주세요`,
      );
  }
  for (const character of characters) {
    if (character.lora && !loras.has(character.lora)) {
      loras.set(character.lora, {
        name: character.lora,
        model: character.strength,
        clip: settings.architecture === 'flux' ? character.strength : 0,
      });
    }
  }
  const triggers = new Set(
    characters
      .filter((c) => c.lora)
      .flatMap((c) => c.trigger.split(',').map((word) => word.trim())),
  );
  // Trigger words are matched with their exact case: a LoRA trained on `omz` is not
  // triggered by the `OMZ` an AI prompt may write.
  const missingTriggers = [...triggers].filter(
    (trigger) =>
      trigger &&
      !hasPromptAttribute(settings.positive, trigger, true) &&
      !containsWord(settings.positive, trigger, false),
  );
  return {
    ...settings,
    positive: [...missingTriggers, settings.positive].join(', '),
    loras: [...loras.values()],
  };
}

// The model family a LoRA belongs to, from its folder or a manual assignment.
export function loraFamily(
  info: ObjectInfo | null,
  name: string,
  assignments: FamilyAssignments,
): ModelFamily | null {
  return (
    families.find((family) => compatibleAssets(info, 'lora', family.id, assignments).includes(name))
      ?.id ?? null
  );
}

// Settings that render one front image of a character with the base model and its LoRA.
export function characterShotGeneration(
  scenario: Scenario,
  character: Character,
  slot: CharacterSlot,
  prompt: string,
  info: ObjectInfo | null,
  assignments: FamilyAssignments,
  base: string,
) {
  const shot = CHARACTER_SHOTS[slot];
  const scene = {
    ...newScene(),
    id: characterJobId(character.id, slot),
    description: shot.description,
    characters: [character.id],
    prompt,
  };
  return sceneGeneration(
    {
      ...scenario,
      characters: [character],
      settings: { ...scenario.settings, width: shot.width, height: shot.height },
    },
    scene,
    undefined,
    info,
    assignments,
    base,
  );
}

// Prompt input for a character's front image, written by the AI like a scene prompt.
export function characterShotPromptInput(
  scenario: Scenario,
  character: Character,
  slot: CharacterSlot,
) {
  return scenarioPromptInput(
    { ...scenario, characters: [character] },
    {
      ...newScene(),
      description: CHARACTER_SHOTS[slot].description,
      characters: [character.id],
    },
  );
}

export function collectSceneResults(scenarios: Scenario[], jobs: readonly Job[]) {
  const results = new Map<string, Job[]>();
  // Jobs are newest first. Append the oldest uncollected run first.
  for (const job of [...jobs].reverse()) {
    if (!job.scenario || job.status !== 'complete' || !job.images.length) continue;
    const runs = results.get(job.scenario.sceneId) || [];
    runs.push(job);
    results.set(job.scenario.sceneId, runs);
  }
  if (!results.size) return scenarios;
  const next = scenarios.map((scenario) => {
    const scenes = scenario.scenes.map((scene) => {
      const candidates = [];
      const existing = new Set(scene.candidates.map((candidate) => candidate.id));
      let renderedRevision = scene.renderedRevision;
      for (const job of results.get(scene.id) || []) {
        const run = job.requestToken || job.id;
        const images = job.images
          .map((image, index) => ({ id: `${run}:${index}`, base: job.base, image }))
          .filter((image) => !existing.has(image.id));
        if (!images.length) continue;
        candidates.push(...images);
        renderedRevision = job.scenario!.revision;
      }
      return candidates.length
        ? { ...scene, candidates: [...scene.candidates, ...candidates], renderedRevision }
        : scene;
    });
    // A finished character image fills its slot once; a later upload or removal stays.
    const characters = scenario.characters.map((character) => {
      let next = character;
      for (const slot of ['face', 'body'] as const) {
        for (const job of results.get(characterJobId(character.id, slot)) || []) {
          const run = job.requestToken || job.id;
          if (next.appliedRuns?.includes(run)) continue;
          next = {
            ...next,
            [slot]: { id: `${run}:0`, base: job.base, image: job.images[0] },
            appliedRuns: [...(next.appliedRuns || []), run].slice(-20),
          };
        }
      }
      return next;
    });
    return scenes.some((scene, i) => scene !== scenario.scenes[i]) ||
      characters.some((character, i) => character !== scenario.characters[i])
      ? { ...scenario, scenes, characters }
      : scenario;
  });
  return next.some((scenario, i) => scenario !== scenarios[i]) ? next : scenarios;
}

// Drops candidates, featured cuts and pinned references whose output files were deleted.
export function pruneDeletedOutputs(
  scenarios: Scenario[],
  base: string,
  removed: ReadonlySet<string>,
) {
  if (!removed.size) return scenarios;
  const gone = (item: SceneImage | null) =>
    Boolean(
      item &&
      item.base === base &&
      item.image.type === 'output' &&
      removed.has(outputKey(item.image)),
    );
  const next = scenarios.map((scenario) => {
    const scenes = scenario.scenes.map((scene) => {
      const candidates = scene.candidates.filter((candidate) => !gone(candidate));
      const reference = gone(scene.reference) ? null : scene.reference;
      if (candidates.length === scene.candidates.length && reference === scene.reference)
        return scene;
      const featuredId = candidates.some(({ id }) => id === scene.featuredId)
        ? scene.featuredId
        : null;
      return { ...scene, candidates, featuredId, reference };
    });
    const characters = scenario.characters.map((character) => {
      const extras = (character.extras || []).filter((image) => !gone(image));
      if (
        !gone(character.face ?? null) &&
        !gone(character.body ?? null) &&
        extras.length === (character.extras || []).length
      )
        return character;
      return {
        ...character,
        face: gone(character.face ?? null) ? null : character.face,
        body: gone(character.body ?? null) ? null : character.body,
        extras,
      };
    });
    return scenes.some((scene, i) => scene !== scenario.scenes[i]) ||
      characters.some((character, i) => character !== scenario.characters[i])
      ? { ...scenario, scenes, characters }
      : scenario;
  });
  return next.some((scenario, i) => scenario !== scenarios[i]) ? next : scenarios;
}

export async function uploadSceneReference(base: string, file: File): Promise<SceneImage> {
  const id = newId();
  return { id, base, image: await uploadImage(base, file, 'scenario', id) };
}

export async function convertScenarioPrompt(input: ReturnType<typeof scenarioPromptInput>) {
  let response;
  try {
    response = await fetch('/api/scenario/prompt', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
      signal: AbortSignal.timeout(65000),
    });
  } catch {
    throw new Error('AI 연결을 확인하고 다시 시도해 주세요');
  }
  const result = await response.json().catch(() => null);
  if (response.status === 404 || response.status === 503) {
    throw new Error(
      result?.error?.message ||
        'AI 프롬프트를 사용하려면 설정 > AI 연결에서 텍스트 모델을 설정해 주세요',
    );
  }
  if (!response.ok)
    throw new Error(result?.error?.message || 'AI 연결을 확인하고 다시 시도해 주세요');
  if (typeof result?.prompt !== 'string' || !result.prompt.trim())
    throw new Error('AI가 프롬프트를 반환하지 않았어요. 다시 시도해 주세요');
  return result.prompt.trim() as string;
}
