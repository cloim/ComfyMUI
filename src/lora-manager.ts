import { request } from './api';
import { inferFamily, type ModelFamily } from './models';

export type LoraCivitaiMeta = {
  id?: number;
  modelId?: number;
  name?: string;
  trainedWords?: string[];
};

export type LoraItem = {
  model_name: string;
  file_name: string;
  preview_url: string;
  preview_nsfw_level: number;
  base_model: string;
  folder: string;
  sha256: string;
  file_path: string;
  file_size: number;
  modified: number;
  tags: string[];
  from_civitai: boolean;
  usage_count?: number;
  usage_tips: string;
  notes: string;
  favorite: boolean;
  exclude?: boolean;
  update_available: boolean;
  sub_type?: string;
  civitai?: LoraCivitaiMeta | null;
  auto_tags?: string[];
};

export type LoraListResponse = {
  items: LoraItem[];
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
};

export type LoraUsageTips = {
  strength?: number;
  clipStrength?: number;
};

export type CivitaiFile = {
  id: number;
  name?: string;
  sizeKB?: number;
  type?: string;
  primary?: boolean;
  downloadUrl?: string;
};

export type CivitaiImageResource = {
  name?: string;
  type?: string;
  weight?: number;
  hash?: string;
};

// Generation data CivitAI attaches to an example image. Keys follow A1111 naming.
export type CivitaiImageMeta = {
  prompt?: string;
  negativePrompt?: string;
  sampler?: string;
  steps?: number | string;
  cfgScale?: number | string;
  seed?: number | string;
  Size?: string;
  Model?: string;
  resources?: CivitaiImageResource[];
  civitaiResources?: { type?: string; weight?: number; modelVersionName?: string }[];
  [key: string]: unknown;
};

export type CivitaiImage = {
  url: string;
  nsfwLevel?: number;
  width?: number;
  height?: number;
  type?: string;
  id?: number;
  meta?: CivitaiImageMeta | null;
};

export type CivitaiVersion = {
  id: number;
  modelId?: number;
  name: string;
  baseModel?: string;
  description?: string;
  trainedWords?: string[];
  files?: CivitaiFile[];
  images?: CivitaiImage[];
  modelSizeKB?: number;
  existsLocally?: boolean;
  localPath?: string | null;
  hasBeenDownloaded?: boolean;
  model?: {
    name?: string;
    type?: string;
    nsfw?: boolean;
  };
};

export type LoraUpdateRecord = {
  model_type: string;
  model_id: number;
  version_ids: number[];
  last_checked_at?: number;
  should_ignore?: boolean;
  in_library_version_ids: number[];
  version_Status?: Record<string, boolean>;
  has_update: boolean;
};

export type DownloadProgressSnapshot = {
  progress: number;
  bytes_downloaded?: number;
  total_bytes?: number;
  bytes_per_second?: number;
  status?: 'queued' | 'downloading' | 'paused' | 'completed' | 'error' | 'cancelled' | string;
  file_name?: string;
  error?: string | null;
};

export type LoraFilterParams = {
  page?: number;
  pageSize?: number;
  sortBy?: 'name' | 'date:desc' | 'date:asc' | 'size:desc' | 'size:asc' | 'usage:desc';
  search?: string;
  folder?: string;
  baseModel?: string;
  tag?: string;
  tags?: string[];
  tagLogic?: 'any' | 'all';
  favoritesOnly?: boolean;
  updatesOnly?: boolean;
};

export function parseUsageTips(raw?: string | null): LoraUsageTips {
  if (!raw || typeof raw !== 'string') return {};
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return {};
    const out: LoraUsageTips = {};
    const s = Number(parsed.strength ?? parsed.strength_model ?? parsed.clip_skip);
    if (Number.isFinite(s) && s >= -2 && s <= 2) {
      out.strength = Number(s.toFixed(2));
    }
    const cs = Number(parsed.clipStrength ?? parsed.strength_clip);
    if (Number.isFinite(cs) && cs >= -2 && cs <= 2) {
      out.clipStrength = Number(cs.toFixed(2));
    }
    return out;
  } catch {
    return {};
  }
}

export function serializeUsageTips(tips: LoraUsageTips): string {
  const payload: Record<string, number> = {};
  if (typeof tips.strength === 'number' && Number.isFinite(tips.strength)) {
    payload.strength = Number(tips.strength.toFixed(2));
  }
  if (typeof tips.clipStrength === 'number' && Number.isFinite(tips.clipStrength)) {
    payload.clipStrength = Number(tips.clipStrength.toFixed(2));
  }
  return JSON.stringify(payload);
}

export type CivitaiAir = {
  ecosystem: string;
  type: string;
  modelId: number;
  modelVersionId?: number;
  fileId?: number;
};

const LORA_AIR_TYPES = ['lora', 'lycoris', 'locon', 'dora'];
const NON_MODEL_AIR_TYPES = ['embedding', 'vae', 'controlnet', 'upscaler'];

// AIR: [urn:air: | air:]{ecosystem}:{type}:civitai:{modelId}[@{versionId}][+{fileId}][.{format}]
export function parseCivitaiAir(input: string): CivitaiAir | null {
  const match = input
    .trim()
    .match(
      /^(?:urn:air:|air:)?([a-z0-9_-]+):([a-z0-9_-]+):civitai:(\d+)(?:@(\d+))?(?:\+(\d+))?(?:\.[a-z0-9]+)?$/i,
    );
  if (!match) return null;
  const [modelId, modelVersionId, fileId] = [match[3], match[4], match[5]].map((v) =>
    v === undefined ? undefined : Number(v),
  );
  const valid = (n?: number) => n === undefined || (Number.isSafeInteger(n) && n > 0);
  if (!modelId || !valid(modelId) || !valid(modelVersionId) || !valid(fileId)) return null;
  // A file ID only makes sense inside a specific version.
  if (fileId && !modelVersionId) return null;
  return {
    ecosystem: match[1].toLowerCase(),
    type: match[2].toLowerCase(),
    modelId,
    ...(modelVersionId ? { modelVersionId } : {}),
    ...(fileId ? { fileId } : {}),
  };
}

// Returns a user-facing problem when the AIR cannot be used on the given screen.
export function civitaiAirProblem(input: string, target: 'lora' | 'model'): string {
  if (!input.trim()) return 'CivitAI AIR 코드를 입력해 주세요';
  const air = parseCivitaiAir(input);
  if (!air) return 'AIR 코드 형식을 확인해 주세요 (예: urn:air:flux1:lora:civitai:840370@940211)';
  const isLora = LORA_AIR_TYPES.includes(air.type);
  if (target === 'lora' && !isLora)
    return `${air.type} 유형의 AIR 코드예요. LoRA AIR 코드를 입력해 주세요`;
  if (target === 'model' && (isLora || NON_MODEL_AIR_TYPES.includes(air.type)))
    return `${air.type} 유형의 AIR 코드예요. 모델 화면에는 체크포인트 AIR 코드를 입력해 주세요`;
  return '';
}

export function inferFamilyFromLoraItem(
  item: Pick<LoraItem, 'base_model' | 'folder' | 'file_name' | 'file_path'>,
): ModelFamily | null {
  const bm = (item.base_model || '').toLowerCase();
  if (bm.includes('krea')) return 'krea2';
  if (bm.includes('moss')) return 'moss';
  if (bm.includes('qwen')) return 'qwen21';
  if (bm.includes('flux')) return 'flux';

  const combined = `${item.folder || ''}/${item.file_name || ''} ${item.file_path || ''}`;
  return inferFamily(combined);
}

export function resolveComfyLoraName(
  item: Pick<LoraItem, 'folder' | 'file_name' | 'file_path'>,
  comfyLoraNames: string[],
): string {
  const extMatch = (item.file_path || '').match(/(\.[^./\\]+)$/);
  const ext = extMatch ? extMatch[1] : '.safetensors';
  const relForward = item.folder
    ? `${item.folder.replaceAll('\\', '/').replace(/\/+$/, '')}/${item.file_name}${ext}`
    : `${item.file_name}${ext}`;
  const relLower = relForward.toLowerCase();
  const baseWithExtLower = `${item.file_name}${ext}`.toLowerCase();
  const baseStemLower = item.file_name.toLowerCase();

  for (const candidate of comfyLoraNames) {
    if (candidate.replaceAll('\\', '/').toLowerCase() === relLower) {
      return candidate;
    }
  }

  for (const candidate of comfyLoraNames) {
    const norm = candidate.replaceAll('\\', '/').toLowerCase();
    const filePart = norm.split('/').pop() || norm;
    if (filePart === baseWithExtLower) {
      return candidate;
    }
  }

  for (const candidate of comfyLoraNames) {
    const norm = candidate.replaceAll('\\', '/').toLowerCase();
    const filePart = (norm.split('/').pop() || norm).replace(/\.[^.]+$/, '');
    if (filePart === baseStemLower) {
      return candidate;
    }
  }

  return relForward.replaceAll('/', '\\');
}

export function appendTriggerWords(currentPrompt: string, words: string[]): string {
  const cleanWords = words.map((w) => w.trim()).filter(Boolean);
  if (cleanWords.length === 0) return currentPrompt;

  const existingLower = currentPrompt.toLowerCase();
  const toAdd = cleanWords.filter((w) => !existingLower.includes(w.toLowerCase()));
  if (toAdd.length === 0) return currentPrompt;

  const trimmed = currentPrompt.trim();
  if (!trimmed) return toAdd.join(', ');
  const sep = trimmed.endsWith(',') ? ' ' : ', ';
  return `${trimmed}${sep}${toAdd.join(', ')}`;
}

export function loraPreviewUrl(base: string, previewUrl?: string): string {
  if (!previewUrl) return '';
  if (/^(https?:|data:|blob:)/i.test(previewUrl)) return previewUrl;
  if (previewUrl.startsWith('/api/lm/')) {
    return `${base}${previewUrl}`;
  }
  return previewUrl;
}

export type ExampleKind = 'checkpoints' | 'loras';

// Full CivitAI data for one model file. The list endpoints drop example images, so the
// detail view reads them here. A file without CivitAI data answers 404.
export async function fetchExampleImages(
  base: string,
  kind: ExampleKind,
  filePath: string,
): Promise<CivitaiImage[]> {
  let res: { success?: boolean; metadata?: { images?: unknown; customImages?: unknown } };
  try {
    res = await request(base, `/api/lm/${kind}/metadata?file_path=${encodeURIComponent(filePath)}`);
  } catch (e) {
    if (/404|not found/i.test(String(e))) return [];
    throw e;
  }
  const list = [
    ...(Array.isArray(res.metadata?.images) ? res.metadata.images : []),
    ...(Array.isArray(res.metadata?.customImages) ? res.metadata.customImages : []),
  ] as CivitaiImage[];
  return list.filter((im) => im && typeof im.url === 'string' && im.url);
}

// The server downloads the remote image and replaces the card preview with it.
export async function setPreviewFromUrl(
  base: string,
  kind: ExampleKind,
  filePath: string,
  image: CivitaiImage,
): Promise<{ preview_url: string; preview_nsfw_level: number }> {
  const res = await request<{
    success?: boolean;
    error?: string;
    preview_url?: string;
    preview_nsfw_level?: number;
  }>(base, `/api/lm/${kind}/set-preview-from-url`, {
    method: 'POST',
    body: JSON.stringify({
      model_path: filePath,
      image_url: image.url,
      nsfw_level: image.nsfwLevel || 0,
    }),
  });
  if (!res.success || !res.preview_url)
    throw new Error(res.error || '기본 이미지를 바꾸지 못했어요');
  return { preview_url: res.preview_url, preview_nsfw_level: res.preview_nsfw_level ?? 0 };
}

export const DEMO_EXAMPLE_IMAGES: CivitaiImage[] = [
  {
    url: '/sample.svg',
    width: 832,
    height: 1216,
    nsfwLevel: 1,
    type: 'image',
    meta: {
      prompt: 'portrait of an elegant adult woman, soft window light, film grain, 85mm',
      negativePrompt: 'blurry, lowres',
      sampler: 'euler',
      steps: 24,
      cfgScale: 1,
      seed: 4123,
      Size: '832x1216',
      'Distilled CFG Scale': '3.5',
      resources: [{ name: 'Flux 1.D Studio', type: 'model' }],
    },
  },
  { url: '/sample.svg', width: 1216, height: 832, nsfwLevel: 1, type: 'image', meta: null },
  { url: '/sample.svg', width: 1024, height: 1024, nsfwLevel: 8, type: 'image', meta: null },
];

// CivitAI CDN paths are /{key}/{uuid}/{options}/{name}; the options segment picks the
// rendition. Thumbnails ask for a narrow copy, the viewer asks for the full image.
export function civitaiMediaUrl(
  base: string,
  url: string,
  size: 'thumb' | 'full',
  video = false,
): string {
  if (url.startsWith('/api/lm/') || url.startsWith('/example_images_static/'))
    return `${base}${url}`;
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    if (!host.endsWith('.civitai.com')) return url;
    const parts = parsed.pathname.split('/');
    if (parts.length < 5 || !/^[a-z]+=/.test(parts[3])) return url;
    parts[3] =
      size === 'full'
        ? 'optimized=true'
        : video
          ? 'transcode=true,width=450,optimized=true'
          : 'width=450,optimized=true';
    parsed.pathname = parts.join('/');
    return parsed.toString();
  } catch {
    return url;
  }
}

export function isVideoMedia(image: Pick<CivitaiImage, 'url' | 'type'>): boolean {
  return image.type === 'video' || isVideoPreview(image.url);
}

export function isVideoPreview(url?: string): boolean {
  if (!url) return false;
  return /(\.|%2e)(mp4|webm|mov)(\?|&|$)/i.test(url);
}

export function formatBytes(bytes?: number): string {
  if (!bytes || !Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let val = bytes;
  let idx = 0;
  while (val >= 1024 && idx < units.length - 1) {
    val /= 1024;
    idx++;
  }
  return `${val.toFixed(idx >= 2 ? 1 : 0)} ${units[idx]}`;
}

export const DEMO_LORAS: LoraItem[] = [
  {
    model_name: 'Flux Detail Enhancer Studio',
    file_name: 'flux-detail',
    preview_url: '/sample.svg',
    preview_nsfw_level: 1,
    base_model: 'Flux.1 D',
    folder: 'Flux1.D/commons',
    sha256: 'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90',
    file_path: 'E:/ComfyUI/models/loras/Flux1.D/commons/flux-detail.safetensors',
    file_size: 154_200_000,
    modified: 1762000000,
    tags: ['detail', 'lighting', 'portrait'],
    from_civitai: true,
    usage_count: 12,
    usage_tips: '{"strength":0.75,"clipStrength":0.75}',
    notes: '인물 피부 디테일과 자연광 하이라이트 보강용 기본 LoRA',
    favorite: true,
    update_available: true,
    civitai: {
      id: 940211,
      modelId: 840370,
      name: 'v1.2 Studio',
      trainedWords: ['detailed skin texture', 'soft studio rim light'],
    },
  },
  {
    model_name: 'Krea2 Editorial Portrait Tone',
    file_name: 'krea2-style',
    preview_url: '/sample.svg',
    preview_nsfw_level: 1,
    base_model: 'Krea2',
    folder: 'Krea2',
    sha256: 'b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90a1',
    file_path: 'E:/ComfyUI/models/loras/Krea2/krea2-style.safetensors',
    file_size: 92_400_000,
    modified: 1761900000,
    tags: ['editorial', 'fashion', 'film'],
    from_civitai: true,
    usage_count: 6,
    usage_tips: '{"strength":0.8,"clipStrength":0.8}',
    notes: '8스텝 Krea2 매거진 화보 톤앤매너 보정',
    favorite: false,
    update_available: false,
    civitai: {
      id: 951102,
      modelId: 851000,
      name: 'v1.0',
      trainedWords: ['editorial portrait', 'kodak portra 400'],
    },
  },
  {
    model_name: 'MOSS Soft Film Grain',
    file_name: 'moss-tone',
    preview_url: '/sample.svg',
    preview_nsfw_level: 1,
    base_model: 'MOSS',
    folder: 'Flux1.D/illust',
    sha256: 'c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2',
    file_path: 'E:/ComfyUI/models/loras/Flux1.D/illust/moss-tone.safetensors',
    file_size: 118_000_000,
    modified: 1761800000,
    tags: ['cinema', 'colorgrading'],
    from_civitai: false,
    usage_count: 3,
    usage_tips: '{"strength":0.65,"clipStrength":0.65}',
    notes: '부드러운 필름 입자감과 시네마틱 색감 연출',
    favorite: false,
    update_available: false,
    civitai: {
      id: 0,
      modelId: 0,
      name: 'Local v1',
      trainedWords: ['cinematic color grading'],
    },
  },
  {
    model_name: 'Qwen 2.1 Realism Enhancer',
    file_name: 'qwen_image_2_1-detail',
    preview_url: '/sample.svg',
    preview_nsfw_level: 1,
    base_model: 'Qwen',
    folder: 'Qwen',
    sha256: 'd4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3',
    file_path: 'E:/ComfyUI/models/loras/Qwen/qwen_image_2_1-detail.safetensors',
    file_size: 210_500_000,
    modified: 1761700000,
    tags: ['realism', 'qwen', 'highres'],
    from_civitai: true,
    usage_count: 9,
    usage_tips: '{"strength":0.85,"clipStrength":0.85}',
    notes: 'Qwen 2.1 VL 멀티모달 선명도 및 홍채 디테일 향상',
    favorite: true,
    update_available: false,
    civitai: {
      id: 962001,
      modelId: 862000,
      name: 'v2.0',
      trainedWords: ['ultra sharp focus', 'natural catchlight'],
    },
  },
];

export async function fetchLoraList(
  base: string,
  params: LoraFilterParams = {},
): Promise<LoraListResponse> {
  const qs = new URLSearchParams();
  qs.set('page', String(params.page ?? 1));
  qs.set('page_size', String(params.pageSize ?? 100));
  qs.set('sort_by', params.sortBy ?? 'date:desc');
  qs.set('recursive', 'true');
  if (params.search?.trim()) {
    qs.set('search', params.search.trim());
    qs.set('fuzzy_search', 'true');
    qs.set('search_filename', 'true');
    qs.set('search_modelname', 'true');
    qs.set('search_tags', 'true');
    qs.set('search_trigger_words', 'true');
  }
  if (params.folder !== undefined && params.folder !== 'all') {
    qs.set('folder', params.folder);
  }
  if (params.baseModel && params.baseModel !== 'all') {
    qs.append('base_model', params.baseModel);
  }
  if (params.tags && params.tags.length > 0) {
    for (const t of params.tags) {
      if (t && t !== 'all') qs.append('tag_include', t);
    }
  } else if (params.tag && params.tag !== 'all') {
    qs.append('tag_include', params.tag);
  }
  if (params.tagLogic) {
    qs.set('tag_logic', params.tagLogic);
  }
  if (params.favoritesOnly) {
    qs.set('favorites_only', 'true');
  }
  if (params.updatesOnly) {
    qs.set('update_available_only', 'true');
  }
  return request<LoraListResponse>(base, `/api/lm/loras/list?${qs.toString()}`);
}

export async function fetchLoraFolders(base: string): Promise<string[]> {
  const res = await request<{ folders?: string[] }>(
    base,
    '/api/lm/loras/folders?include_empty=true',
  );
  return Array.isArray(res.folders) ? res.folders : [];
}

export async function fetchLoraRoots(base: string): Promise<string[]> {
  const res = await request<{ roots?: string[] }>(base, '/api/lm/loras/roots');
  return Array.isArray(res.roots) ? res.roots : [];
}

export async function fetchLoraBaseModels(
  base: string,
): Promise<{ name: string; count: number }[]> {
  const res = await request<{ base_models?: { name: string; count: number }[] }>(
    base,
    '/api/lm/loras/base-models?limit=30',
  );
  return Array.isArray(res.base_models) ? res.base_models : [];
}

export async function fetchLoraTopTags(
  base: string,
  limit = 100,
): Promise<{ tag: string; count: number }[]> {
  const res = await request<{ tags?: { tag: string; count: number }[] }>(
    base,
    `/api/lm/loras/top-tags?limit=${limit}`,
  );
  return Array.isArray(res.tags) ? res.tags : [];
}

export async function scanLoras(
  base: string,
  fullRebuild = false,
): Promise<{ status?: string; message?: string }> {
  return request(base, `/api/lm/loras/scan?full_rebuild=${fullRebuild ? 'true' : 'false'}`);
}

export async function saveLoraMetadata(
  base: string,
  payload: {
    file_path: string;
    favorite?: boolean;
    notes?: string;
    model_name?: string;
    base_model?: string;
    usage_tips?: string;
    tags?: string[];
    civitai?: { trainedWords?: string[] };
  },
): Promise<{ success: boolean }> {
  return request(base, '/api/lm/loras/save-metadata', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function addLoraTags(
  base: string,
  filePath: string,
  tags: string[],
): Promise<{ success: boolean; tags?: string[] }> {
  return request(base, '/api/lm/loras/add-tags', {
    method: 'POST',
    body: JSON.stringify({ file_path: filePath, tags }),
  });
}

export async function renameLoraFile(
  base: string,
  filePath: string,
  newFileName: string,
): Promise<{ success: boolean; new_file_path?: string }> {
  return request(base, '/api/lm/loras/rename', {
    method: 'POST',
    body: JSON.stringify({ file_path: filePath, new_file_name: newFileName }),
  });
}

export async function moveLoraFile(
  base: string,
  filePath: string,
  targetPath: string,
): Promise<{ success: boolean; new_file_path?: string }> {
  return request(base, '/api/lm/loras/move_model', {
    method: 'POST',
    body: JSON.stringify({ file_path: filePath, target_path: targetPath }),
  });
}

export async function deleteLoraFile(
  base: string,
  filePath: string,
): Promise<{ success: boolean }> {
  return request(base, '/api/lm/loras/delete', {
    method: 'POST',
    body: JSON.stringify({ file_path: filePath }),
  });
}

export async function fetchLoraCivitaiMetadata(
  base: string,
  filePath: string,
): Promise<{ success: boolean; error?: string }> {
  return request(base, '/api/lm/loras/fetch-civitai', {
    method: 'POST',
    body: JSON.stringify({ file_path: filePath }),
  });
}

export async function relinkLoraCivitai(
  base: string,
  payload: { file_path: string; model_id: number; model_version_id?: number },
): Promise<{ success: boolean; message?: string }> {
  return request(base, '/api/lm/loras/relink-civitai', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function refreshLoraUpdates(
  base: string,
  modelIds?: number[],
): Promise<{ success: boolean; records?: LoraUpdateRecord[] }> {
  return request(base, '/api/lm/loras/updates/refresh', {
    method: 'POST',
    body: JSON.stringify({
      force: true,
      ...(modelIds && modelIds.length > 0 ? { modelIds } : {}),
    }),
  });
}

export async function fetchCivitaiModelVersions(
  base: string,
  modelId: number,
): Promise<CivitaiVersion[]> {
  const res = await request<CivitaiVersion[] | { versions?: CivitaiVersion[] }>(
    base,
    `/api/lm/loras/civitai/versions/${encodeURIComponent(String(modelId))}`,
  );
  if (Array.isArray(res)) return res;
  if (res && Array.isArray(res.versions)) return res.versions;
  return [];
}

export async function fetchCivitaiVersionById(
  base: string,
  modelVersionId: number,
): Promise<CivitaiVersion> {
  return request<CivitaiVersion>(
    base,
    `/api/lm/loras/civitai/model/version/${encodeURIComponent(String(modelVersionId))}`,
  );
}

export async function downloadCivitaiLora(
  base: string,
  payload: {
    model_id?: number;
    model_version_id?: number;
    model_root?: string;
    relative_path?: string;
    use_default_paths?: boolean;
    use_save_dir_as_root?: boolean;
    download_id?: string;
    file_params?: { id: number };
  },
): Promise<{
  success: boolean;
  download_id?: string;
  result?: Record<string, unknown>;
  error?: string;
}> {
  // No client timeout: the server answers only when the file is finished.
  const response = await fetch(`${base}/api/lm/download-model`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body.success === false) {
    const message =
      body.error?.message || body.error || response.statusText || 'CivitAI 다운로드에 실패했습니다';
    throw Object.assign(new Error(String(message)), { status: response.status });
  }
  return body;
}

export async function cancelLoraDownload(
  base: string,
  downloadId: string,
): Promise<{ success: boolean }> {
  return request(base, `/api/lm/cancel-download-get?download_id=${encodeURIComponent(downloadId)}`);
}
