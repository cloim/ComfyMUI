import { request } from './api';
import type { ObjectInfo } from './domain';
import {
  assetFamily,
  catalog,
  comboOptions,
  families,
  inferFamily,
  modelSources,
  type FamilyAssignments,
  type ModelEntry,
  type ModelFamily,
} from './models';
import {
  formatBytes,
  isVideoPreview,
  loraPreviewUrl,
  civitaiAirProblem,
  parseCivitaiAir,
  type CivitaiAir,
  type CivitaiVersion,
  type DownloadProgressSnapshot,
  type LoraCivitaiMeta,
  type LoraUpdateRecord,
} from './lora-manager';

export {
  formatBytes,
  isVideoPreview,
  loraPreviewUrl as modelPreviewUrl,
  civitaiAirProblem,
  parseCivitaiAir,
  type CivitaiAir,
  type CivitaiVersion,
  type DownloadProgressSnapshot,
};

export type ModelManagerItem = {
  model_name: string;
  file_name: string;
  preview_url: string;
  preview_nsfw_level: number;
  base_model: string;
  folder: string;
  sha256: string;
  hash_status?: string;
  quantization?: string | null;
  file_path: string;
  file_size: number;
  modified: number;
  tags: string[];
  from_civitai: boolean;
  usage_count?: number;
  notes: string;
  sub_type?: 'checkpoint' | 'diffusion_model' | string;
  favorite: boolean;
  exclude?: boolean;
  update_available: boolean;
  civitai?: LoraCivitaiMeta | null;
  auto_tags?: string[];
};

export type ModelListResponse = {
  items: ModelManagerItem[];
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
};

export type ModelFilterParams = {
  page?: number;
  pageSize?: number;
  sortBy?: 'name' | 'date:desc' | 'date:asc' | 'size:desc' | 'size:asc' | 'usage:desc';
  search?: string;
  folder?: string;
  baseModel?: string;
  subType?: string;
  tags?: string[];
  tagLogic?: 'any' | 'all';
  favoritesOnly?: boolean;
  updatesOnly?: boolean;
};

export function inferFamilyFromModelItem(
  item: Pick<ModelManagerItem, 'base_model' | 'folder' | 'file_name' | 'file_path'>,
): ModelFamily | null {
  const combined = `${item.folder || ''}/${item.file_name || ''} ${item.file_path || ''}`;
  const fromPath = inferFamily(combined);
  if (fromPath) return fromPath;

  const bm = (item.base_model || '').toLowerCase();
  if (bm.includes('krea')) return 'krea2';
  if (bm.includes('moss')) return 'moss';
  if (bm.includes('qwen')) return 'qwen21';
  if (bm.includes('flux') && !/flux[ ._-]?2|klein|kontext/.test(bm)) return 'flux';
  return null;
}

export function isSpecializedModelPath(nameOrPath: string): boolean {
  return /nunchaku|svdq|kontext|(^|[\\/])edit([\\/])/i.test(nameOrPath);
}

export function formatModelSubType(
  item: Pick<ModelManagerItem, 'sub_type' | 'file_path' | 'quantization'>,
): string {
  if (/\.gguf$/i.test(item.file_path || '')) return 'GGUF';
  if (item.sub_type === 'checkpoint') return '체크포인트';
  return 'Diffusion';
}

export function resolveComfyModelName(
  item: Pick<ModelManagerItem, 'folder' | 'file_name' | 'file_path' | 'sub_type'>,
  info: ObjectInfo | null,
): string {
  const extMatch = (item.file_path || '').match(/(\.[^./\\]+)$/);
  const ext = extMatch ? extMatch[1] : '.safetensors';
  const relForward = item.folder
    ? `${item.folder.replaceAll('\\', '/').replace(/\/+$/, '')}/${item.file_name}${ext}`
    : `${item.file_name}${ext}`;
  const relLower = relForward.toLowerCase();
  const baseWithExtLower = `${item.file_name}${ext}`.toLowerCase();
  const baseStemLower = item.file_name.toLowerCase();

  const pool = modelSources.flatMap((src) => comboOptions(info, src.loader, src.field));
  const uniquePool = [...new Set(pool)];

  for (const candidate of uniquePool) {
    if (candidate.replaceAll('\\', '/').toLowerCase() === relLower) {
      return candidate;
    }
  }

  for (const candidate of uniquePool) {
    const norm = candidate.replaceAll('\\', '/').toLowerCase();
    const filePart = norm.split('/').pop() || norm;
    if (filePart === baseWithExtLower) {
      return candidate;
    }
  }

  for (const candidate of uniquePool) {
    const norm = candidate.replaceAll('\\', '/').toLowerCase();
    const filePart = (norm.split('/').pop() || norm).replace(/\.[^.]+$/, '');
    if (filePart === baseStemLower) {
      return candidate;
    }
  }

  return relForward.replaceAll('/', '\\');
}

export function resolveComfyModelEntry(
  item: Pick<
    ModelManagerItem,
    'base_model' | 'folder' | 'file_name' | 'file_path' | 'sub_type' | 'quantization'
  >,
  info: ObjectInfo | null,
  assignments: FamilyAssignments = {},
): ModelEntry | null {
  const comfyName = resolveComfyModelName(item, info);
  const existingEntries = catalog(info, assignments);

  const exactMatch = existingEntries.find(
    (e) =>
      e.name.replaceAll('\\', '/').toLowerCase() === comfyName.replaceAll('\\', '/').toLowerCase(),
  );
  if (exactMatch) return exactMatch;

  if (isSpecializedModelPath(comfyName) || isSpecializedModelPath(item.file_path || '')) {
    return null;
  }

  const assigned = assetFamily('model', comfyName, assignments);
  const family =
    (assigned && families.some((f) => f.id === assigned) ? assigned : null) ||
    inferFamilyFromModelItem(item);
  if (!family) return null;

  const isGguf = /\.gguf$/i.test(item.file_path || '') || /\.gguf$/i.test(comfyName);
  const isCheckpoint = item.sub_type === 'checkpoint' && !isGguf;

  if (isCheckpoint && family !== 'flux') {
    return null;
  }

  let loader = 'UNETLoader';
  let format = 'Diffusion';
  if (isGguf) {
    loader = info?.UnetLoaderGGUF
      ? 'UnetLoaderGGUF'
      : info?.UnetLoaderGGUFAdvanced
        ? 'UnetLoaderGGUFAdvanced'
        : info?.GGUFLoaderKJ
          ? 'GGUFLoaderKJ'
          : 'UnetLoaderGGUF';
    format = 'GGUF';
  } else if (isCheckpoint) {
    loader = 'CheckpointLoaderSimple';
    format = '체크포인트';
  }

  return {
    id: `${loader}:${comfyName}`,
    name: comfyName,
    loader,
    family,
    format,
  };
}

export const DEMO_MODELS: ModelManagerItem[] = [
  {
    model_name: 'Flux 1.D Studio Checkpoint FP8',
    file_name: '미리보기 Flux1.d',
    preview_url: '/sample.svg',
    preview_nsfw_level: 1,
    base_model: 'Flux.1 D',
    folder: 'Flux1.D',
    sha256: '1010101010101010101010101010101010101010101010101010101010101010',
    hash_status: 'completed',
    quantization: 'FP8',
    file_path: 'E:/ComfyUI/models/checkpoints/Flux1.D/미리보기 Flux1.d.safetensors',
    file_size: 11_901_497_160,
    modified: 1762100000,
    tags: ['flux', 'photorealistic', 'portrait'],
    from_civitai: true,
    usage_count: 24,
    notes: 'Flux 1.D 기본 실사 체크포인트 모델',
    sub_type: 'checkpoint',
    favorite: true,
    update_available: true,
    civitai: {
      id: 852897,
      modelId: 705606,
      name: 'v2.0 FP8',
    },
  },
  {
    model_name: 'Krea 2 Turbo Distilled 8-Step',
    file_name: '미리보기 krea2',
    preview_url: '/sample.svg',
    preview_nsfw_level: 1,
    base_model: 'Krea2',
    folder: 'Krea2',
    sha256: '2020202020202020202020202020202020202020202020202020202020202020',
    hash_status: 'completed',
    quantization: 'INT8',
    file_path: 'E:/ComfyUI/models/diffusion_models/Krea2/미리보기 krea2.safetensors',
    file_size: 12_450_000_000,
    modified: 1762050000,
    tags: ['krea2', 'distilled', 'editorial'],
    from_civitai: true,
    usage_count: 15,
    notes: '8스텝 고속 증류 Krea2 디퓨전 모델',
    sub_type: 'diffusion_model',
    favorite: true,
    update_available: false,
    civitai: {
      id: 910200,
      modelId: 810200,
      name: 'v1.0 Turbo',
    },
  },
  {
    model_name: 'MOSS Image Flow SFT',
    file_name: 'moss_image_preview',
    preview_url: '/sample.svg',
    preview_nsfw_level: 1,
    base_model: 'MOSS',
    folder: '',
    sha256: '3030303030303030303030303030303030303030303030303030303030303030',
    hash_status: 'completed',
    quantization: 'INT8',
    file_path: 'E:/ComfyUI/models/diffusion_models/moss_image_preview.safetensors',
    file_size: 10_820_000_000,
    modified: 1761950000,
    tags: ['moss', 'cinema', 'natural'],
    from_civitai: false,
    usage_count: 7,
    notes: '부드러운 계조와 자연광 표현에 강한 MOSS 모델',
    sub_type: 'diffusion_model',
    favorite: false,
    update_available: false,
    civitai: null,
  },
  {
    model_name: 'Qwen Image 2.1 VL DiT',
    file_name: 'qwen_image_2.1_preview',
    preview_url: '/sample.svg',
    preview_nsfw_level: 1,
    base_model: 'Qwen',
    folder: 'Qwen',
    sha256: '4040404040404040404040404040404040404040404040404040404040404040',
    hash_status: 'completed',
    quantization: 'INT8',
    file_path: 'E:/ComfyUI/models/diffusion_models/Qwen/qwen_image_2.1_preview.safetensors',
    file_size: 14_300_000_000,
    modified: 1761850000,
    tags: ['qwen', 'multimodal', 'detail'],
    from_civitai: true,
    usage_count: 11,
    notes: 'Qwen 2.1 멀티모달 정밀 프롬프트 반영 디퓨전 모델',
    sub_type: 'diffusion_model',
    favorite: false,
    update_available: false,
    civitai: {
      id: 930400,
      modelId: 830400,
      name: 'v2.1 INT8',
    },
  },
];

export async function fetchModelList(
  base: string,
  params: ModelFilterParams = {},
): Promise<ModelListResponse> {
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
  }
  if (params.folder !== undefined && params.folder !== 'all') {
    qs.set('folder', params.folder);
  }
  if (params.baseModel && params.baseModel !== 'all') {
    qs.append('base_model', params.baseModel);
  }
  if (params.subType && params.subType !== 'all') {
    qs.append('model_type', params.subType);
  }
  if (params.tags && params.tags.length > 0) {
    for (const t of params.tags) {
      if (t && t !== 'all') qs.append('tag_include', t);
    }
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
  return request<ModelListResponse>(base, `/api/lm/checkpoints/list?${qs.toString()}`);
}

export async function fetchModelFolders(base: string): Promise<string[]> {
  const res = await request<{ folders?: string[] }>(
    base,
    '/api/lm/checkpoints/folders?include_empty=true',
  );
  return Array.isArray(res.folders) ? res.folders.filter((f) => Boolean(f)) : [];
}

export async function fetchModelRoots(base: string): Promise<string[]> {
  const res = await request<{ roots?: string[] }>(base, '/api/lm/checkpoints/roots');
  return Array.isArray(res.roots) ? res.roots : [];
}

export async function fetchModelBaseModels(
  base: string,
): Promise<{ name: string; count: number }[]> {
  const res = await request<{ base_models?: { name: string; count: number }[] }>(
    base,
    '/api/lm/checkpoints/base-models?limit=30',
  );
  return Array.isArray(res.base_models) ? res.base_models : [];
}

export async function fetchModelTopTags(
  base: string,
  limit = 100,
): Promise<{ tag: string; count: number }[]> {
  const res = await request<{ tags?: { tag: string; count: number }[] }>(
    base,
    `/api/lm/checkpoints/top-tags?limit=${limit}`,
  );
  return Array.isArray(res.tags) ? res.tags : [];
}

export async function scanModels(
  base: string,
  fullRebuild = false,
): Promise<{ status?: string; message?: string }> {
  return request(base, `/api/lm/checkpoints/scan?full_rebuild=${fullRebuild ? 'true' : 'false'}`);
}

export async function saveModelMetadata(
  base: string,
  payload: {
    file_path: string;
    favorite?: boolean;
    notes?: string;
    model_name?: string;
    base_model?: string;
    tags?: string[];
  },
): Promise<{ success: boolean }> {
  return request(base, '/api/lm/checkpoints/save-metadata', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function addModelTags(
  base: string,
  filePath: string,
  tags: string[],
): Promise<{ success: boolean; tags?: string[] }> {
  return request(base, '/api/lm/checkpoints/add-tags', {
    method: 'POST',
    body: JSON.stringify({ file_path: filePath, tags }),
  });
}

export async function renameModelFile(
  base: string,
  filePath: string,
  newFileName: string,
): Promise<{ success: boolean; new_file_path?: string }> {
  return request(base, '/api/lm/checkpoints/rename', {
    method: 'POST',
    body: JSON.stringify({ file_path: filePath, new_file_name: newFileName }),
  });
}

export async function moveModelFile(
  base: string,
  filePath: string,
  targetPath: string,
): Promise<{ success: boolean; new_file_path?: string }> {
  return request(base, '/api/lm/checkpoints/move_model', {
    method: 'POST',
    body: JSON.stringify({ file_path: filePath, target_path: targetPath }),
  });
}

export async function deleteModelFile(
  base: string,
  filePath: string,
): Promise<{ success: boolean }> {
  return request(base, '/api/lm/checkpoints/delete', {
    method: 'POST',
    body: JSON.stringify({ file_path: filePath }),
  });
}

export async function fetchModelCivitaiMetadata(
  base: string,
  filePath: string,
): Promise<{ success: boolean; error?: string; metadata?: ModelManagerItem }> {
  return request(base, '/api/lm/checkpoints/fetch-civitai', {
    method: 'POST',
    body: JSON.stringify({ file_path: filePath }),
  });
}

export async function relinkModelCivitai(
  base: string,
  payload: { file_path: string; model_id: number; model_version_id?: number },
): Promise<{ success: boolean; message?: string }> {
  return request(base, '/api/lm/checkpoints/relink-civitai', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function refreshModelUpdates(
  base: string,
  modelIds?: number[],
): Promise<{ success: boolean; records?: LoraUpdateRecord[] }> {
  return request(base, '/api/lm/checkpoints/updates/refresh', {
    method: 'POST',
    body: JSON.stringify({
      force: true,
      ...(modelIds && modelIds.length > 0 ? { modelIds } : {}),
    }),
  });
}

export async function fetchModelCivitaiVersions(
  base: string,
  modelId: number,
): Promise<CivitaiVersion[]> {
  const res = await request<CivitaiVersion[] | { versions?: CivitaiVersion[] }>(
    base,
    `/api/lm/checkpoints/civitai/versions/${encodeURIComponent(String(modelId))}`,
  );
  if (Array.isArray(res)) return res;
  if (res && Array.isArray(res.versions)) return res.versions;
  return [];
}

export async function fetchModelCivitaiVersionById(
  base: string,
  modelVersionId: number,
): Promise<CivitaiVersion> {
  return request<CivitaiVersion>(
    base,
    `/api/lm/checkpoints/civitai/model/version/${encodeURIComponent(String(modelVersionId))}`,
  );
}
