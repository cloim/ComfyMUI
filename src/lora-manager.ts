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

export type CivitaiImage = {
  url: string;
  nsfwLevel?: number;
  width?: number;
  height?: number;
  type?: string;
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

export function parseCivitaiInput(
  input: string,
  mode: 'auto' | 'model' | 'version' = 'auto',
): { modelId?: number; modelVersionId?: number } {
  const trimmed = input.trim();
  if (!trimmed) return {};

  if (/^\d+$/.test(trimmed)) {
    const num = Number(trimmed);
    if (!Number.isSafeInteger(num) || num <= 0) return {};
    if (mode === 'version') return { modelVersionId: num };
    return { modelId: num };
  }

  try {
    const url = new URL(trimmed);
    const versionParam = url.searchParams.get('modelVersionId');
    const parsedVersionParam =
      versionParam && /^\d+$/.test(versionParam) ? Number(versionParam) : undefined;

    const downloadMatch = url.pathname.match(/\/api\/download\/models\/(\d+)/i);
    if (downloadMatch) {
      return { modelVersionId: Number(downloadMatch[1]) };
    }

    const modelVersionPathMatch = url.pathname.match(/\/model-versions\/(\d+)/i);
    if (modelVersionPathMatch) {
      return { modelVersionId: Number(modelVersionPathMatch[1]) };
    }

    const modelMatch = url.pathname.match(/\/models\/(\d+)/i);
    if (modelMatch) {
      return {
        modelId: Number(modelMatch[1]),
        ...(parsedVersionParam ? { modelVersionId: parsedVersionParam } : {}),
      };
    }

    if (parsedVersionParam) {
      return { modelVersionId: parsedVersionParam };
    }
  } catch {
    const modelMatch = trimmed.match(/models\/(\d+)/i);
    const versionMatch = trimmed.match(/modelVersionId=(\d+)/i);
    if (modelMatch || versionMatch) {
      return {
        ...(modelMatch ? { modelId: Number(modelMatch[1]) } : {}),
        ...(versionMatch ? { modelVersionId: Number(versionMatch[1]) } : {}),
      };
    }
  }

  return {};
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
  return request(
    base,
    `/api/lm/loras/scan?full_rebuild=${fullRebuild ? 'true' : 'false'}`,
  );
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
    download_id?: string;
  },
): Promise<{
  success: boolean;
  download_id?: string;
  result?: Record<string, unknown>;
  error?: string;
}> {
  const response = await fetch(`${base}/api/lm/download-model`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(300_000),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body.success === false) {
    throw new Error(body.error || response.statusText || 'CivitAI 다운로드에 실패했습니다');
  }
  return body;
}

export async function fetchDownloadProgress(
  base: string,
  downloadId: string,
): Promise<DownloadProgressSnapshot | null> {
  try {
    const res = await request<{ success: boolean; progress?: DownloadProgressSnapshot }>(
      base,
      `/api/lm/download-progress/${encodeURIComponent(downloadId)}`,
    );
    return res.progress || null;
  } catch {
    return null;
  }
}

export async function cancelLoraDownload(
  base: string,
  downloadId: string,
): Promise<{ success: boolean }> {
  return request(
    base,
    `/api/lm/cancel-download-get?download_id=${encodeURIComponent(downloadId)}`,
  );
}
