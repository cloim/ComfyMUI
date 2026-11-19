import { request } from './api';
import {
  hasPromptAttribute,
  newId,
  reusableSettings,
  type Generation,
  type ImageRef,
  type Job,
} from './domain';
import { selectModel, type FamilyAssignments, type ModelEntry } from './models';
import type { ObjectInfo } from './domain';

export type SceneImage = { id: string; base: string; image: ImageRef };
export type Scene = {
  id: string;
  title: string;
  description: string;
  prompt: string;
  promptContext: string;
  mode: 'create' | 'edit';
  characters: string[];
  reference: (SceneImage & { sceneId?: string }) | null;
  count: number;
  candidates: SceneImage[];
  featuredId: string | null;
  renderedRevision: string;
};
export type Scenario = {
  id: string;
  title: string;
  settings: Generation;
  style: string;
  editModelId: string;
  characters: {
    id: string;
    name: string;
    lora: string;
    description: string;
    trigger: string;
    strength: number;
  }[];
  scenes: Scene[];
};

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

export function scenarioPromptInput(scenario: Scenario, scene: Scene) {
  return {
    description: scene.description.trim(),
    mode: scene.mode,
    style: scenario.style.trim(),
    model: scene.mode === 'edit' ? 'Qwen2.1' : scenario.settings.architecture,
    characters: sceneCharacters(scenario, scene).map(({ name, description }) => ({
      name: name.trim(),
      description: description.trim(),
    })),
  };
}

export function sceneRevision(scenario: Scenario, scene: Scene) {
  return JSON.stringify([
    scenarioPromptInput(scenario, scene),
    scene.prompt.trim(),
    scenario.settings,
    scene.mode === 'edit' ? scenario.editModelId : sceneCharacters(scenario, scene),
    scene.mode === 'edit' ? scene.reference?.id : null,
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
    if (!editModel) throw new Error('공통 설정에서 설치된 Qwen2.1 편집 모델을 선택해 주세요');
    if (!scene.reference) throw new Error('참조 이미지로 사용할 컷을 선택하거나 업로드해 주세요');
    if (scene.reference.base !== base)
      throw new Error('현재 연결된 ComfyUI 서버에서 참조 이미지를 다시 선택해 주세요');
    const prompt = settings.positive.includes('<image1>')
      ? settings.positive
      : `Edit <image1>. ${settings.positive}`;
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
    };
  }
  const loras = new Map(settings.loras.map((lora) => [lora.name, lora]));
  const characters = sceneCharacters(scenario, scene);
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
  const missingTriggers = [...triggers].filter(
    (trigger) => trigger && !hasPromptAttribute(settings.positive, trigger),
  );
  return {
    ...settings,
    positive: [...missingTriggers, settings.positive].join(', '),
    loras: [...loras.values()],
  };
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
    return scenes.some((scene, i) => scene !== scenario.scenes[i])
      ? { ...scenario, scenes }
      : scenario;
  });
  return next.some((scenario, i) => scenario !== scenarios[i]) ? next : scenarios;
}

export async function uploadSceneReference(base: string, file: File): Promise<SceneImage> {
  if (
    !['image/jpeg', 'image/png', 'image/webp'].includes(file.type) ||
    file.size > 20 * 1024 * 1024
  ) {
    throw new Error('20MB 이하의 JPG, PNG 또는 WebP 이미지를 선택해 주세요');
  }
  const id = newId();
  const extension = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }[file.type];
  const body = new FormData();
  body.set('image', file, `${id}.${extension}`);
  body.set('subfolder', 'scenario');
  body.set('type', 'input');
  const uploaded = await request<{ name?: string; subfolder?: string; type?: string }>(
    base,
    '/upload/image',
    { method: 'POST', body },
  );
  if (!uploaded.name || uploaded.type !== 'input')
    throw new Error('업로드한 이미지를 확인해 주세요');
  return {
    id,
    base,
    image: { filename: uploaded.name, subfolder: uploaded.subfolder || '', type: uploaded.type },
  };
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
    throw new Error('AI 프롬프트를 사용하려면 서버의 텍스트 모델 연결을 설정해 주세요');
  }
  if (!response.ok)
    throw new Error(result?.error?.message || 'AI 연결을 확인하고 다시 시도해 주세요');
  if (typeof result?.prompt !== 'string' || !result.prompt.trim())
    throw new Error('AI가 프롬프트를 반환하지 않았어요. 다시 시도해 주세요');
  return result.prompt.trim() as string;
}
