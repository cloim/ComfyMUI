import type { Generation, ObjectInfo } from './domain';

export const families = [
  { id: 'flux', label: 'Flux1.d', clipType: 'flux', steps: 24, cfg: 1 },
  { id: 'krea2', label: 'krea2', clipType: 'krea2', steps: 8, cfg: 1 },
  { id: 'moss', label: 'moss', clipType: 'moss_image', steps: 24, cfg: 4 },
  { id: 'qwen21', label: 'qwen 2.1', clipType: 'qwen_image', steps: 28, cfg: 4 },
] as const;
export type ModelFamily = (typeof families)[number]['id'];

export const INCOMPATIBLE_SDE_SAMPLERS = [
  'dpmpp_2m_sde',
  'dpmpp_2m_sde_gpu',
  'dpmpp_3m_sde',
  'dpmpp_3m_sde_gpu',
  'dpmpp_sde',
  'dpmpp_sde_gpu',
  'dpm_fast',
];

export function isArtifactProneSampler(sampler: string): boolean {
  if (!sampler) return false;
  const s = sampler.toLowerCase();
  return (
    INCOMPATIBLE_SDE_SAMPLERS.some((bad) => s === bad || s.includes(bad)) || s.endsWith('_sde')
  );
}
export type FamilyAssignments = Record<string, ModelFamily>;
export type ModelEntry = {
  id: string;
  name: string;
  loader: string;
  family: ModelFamily;
  format: string;
};

export function inferFamily(name: string): ModelFamily | null {
  const n = name.replaceAll('\\', '/').toLowerCase();
  if (/flux[ ._-]?2|klein/.test(n)) return null;
  if (/krea[ ._-]?2/.test(n)) return 'krea2';
  if (/moss/.test(n)) return 'moss';
  if (/qwen[_ .-]?(?:image[_ .-]?)?2[._-]?1/.test(n)) return 'qwen21';
  if (/flux/.test(n)) return 'flux';
  return null;
}
export function assetFamily(
  kind: string,
  name: string,
  assignments: FamilyAssignments = {},
): ModelFamily | null {
  const assigned = assignments[kind + ':' + name];
  return families.some((f) => f.id === assigned) ? assigned : inferFamily(name);
}
export function comboOptions(info: ObjectInfo | null, node: string, field: string): string[] {
  const spec = info?.[node]?.input?.required?.[field] || info?.[node]?.input?.optional?.[field];
  const values = Array.isArray(spec?.[0]) ? spec[0] : spec?.[0] === 'COMBO' ? spec[1]?.options : [];
  return Array.isArray(values) ? values.filter((v): v is string => typeof v === 'string') : [];
}
export const modelSources = [
  { loader: 'CheckpointLoaderSimple', field: 'ckpt_name', format: '체크포인트' },
  { loader: 'UNETLoader', field: 'unet_name', format: 'Diffusion' },
  { loader: 'UnetLoaderGGUF', field: 'unet_name', format: 'GGUF' },
  { loader: 'UnetLoaderGGUFAdvanced', field: 'unet_name', format: 'GGUF' },
  { loader: 'GGUFLoaderKJ', field: 'model_name', format: 'GGUF' },
] as const;
export function catalog(
  info: ObjectInfo | null,
  assignments: FamilyAssignments = {},
): ModelEntry[] {
  const entries: ModelEntry[] = [];
  const seen = new Set<string>();
  for (const source of modelSources)
    for (const name of comboOptions(info, source.loader, source.field)) {
      const family = assetFamily('model', name, assignments);
      if (!family) continue;
      // These models require reference-image or specialized Nunchaku workflows.
      if (/nunchaku|svdq|kontext|(^|[\\/])edit([\\/])/i.test(name)) continue;
      if (family !== 'flux' && source.loader === 'CheckpointLoaderSimple') continue;
      const key = source.format + ':' + name;
      if (seen.has(key)) continue;
      seen.add(key);
      entries.push({
        id: source.loader + ':' + name,
        name,
        loader: source.loader,
        family,
        format: source.format,
      });
    }
  return entries;
}
export function compatibleAssets(
  info: ObjectInfo | null,
  kind: 'lora' | 'clip' | 'vae',
  family: ModelFamily,
  assignments: FamilyAssignments = {},
): string[] {
  const names =
    kind === 'lora'
      ? comboOptions(info, 'LoraLoaderModelOnly', 'lora_name').concat(
          comboOptions(info, 'LoraLoader', 'lora_name'),
        )
      : kind === 'vae'
        ? comboOptions(info, 'VAELoader', 'vae_name')
        : ['CLIPLoader', 'CLIPLoaderGGUF', 'DualCLIPLoader', 'DualCLIPLoaderGGUF'].flatMap(
            (node) =>
              node.startsWith('Dual')
                ? [
                    ...comboOptions(info, node, 'clip_name1'),
                    ...comboOptions(info, node, 'clip_name2'),
                  ]
                : comboOptions(info, node, 'clip_name'),
          );
  return [...new Set(names)].filter((name) => {
    const assigned = assignments[kind + ':' + name];
    if (families.some((f) => f.id === assigned)) return assigned === family;
    if (kind === 'lora') return inferFamily(name) === family;
    const n = name.replaceAll('\\', '/').toLowerCase();
    if (kind === 'clip') {
      if (family === 'flux')
        return /clip_l|t5xxl|t5[-_]/.test(n) && !/(wan|qwen|krea2|moss)/.test(n);
      if (family === 'krea2') return /qwen3[._-]?vl[_ .-]?4b/.test(n);
      if (family === 'moss') return /qwen3[._-]?5[_ .-]?9b/.test(n);
      return /qwen3[._-]?vl[_ .-]?8b/.test(n);
    }
    if (family === 'flux') return /(^|\/)ae\.[^.]+$/.test(n) && !/flux2/.test(n);
    if (family === 'krea2') return /qwen_image_vae|wan_2[._]1_vae/.test(n);
    if (family === 'moss') return /flux2.*vae/.test(n);
    return /qwen.*2[._-]?1.*vae|qwen.*vae.*2[._-]?1/.test(n);
  });
}
export function encoderLoader(s: Generation) {
  const gguf = /\.gguf$/i.test(s.clip1) || (s.architecture === 'flux' && /\.gguf$/i.test(s.clip2));
  return s.architecture === 'flux'
    ? gguf
      ? 'DualCLIPLoaderGGUF'
      : 'DualCLIPLoader'
    : gguf
      ? 'CLIPLoaderGGUF'
      : 'CLIPLoader';
}
export function selectModel(
  s: Generation,
  entry: ModelEntry,
  info: ObjectInfo | null,
  assignments: FamilyAssignments = {},
): Generation {
  const profile = families.find((f) => f.id === entry.family)!;
  const clips = compatibleAssets(info, 'clip', entry.family, assignments),
    vaes = compatibleAssets(info, 'vae', entry.family, assignments);
  const same = s.architecture === entry.family;
  return {
    ...s,
    architecture: entry.family,
    model: entry.name,
    modelLoader: entry.loader,
    loras: same
      ? s.loras.filter((l) =>
          compatibleAssets(info, 'lora', entry.family, assignments).includes(l.name),
        )
      : [],
    clip1:
      same && clips.includes(s.clip1)
        ? s.clip1
        : entry.family === 'flux'
          ? clips.find((v) => /clip_l/i.test(v)) || ''
          : clips[0] || '',
    clip2:
      entry.family === 'flux'
        ? same && clips.includes(s.clip2)
          ? s.clip2
          : clips.find((v) => /t5.*fp8/i.test(v)) || clips.find((v) => /t5/i.test(v)) || ''
        : '',
    vae:
      same && vaes.includes(s.vae)
        ? s.vae
        : entry.family === 'krea2'
          ? vaes.find((v) => /qwen_image_vae/i.test(v)) || vaes[0] || ''
          : vaes[0] || '',
    ...(!same
      ? {
          steps: profile.steps,
          cfg: profile.cfg,
          sampler: 'euler',
          scheduler: 'simple',
          denoise: 1,
        }
      : {}),
  };
}
export function selectedEntry(
  s: Generation,
  info: ObjectInfo | null,
  assignments: FamilyAssignments = {},
): ModelEntry | undefined {
  return catalog(info, assignments).find(
    (e) => e.name === s.model && e.loader === (s.modelLoader || 'CheckpointLoaderSimple'),
  );
}
export function validateSelection(
  s: Generation,
  info: ObjectInfo,
  assignments: FamilyAssignments = {},
) {
  if (s.workflow) return;
  const entry = selectedEntry(s, info, assignments);
  if (!entry) throw new Error('지원하는 네 계열에서 모델을 선택해 주세요');
  if (entry.family !== s.architecture)
    throw new Error('모델 계열을 확인하고 모델을 다시 선택해 주세요');
  for (const l of s.loras)
    if (!compatibleAssets(info, 'lora', s.architecture, assignments).includes(l.name))
      throw new Error('선택한 계열에 맞는 LoRA를 다시 선택해 주세요');
  const clips = compatibleAssets(info, 'clip', s.architecture, assignments),
    vaes = compatibleAssets(info, 'vae', s.architecture, assignments);
  if (
    !clips.includes(s.clip1) ||
    (s.architecture === 'flux' && !clips.includes(s.clip2)) ||
    !vaes.includes(s.vae)
  )
    throw new Error('선택한 계열의 텍스트 인코더와 VAE 설치를 확인해 주세요');
}
