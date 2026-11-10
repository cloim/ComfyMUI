import type { Generation } from './domain';
import type { CivitaiImageMeta } from './lora-manager';

// CivitAI reports A1111/Forge sampler names; ComfyUI uses snake_case ids.
const SAMPLERS: Record<string, string> = {
  euler: 'euler',
  'euler a': 'euler_ancestral',
  heun: 'heun',
  dpm2: 'dpm_2',
  'dpm2 a': 'dpm_2_ancestral',
  'dpm++ 2s a': 'dpmpp_2s_ancestral',
  'dpm++ 2m': 'dpmpp_2m',
  'dpm++ sde': 'dpmpp_sde',
  'dpm++ 2m sde': 'dpmpp_2m_sde',
  'dpm++ 3m sde': 'dpmpp_3m_sde',
  lms: 'lms',
  ddim: 'ddim',
  unipc: 'uni_pc',
  ipndm: 'ipndm',
  lcm: 'lcm',
  deis: 'deis',
};
const SCHEDULER_SUFFIXES = ['karras', 'exponential', 'sgm uniform', 'simple', 'beta', 'normal'];

const num = (v: unknown) => (typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN);
const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
const snake = (v: string) => v.toLowerCase().replace(/[\s-]+/g, '_');

// Returns [sampler, scheduler] ids that exist on the server, or '' when unknown.
export function mapSampler(
  raw: string,
  rawScheduler: string,
  samplers: string[],
  schedulers: string[],
): [string, string] {
  let name = raw.toLowerCase().trim();
  let scheduler = snake(rawScheduler);
  for (const suffix of SCHEDULER_SUFFIXES) {
    if (name.endsWith(` ${suffix}`)) {
      name = name.slice(0, -suffix.length - 1);
      if (!scheduler) scheduler = snake(suffix);
    }
  }
  const candidates = [SAMPLERS[name], snake(name)].filter(Boolean) as string[];
  const sampler = candidates.find((c) => samplers.includes(c)) || '';
  return [sampler, schedulers.includes(scheduler) ? scheduler : ''];
}

// Applies an example image's generation data on top of the current settings.
// The model, LoRA chain and encoders stay as they are; only values that pass the
// app's own validation ranges are taken.
export function remixSettings(
  current: Generation,
  meta: CivitaiImageMeta | null | undefined,
  size: { width?: number; height?: number },
  options: { samplers: string[]; schedulers: string[] },
): { settings: Generation; applied: string[] } {
  const next: Generation = { ...current, workflow: null, upscale: null, batch: 1 };
  const applied: string[] = [];
  const prompt = str(meta?.prompt);
  if (prompt) {
    next.positive = prompt;
    applied.push('프롬프트');
  }
  const negative = str(meta?.negativePrompt);
  if (negative) {
    next.negative = negative;
    applied.push('네거티브');
  }
  const seed = num(meta?.seed);
  if (Number.isInteger(seed) && seed >= 0 && seed <= Number.MAX_SAFE_INTEGER) {
    next.seed = seed;
    next.random = false;
    applied.push('Seed');
  }
  const [w, h] = (str(meta?.Size).match(/^(\d+)\s*x\s*(\d+)$/i)?.slice(1) || [size.width, size.height]).map(num);
  const step = ['moss', 'qwen21'].includes(current.architecture) ? 32 : 16;
  const fit = (v: number) => Math.min(4096, Math.max(256, Math.round(v / step) * step));
  if (Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0) {
    next.width = fit(w);
    next.height = fit(h);
    applied.push('크기');
  }
  const steps = num(meta?.steps);
  if (Number.isInteger(steps) && steps >= 1 && steps <= 150) {
    next.steps = steps;
    applied.push('Steps');
  }
  const cfg = num(meta?.cfgScale ?? meta?.cfg);
  if (Number.isFinite(cfg) && cfg >= 0 && cfg <= 30) {
    next.cfg = cfg;
    applied.push('CFG');
  }
  const guidance = num(meta?.['Distilled CFG Scale'] ?? meta?.guidance);
  if (Number.isFinite(guidance) && guidance >= 0 && guidance <= 100) {
    next.guidance = guidance;
    applied.push('Guidance');
  }
  const [sampler, scheduler] = mapSampler(
    str(meta?.sampler),
    str(meta?.scheduler) || str(meta?.['Schedule type']),
    options.samplers,
    options.schedulers,
  );
  if (sampler) {
    next.sampler = sampler;
    applied.push('Sampler');
  }
  if (scheduler) {
    next.scheduler = scheduler;
    applied.push('Scheduler');
  }
  return { settings: next, applied };
}
