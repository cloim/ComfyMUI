import { defaults, type Generation, type Job, type Lora } from './domain';
import { families, inferFamily, type ModelFamily } from './models';

// One image in the ComfyUI output folder, described by the app server (gallery.mjs).
export type GallerySummary = Partial<{
  positive: string;
  negative: string;
  model: string;
  modelLoader: string;
  clip1: string;
  clip2: string;
  clipType: string;
  vae: string;
  guidance: number;
  width: number;
  height: number;
  seed: number;
  steps: number;
  cfg: number;
  sampler: string;
  scheduler: string;
  denoise: number;
  loras: Lora[];
}>;
export type GalleryFile = {
  filename: string;
  subfolder: string;
  type: 'output';
  mtime: number;
  size: number;
  settings?: Partial<Generation>;
  summary?: GallerySummary;
  // No generation data in the file (made outside ComfyUI or saved without metadata).
  external?: boolean;
};
export type GalleryIndex = { available: boolean; files: GalleryFile[] };

// The app server only knows the folder of its own ComfyUI.
export const GALLERY_BASE = '/comfy';

export async function fetchGallery(): Promise<GalleryIndex | null> {
  try {
    const response = await fetch('/api/gallery', {
      cache: 'no-store',
      signal: AbortSignal.timeout(20000),
    });
    if (!response.ok) return null;
    const body = (await response.json()) as { available?: boolean; items?: GalleryFile[] };
    return { available: Boolean(body.available), files: body.items || [] };
  } catch {
    return null;
  }
}

function familyOf(summary: GallerySummary): ModelFamily {
  const byClip = families.find((f) => f.clipType === summary.clipType)?.id;
  return byClip || inferFamily(summary.model || '') || defaults.architecture;
}

const num = (value: unknown, fallback: number) =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback;
const str = (value: unknown, fallback: string) => (typeof value === 'string' ? value : fallback);

// Settings to reuse an image. App-made images carry the exact settings; others are
// rebuilt from the workflow ComfyUI saved in the PNG.
export function gallerySettings(file: GalleryFile, fallbackNegative: string): Generation {
  if (file.settings && typeof file.settings === 'object') {
    return { ...defaults, ...file.settings, workflow: null };
  }
  const s = file.summary || {};
  return {
    ...defaults,
    architecture: familyOf(s),
    modelLoader: str(s.modelLoader, defaults.modelLoader),
    model: str(s.model, ''),
    clip1: str(s.clip1, ''),
    clip2: str(s.clip2, ''),
    vae: str(s.vae, ''),
    guidance: num(s.guidance, defaults.guidance),
    positive: str(s.positive, ''),
    // Turbo graphs zero out the negative prompt, so keep the user's default instead of ''.
    negative: s.negative ? s.negative : fallbackNegative,
    loras: Array.isArray(s.loras) ? s.loras.filter((l) => typeof l?.name === 'string') : [],
    width: num(s.width, defaults.width),
    height: num(s.height, defaults.height),
    batch: 1,
    seed: num(s.seed, defaults.seed),
    random: false,
    steps: num(s.steps, defaults.steps),
    cfg: num(s.cfg, defaults.cfg),
    sampler: str(s.sampler, defaults.sampler),
    scheduler: str(s.scheduler, defaults.scheduler),
    denoise: num(s.denoise, defaults.denoise),
    workflow: null,
  };
}

export function galleryKey(file: Pick<GalleryFile, 'filename' | 'subfolder'>) {
  return file.subfolder ? `${file.subfolder}/${file.filename}` : file.filename;
}

// Gallery screens and the result view work on Job objects, so each file becomes one.
export function galleryJob(file: GalleryFile, fallbackNegative: string): Job {
  return {
    id: `file:${galleryKey(file)}@${file.mtime}`,
    createdAt: file.mtime,
    completedAt: file.mtime,
    settings: gallerySettings(file, fallbackNegative),
    base: GALLERY_BASE,
    preview: false,
    status: 'complete',
    progress: 100,
    images: [{ filename: file.filename, subfolder: file.subfolder, type: 'output', v: file.mtime }],
  };
}

export const isGalleryJob = (job: Pick<Job, 'id'>) => job.id.startsWith('file:');
