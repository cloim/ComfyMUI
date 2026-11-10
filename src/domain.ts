import {
  comboOptions,
  encoderLoader,
  families,
  isArtifactProneSampler,
  type ModelFamily,
} from './models';
export type Workflow = Record<
  string,
  { class_type: string; inputs: Record<string, unknown>; _meta?: { title?: string } }
>;
export type InputSpec = [string | string[], Record<string, unknown>?];
export type ObjectInfo = Record<
  string,
  {
    input: { required?: Record<string, InputSpec>; optional?: Record<string, InputSpec> };
    output?: string[];
    output_node?: boolean;
  }
>;
export type Lora = { name: string; model: number; clip: number };
export type Generation = {
  architecture: ModelFamily;
  modelLoader: string;
  clip1: string;
  clip2: string;
  vae: string;
  guidance: number;
  model: string;
  positive: string;
  negative: string;
  loras: Lora[];
  width: number;
  height: number;
  batch: number;
  seed: number;
  random: boolean;
  steps: number;
  cfg: number;
  sampler: string;
  scheduler: string;
  denoise: number;
  workflow: Workflow | null;
  upscale?: UpscaleSpec | null;
};
// Upscales an existing output image with an upscale model, then optionally re-samples it
// at low denoise with the original model and prompt to restore fine detail.
export type UpscaleSpec = {
  source: ImageRef;
  model: string;
  sourceWidth: number;
  sourceHeight: number;
  refine: number;
};
export const UPSCALE_SCALES = [1.5, 2, 3, 4];
export const UPSCALE_REFINES = [
  { value: 0, label: '끄기', hint: '확대만 해서 가장 빠르고 원본과 똑같아요' },
  { value: 0.2, label: '약하게', hint: '원본을 거의 유지하며 질감만 살짝 다듬어요' },
  { value: 0.35, label: '보통', hint: '피부와 머리카락 같은 미세 디테일을 새로 그려요' },
  { value: 0.5, label: '강하게', hint: '디테일이 많이 늘지만 원본과 조금 달라질 수 있어요' },
];
export function upscaleSize(width: number, height: number, scale: number) {
  const fit = (v: number) => Math.min(4096, Math.max(64, Math.round((v * scale) / 32) * 32));
  return { width: fit(width), height: fit(height) };
}
export function upscaleSettings(
  base: Generation,
  source: ImageRef,
  model: string,
  scale: number,
  refine: number,
): Generation {
  const plain = baseSettings(base);
  return {
    ...plain,
    ...upscaleSize(plain.width, plain.height, scale),
    batch: 1,
    random: false,
    workflow: null,
    upscale: {
      source: { filename: source.filename, subfolder: source.subfolder, type: source.type },
      model,
      sourceWidth: plain.width,
      sourceHeight: plain.height,
      refine,
    },
  };
}
// Settings of a regular generation: an upscale job reverts to its source size.
export function baseSettings(s: Generation): Generation {
  if (!s.upscale) return { ...s, upscale: null };
  return { ...s, width: s.upscale.sourceWidth, height: s.upscale.sourceHeight, upscale: null };
}
// LoadImage resolves "path [output]" from ComfyUI's output folder without uploading.
export function annotatedImage(ref: ImageRef) {
  const path = ref.subfolder ? `${ref.subfolder}/${ref.filename}` : ref.filename;
  return `${path} [${ref.type || 'output'}]`;
}
export type QueueItem = {
  id: string;
  createdAt: number;
  settings: Generation;
};

export function reorderQueue<T>(list: T[], from: number, to: number): T[] {
  if (from < 0 || from >= list.length || to < 0 || to >= list.length || from === to) {
    return list;
  }
  const copy = [...list];
  const [item] = copy.splice(from, 1);
  copy.splice(to, 0, item);
  return copy;
}
export type Preset = {
  id: string;
  name: string;
  description: string;
  color: string;
  updatedAt: number;
  settings: Generation;
};
// v is a content version (file modified time or completion time). ComfyUI reuses file
// names after deletions, so URLs carry it to keep caches from showing an older image.
export type ImageRef = { filename: string; subfolder: string; type: string; v?: number };
export type Job = {
  id: string;
  createdAt: number;
  settings: Generation;
  base: string;
  preview: boolean;
  status: 'submitting' | 'queued' | 'running' | 'complete' | 'error' | 'cancelled';
  progress: number;
  images: ImageRef[];
  livePreview?: string;
  error?: string;
  favorite?: boolean;
  startedAt?: number;
  completedAt?: number;
};

export function trimJobsPreservingFavorites(jobs: Job[], limit = 500): Job[] {
  if (jobs.length <= limit) return jobs;
  const favorites = jobs.filter((j) => j.favorite);
  const nonFavorites = jobs.filter((j) => !j.favorite);
  const allowedNonFavorites = Math.max(0, limit - favorites.length);
  const trimmedNonFavorites = nonFavorites.slice(0, allowedNonFavorites);
  const combined = [...favorites, ...trimmedNonFavorites];
  return combined.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
}
export const LEGACY_DEFAULT_POSITIVES = [
  'A quiet cabin nestled in a misty alpine forest, warm light glowing through the windows, towering mountains, cinematic composition, soft morning light, intricate details',
];

export function isLegacyDefaultPrompt(prompt?: string | null): boolean {
  if (!prompt) return false;
  const p = prompt.trim();
  return (
    LEGACY_DEFAULT_POSITIVES.includes(p) ||
    (p.includes('cabin') && (p.includes('alpine') || p.includes('forest') || p.includes('misty')))
  );
}

export function migrateGenerationSettings(settings: Generation): Generation {
  let next = settings;
  if (isLegacyDefaultPrompt(next.positive)) {
    next = { ...next, positive: defaults.positive };
  }
  if (isArtifactProneSampler(next.sampler)) {
    const prof = families.find((f) => f.id === next.architecture);
    next = {
      ...next,
      sampler: 'euler',
      scheduler: 'simple',
      steps: prof?.steps ?? (next.architecture === 'krea2' ? 8 : 24),
    };
  }
  return next;
}


export type PromptAssembleElement = {
  id: string;
  name: string;
  attributes: string[];
};

export const DEFAULT_PROMPT_ASSEMBLE: PromptAssembleElement[] = [
  {
    id: 'angle',
    name: '앵글',
    attributes: ['eye-level', 'low', 'high', 'bird-eye', "worm's-eye"],
  },
  {
    id: 'framing',
    name: '구성',
    attributes: [
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
    ],
  },
  {
    id: 'composition',
    name: '구도',
    attributes: ['dutch', 'over-the-shoulder', 'POV', 'center composition', 'frame-in-frame'],
  },
];

export function hasPromptAttribute(prompt: string, attribute: string): boolean {
  const target = attribute.trim().toLowerCase();
  if (!target) return false;
  return prompt
    .split(',')
    .map((part) => part.trim().toLowerCase())
    .some((part) => part === target);
}

export function togglePromptAttribute(prompt: string, attribute: string): string {
  const trimmedAttr = attribute.trim();
  if (!trimmedAttr) return prompt;
  const target = trimmedAttr.toLowerCase();
  const tokens = prompt
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
  const exists = tokens.some((part) => part.toLowerCase() === target);
  if (exists) {
    return tokens.filter((part) => part.toLowerCase() !== target).join(', ');
  }
  const base = prompt.trim().replace(/,+\s*$/, '');
  return base ? `${base}, ${trimmedAttr}` : trimmedAttr;
}

export function parseAttributeList(raw: string): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const part of raw.split(/[,/\n]/)) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      result.push(trimmed);
    }
  }
  return result;
}

export type DefaultPrompts = {
  positive: string;
  negative: string;
};

export const defaults: Generation = {
  modelLoader: 'CheckpointLoaderSimple',
  architecture: 'flux',
  clip1: '',
  clip2: '',
  vae: '',
  guidance: 3.5,
  model: '',
  positive:
    'A portrait of an elegant adult woman, natural soft lighting, delicate facial features, detailed skin texture, expressive eyes, gentle gaze, shallow depth of field, photorealistic, cinematic composition',
  negative: 'blurry, low quality, watermark, text',
  loras: [],
  width: 768,
  height: 1024,
  batch: 1,
  seed: 482190,
  random: true,
  steps: 24,
  cfg: 1,
  sampler: 'euler',
  scheduler: 'simple',
  denoise: 1,
  workflow: null,
};

export const DEFAULT_PROMPTS: DefaultPrompts = {
  positive: defaults.positive,
  negative: defaults.negative,
};
export const demoInfo: ObjectInfo = {
  CheckpointLoaderSimple: {
    input: {
      required: { ckpt_name: [['Flux1.D/미리보기 Flux1.d.safetensors']] },
    },
  },
  LoraLoader: {
    input: {
      required: {
        lora_name: [
          ['Flux1.D/미리보기 Soft light.safetensors', 'Krea2/미리보기 Film grain.safetensors'],
        ],
      },
    },
  },
  KSampler: {
    input: {
      required: {
        sampler_name: [['euler', 'euler_ancestral', 'dpmpp_2m']],
        scheduler: [['normal', 'karras', 'simple']],
      },
    },
  },
  UNETLoader: {
    input: {
      required: {
        unet_name: [
          [
            'Krea2/미리보기 krea2.safetensors',
            'moss_image_preview.safetensors',
            'qwen_image_2.1_preview.safetensors',
          ],
        ],
      },
    },
  },
  DualCLIPLoader: {
    input: {
      required: {
        clip_name1: [['Flux1.D/clip_l.safetensors', 'Flux1.D/t5xxl_fp8.safetensors']],
        clip_name2: [['Flux1.D/clip_l.safetensors', 'Flux1.D/t5xxl_fp8.safetensors']],
      },
    },
  },
  CLIPLoader: {
    input: {
      required: {
        clip_name: [['qwen3vl_4b.safetensors', 'qwen3.5_9b.safetensors', 'qwen3vl_8b.safetensors']],
      },
    },
  },
  VAELoader: {
    input: {
      required: {
        vae_name: [
          [
            'Flux1.D/ae.safetensors',
            'qwen_image_vae.safetensors',
            'flux2-vae_small.safetensors',
            'qwen_image_2.1_vae.safetensors',
          ],
        ],
      },
    },
  },
};
export function options(info: ObjectInfo | null, node: string, field: string): string[] {
  return comboOptions(info, node, field);
}
export function newId() {
  return (
    globalThis.crypto?.randomUUID?.() ||
    'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = Math.floor(Math.random() * 16);
      return (c === 'x' ? r : (r & 3) | 8).toString(16);
    })
  );
}
export function randomSeed() {
  return Math.floor(Math.random() * 2 ** 48);
}
export function validateGeneration(s: Generation) {
  for (const [key, min, max, integer] of [
    ['width', 64, 4096, true],
    ['height', 64, 4096, true],
    ['batch', 1, 8, true],
    ['steps', 1, 150, true],
    ['cfg', 0, 30, false],
    ['denoise', 0, 1, false],
    ['seed', 0, Number.MAX_SAFE_INTEGER, true],
  ] as const) {
    const value = s[key];
    if (
      !Number.isFinite(value) ||
      value < min ||
      value > max ||
      (integer && !Number.isInteger(value))
    )
      throw new Error(`${key}: ${min}~${max} 범위의 ${integer ? '정수' : '값'}를 입력해 주세요`);
  }
  if (s.width % 8 || s.height % 8) throw new Error('해상도는 8의 배수로 입력해 주세요');
  const multiple = ['moss', 'qwen21'].includes(s.architecture) ? 32 : 16;
  if (!s.workflow && (s.width % multiple || s.height % multiple))
    throw new Error(`이 계열의 해상도는 ${multiple}의 배수로 입력해 주세요`);
  if (!s.workflow && (!s.model || !s.positive.trim()))
    throw new Error('모델과 프롬프트를 입력해 주세요');
  if (
    !families.some((f) => f.id === s.architecture) ||
    !Number.isFinite(s.guidance) ||
    s.guidance < 0 ||
    s.guidance > 100
  )
    throw new Error('모델 구성과 guidance를 확인해 주세요');
  if (!s.workflow && s.architecture === 'flux' && (!s.clip1 || !s.clip2 || !s.vae))
    throw new Error('Flux의 CLIP 두 개와 VAE를 선택해 주세요');
  if (!s.workflow && (!s.clip1 || !s.vae))
    throw new Error('선택한 계열의 텍스트 인코더와 VAE를 확인해 주세요');
  for (const l of s.loras)
    if (!l.name || ![l.model, l.clip].every((v) => Number.isFinite(v) && v >= -2 && v <= 2))
      throw new Error('LoRA 강도는 -2~2 사이로 입력해 주세요');
}
export function parseWorkflow(value: unknown): Workflow {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('ComfyUI의 API 형식 JSON을 가져와 주세요');
  const entries = Object.entries(value);
  if (!entries.length || entries.length > 500)
    throw new Error('워크플로에는 1~500개 노드가 필요합니다');
  for (const [id, node] of entries) {
    if (
      !node ||
      typeof node !== 'object' ||
      typeof node.class_type !== 'string' ||
      !node.inputs ||
      typeof node.inputs !== 'object' ||
      Array.isArray(node.inputs)
    )
      throw new Error(
        `${id}: API 노드 형식을 확인해 주세요. ComfyUI에서 API 형식으로 내보내기를 사용하세요`,
      );
    for (const v of Object.values(node.inputs)) {
      if (
        Array.isArray(v) &&
        (v.length !== 2 ||
          typeof v[0] !== 'string' ||
          !Number.isInteger(v[1]) ||
          v[1] < 0 ||
          !Object.hasOwn(value, v[0]))
      )
        throw new Error(`${id}: 노드 연결이 올바르지 않습니다`);
      if (typeof v === 'number' && !Number.isFinite(v))
        throw new Error(`${id}: 숫자 입력을 확인해 주세요`);
    }
  }
  return structuredClone(value) as Workflow;
}
export function validateAgainstServer(w: Workflow, info: ObjectInfo) {
  const errors: string[] = [];
  for (const [id, node] of Object.entries(w)) {
    const schema = info[node.class_type];
    if (!schema) {
      errors.push(`${id}: ${node.class_type} 노드가 서버에 없습니다`);
      continue;
    }
    for (const [key, spec] of Object.entries(schema.input.required || {}))
      if (
        !Object.hasOwn(node.inputs, key) &&
        !['PROMPT', 'EXTRA_PNGINFO', 'UNIQUE_ID'].includes(String(spec[0]))
      )
        errors.push(`${id}: ${key} 입력이 필요합니다`);
    for (const [key, value] of Object.entries(node.inputs)) {
      if (Array.isArray(value)) continue;
      // Annotated output paths are checked by LoadImage itself, not by the input list.
      if (node.class_type === 'LoadImage' && key === 'image') continue;
      const spec = schema.input.required?.[key] || schema.input.optional?.[key];
      if (!spec) continue;
      const choices = Array.isArray(spec[0])
        ? spec[0]
        : spec[0] === 'COMBO' && Array.isArray(spec[1]?.options)
          ? spec[1].options
          : null;
      if (choices && !choices.includes(String(value)))
        errors.push(`${id}: ${key}의 설치값을 다시 선택해 주세요`);
      if (
        ['INT', 'FLOAT'].includes(String(spec[0])) &&
        (typeof value !== 'number' ||
          !Number.isFinite(value) ||
          (spec[0] === 'INT' && !Number.isInteger(value)) ||
          (typeof spec[1]?.min === 'number' && value < spec[1].min) ||
          (typeof spec[1]?.max === 'number' && value > spec[1].max))
      )
        errors.push(`${id}: ${key} 숫자 범위를 확인해 주세요`);
    }
  }
  if (errors.length) throw new Error(errors.join('\n'));
}
export function buildWorkflow(s: Generation): Workflow {
  validateGeneration(s);
  if (s.workflow) return parseWorkflow(s.workflow);
  const profile = families.find((f) => f.id === s.architecture);
  if (!profile) throw new Error('지원하는 네 계열에서 모델을 선택해 주세요');
  const loader = s.modelLoader || 'CheckpointLoaderSimple';
  let modelNode: Workflow[string];
  // Only the MODEL output is used, so diffusion-only files in the checkpoints folder
  // work for every family; text encoders and VAE always come from their own loaders.
  if (loader === 'CheckpointLoaderSimple')
    modelNode = { class_type: loader, inputs: { ckpt_name: s.model } };
  else if (loader === 'UNETLoader')
    modelNode = { class_type: loader, inputs: { unet_name: s.model, weight_dtype: 'default' } };
  else if (loader === 'UnetLoaderGGUF')
    modelNode = { class_type: loader, inputs: { unet_name: s.model } };
  else if (loader === 'UnetLoaderGGUFAdvanced')
    modelNode = {
      class_type: loader,
      inputs: {
        unet_name: s.model,
        dequant_dtype: 'default',
        patch_dtype: 'default',
        patch_on_device: false,
      },
    };
  else if (loader === 'GGUFLoaderKJ')
    modelNode = {
      class_type: loader,
      inputs: {
        model_name: s.model,
        extra_model_name: 'none',
        dequant_dtype: 'default',
        patch_dtype: 'default',
        patch_on_device: false,
        enable_fp16_accumulation: false,
        attention_override: 'none',
      },
    };
  else throw new Error('선택한 계열의 모델 로더를 확인해 주세요');
  const w: Workflow = {
    '1': modelNode,
    '8': {
      class_type: encoderLoader(s),
      inputs:
        s.architecture === 'flux'
          ? { clip_name1: s.clip1, clip_name2: s.clip2, type: profile.clipType }
          : { clip_name: s.clip1, type: profile.clipType },
    },
    '9': { class_type: 'VAELoader', inputs: { vae_name: s.vae } },
    '2': { class_type: 'CLIPTextEncode', inputs: { text: s.positive, clip: ['8', 0] } },
    '3': { class_type: 'CLIPTextEncode', inputs: { text: s.negative, clip: ['8', 0] } },
    // Empty latents are adapted to the selected model's channel count by ComfyUI.
    '4': {
      class_type: ['moss', 'qwen21'].includes(s.architecture)
        ? 'EmptyFlux2LatentImage'
        : 'EmptySD3LatentImage',
      inputs: { width: s.width, height: s.height, batch_size: s.batch },
    },
    '5': {
      class_type: 'KSampler',
      inputs: {
        model: ['1', 0],
        positive: ['2', 0],
        negative: ['3', 0],
        latent_image: ['4', 0],
        seed: s.seed,
        steps: s.steps,
        cfg: s.cfg,
        sampler_name: s.sampler,
        scheduler: s.scheduler,
        denoise: s.denoise,
      },
    },
    '6': { class_type: 'VAEDecode', inputs: { samples: ['5', 0], vae: ['9', 0] } },
    '7': { class_type: 'SaveImage', inputs: { images: ['6', 0], filename_prefix: 'ComfyMUI' } },
  };
  let modelSource = '1',
    clipSource = '8';
  s.loras.forEach((l, i) => {
    const id = String(100 + i);
    if (s.architecture === 'flux') {
      w[id] = {
        class_type: 'LoraLoader',
        inputs: {
          model: [modelSource, 0],
          clip: [clipSource, clipSource === '8' ? 0 : 1],
          lora_name: l.name,
          strength_model: l.model,
          strength_clip: l.clip,
        },
      };
      clipSource = id;
    } else
      w[id] = {
        class_type: 'LoraLoaderModelOnly',
        inputs: { model: [modelSource, 0], lora_name: l.name, strength_model: l.model },
      };
    modelSource = id;
  });
  w['2'].inputs.clip = [clipSource, clipSource === '8' ? 0 : 1];
  w['3'].inputs.clip = [...(w['2'].inputs.clip as unknown[])];
  w['5'].inputs.model = [modelSource, 0];
  if (s.architecture === 'flux') {
    w['20'] = {
      class_type: 'FluxGuidance',
      inputs: { conditioning: ['2', 0], guidance: s.guidance },
    };
    w['5'].inputs.positive = ['20', 0];
  } else if (s.architecture === 'krea2') {
    // Krea 2 Turbo is a distilled single-stream DiT model that manages its own sampling schedule.
    // Injecting ModelSamplingFlux distorts its timesteps and produces severe droplet/scale patch artifacts.
    if (s.cfg === 1)
      w['3'] = { class_type: 'ConditioningZeroOut', inputs: { conditioning: ['2', 0] } };
  } else if (s.architecture === 'qwen21') {
    w['2'] = {
      class_type: 'TextEncodeQwenImage21',
      inputs: {
        clip: ['8', 0],
        prompt: s.positive,
        negative_prompt: s.negative,
        resolution: 0,
        images: {},
      },
    };
    w['5'].inputs.negative = ['2', 1];
    delete w['3'];
  }
  return s.upscale ? withUpscale(w, s, s.upscale) : w;
}
function withUpscale(w: Workflow, s: Generation, up: UpscaleSpec): Workflow {
  if (!up.model) throw new Error('업스케일 모델을 선택해 주세요');
  if (!Number.isFinite(up.refine) || up.refine < 0 || up.refine > 1)
    throw new Error('디테일 보정 강도를 확인해 주세요');
  const scaled: Workflow = {
    '50': { class_type: 'LoadImage', inputs: { image: annotatedImage(up.source) } },
    '51': { class_type: 'UpscaleModelLoader', inputs: { model_name: up.model } },
    '52': {
      class_type: 'ImageUpscaleWithModel',
      inputs: { upscale_model: ['51', 0], image: ['50', 0] },
    },
    // Upscale models have a fixed factor (often 4x), so resize to the exact target size.
    '53': {
      class_type: 'ImageScale',
      inputs: {
        image: ['52', 0],
        upscale_method: 'lanczos',
        width: s.width,
        height: s.height,
        crop: 'disabled',
      },
    },
  };
  if (up.refine <= 0)
    return {
      ...scaled,
      '7': { class_type: 'SaveImage', inputs: { images: ['53', 0], filename_prefix: 'ComfyMUI' } },
    };
  const refined: Workflow = { ...w, ...scaled };
  delete refined['4'];
  refined['54'] = { class_type: 'VAEEncode', inputs: { pixels: ['53', 0], vae: ['9', 0] } };
  refined['5'].inputs.latent_image = ['54', 0];
  refined['5'].inputs.denoise = up.refine;
  return refined;
}
export function parseSettings(value: unknown): Generation {
  if (!value || typeof value !== 'object') throw new Error('설정 형식을 확인해 주세요');
  const s = {
    ...value,
    modelLoader: (value as Generation).modelLoader ?? 'CheckpointLoaderSimple',
  } as Generation;
  if (typeof s.modelLoader !== 'string') throw new Error('모델 로더 설정을 확인해 주세요');
  for (const k of [
    'model',
    'positive',
    'negative',
    'sampler',
    'scheduler',
    'clip1',
    'clip2',
    'vae',
  ] as const)
    if (typeof s[k] !== 'string') throw new Error(`${k} 설정을 확인해 주세요`);
  if (
    typeof s.random !== 'boolean' ||
    !Array.isArray(s.loras) ||
    s.loras.length > 20 ||
    !s.loras.every((l) => l && typeof l.name === 'string')
  )
    throw new Error('LoRA 또는 seed 설정을 확인해 주세요');
  if (s.workflow !== null) parseWorkflow(s.workflow);
  validateGeneration(s);
  return structuredClone(s);
}
export function importPresets(text: string): Preset[] {
  const data = JSON.parse(text);
  if (data.version !== 1 || !Array.isArray(data.presets) || data.presets.length > 100)
    throw new Error('버전 1 프리셋 파일을 선택해 주세요 (최대 100개)');
  return data.presets.map((p: Preset) => {
    if (
      !p ||
      typeof p.name !== 'string' ||
      !p.name.trim() ||
      p.name.length > 80 ||
      typeof p.description !== 'string'
    )
      throw new Error('프리셋 이름과 설명을 확인해 주세요');
    return {
      id: newId(),
      name: p.name,
      description: p.description,
      color: ['sage', 'sand', 'rose'].includes(p.color) ? p.color : 'sage',
      updatedAt: Date.now(),
      settings: parseSettings(p.settings),
    };
  });
}
export function readStored<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    return v ? JSON.parse(v) : fallback;
  } catch {
    return fallback;
  }
}
export function downloadJson(filename: string, data: unknown) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }),
  );
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
