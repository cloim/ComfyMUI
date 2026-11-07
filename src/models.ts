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

export type QualityRecommendation = {
  sampler: string;
  scheduler: string;
  steps: number;
  cfg: number;
  guidance?: number;
  badge: string;
  reason: string;
};

export const qualityProfiles: Record<ModelFamily, QualityRecommendation> = {
  flux: {
    sampler: 'euler',
    scheduler: 'simple',
    steps: 24,
    cfg: 1.0,
    guidance: 3.5,
    badge: '정밀 12B Flow Matching',
    reason:
      'Flow Matching 아키텍처 특성상 euler 샘플러와 CFG 1.0, Guidance 3.5에서 피부 질감과 섬세한 조명 디테일이 가장 깨끗하게 표현돼요.',
  },
  krea2: {
    sampler: 'euler',
    scheduler: 'simple',
    steps: 8,
    cfg: 1.0,
    badge: '8스텝 증류 가속 모델',
    reason:
      'Krea2는 8스텝 증류 모델로, SDE 샘플러를 피하고 euler 8스텝을 사용할 때 피부 비늘 결함 없이 가장 맑고 사실적인 인물이 완성돼요.',
  },
  moss: {
    sampler: 'euler',
    scheduler: 'simple',
    steps: 24,
    cfg: 4.0,
    badge: 'MOSS Image Flow',
    reason: '프롬프트 충실도와 부드러운 피부 톤, 사실적인 심도 표현을 위한 공식 최적 균형값이에요.',
  },
  qwen21: {
    sampler: 'euler',
    scheduler: 'simple',
    steps: 28,
    cfg: 4.0,
    badge: 'Qwen VL 멀티모달 DiT',
    reason:
      'Qwen VL 인코더의 정밀한 묘사력을 극대화하여 미세 질감과 이목구비 선명도를 완벽하게 살려줘요.',
  },
};

export type QualityIssue = {
  id: string;
  title: string;
  message: string;
  fix: Partial<Generation>;
};

export function checkQualityIssues(s: Generation): QualityIssue[] {
  const issues: QualityIssue[] = [];
  const prof = qualityProfiles[s.architecture] || qualityProfiles.flux;

  if (isArtifactProneSampler(s.sampler)) {
    issues.push({
      id: 'sde-artifact',
      title: '피부 비늘 아티팩트 위험',
      message: `${families.find((f) => f.id === s.architecture)?.label || '현재'} 계열은 Flow Matching 모델로, SDE 샘플러(${s.sampler}) 사용 시 피부에 비늘 모양 노이즈 파편이 발생해요.`,
      fix: { sampler: prof.sampler, scheduler: prof.scheduler },
    });
  }

  if (s.architecture === 'krea2' && s.steps > 10) {
    issues.push({
      id: 'krea-steps',
      title: 'Krea2 스텝 수 과다 (화질 저하)',
      message: `Krea2는 8스텝 증류 가속 모델이에요. 스텝이 ${s.steps}스텝으로 너무 높으면 노이즈가 과도하게 누적되어 피부와 디테일이 얼룩지거나 왜곡될 수 있어요.`,
      fix: { steps: 8 },
    });
  }

  if (s.architecture === 'flux' && s.cfg !== 1.0) {
    issues.push({
      id: 'flux-cfg',
      title: 'Flux1.d CFG 1.0 권장',
      message: `Flux1.d 모델은 CFG 1.0 고정이 필수예요. CFG를 올리면 이미지가 타거나 채도가 깨지며, 디테일은 Guidance(3.5 권장)로 제어해야 해요.`,
      fix: { cfg: 1.0, guidance: 3.5 },
    });
  }

  if (['moss', 'qwen21'].includes(s.architecture) && (s.cfg < 2.5 || s.cfg > 6.0)) {
    issues.push({
      id: 'flow-cfg',
      title: `${families.find((f) => f.id === s.architecture)?.label} CFG 수치 점검`,
      message: `${families.find((f) => f.id === s.architecture)?.label} 모델은 프롬프트 반영도와 자연스러운 대비를 위해 CFG 3.5~4.5가 가장 이상적이에요. (현재: ${s.cfg})`,
      fix: { cfg: 4.0 },
    });
  }

  return issues;
}

export function getOptimalQualitySettings(arch: ModelFamily): Partial<Generation> {
  const p = qualityProfiles[arch] || qualityProfiles.flux;
  return {
    sampler: p.sampler,
    scheduler: p.scheduler,
    steps: p.steps,
    cfg: p.cfg,
    ...(p.guidance ? { guidance: p.guidance } : {}),
  };
}

export function isOptimalQuality(s: Generation): boolean {
  const p = qualityProfiles[s.architecture];
  if (!p) return false;
  const matchSampler = s.sampler === p.sampler;
  const matchSched = s.scheduler === p.scheduler;
  const matchSteps = s.steps === p.steps;
  const matchCfg = s.cfg === p.cfg;
  const matchGuidance = s.architecture !== 'flux' || s.guidance === p.guidance;
  return matchSampler && matchSched && matchSteps && matchCfg && matchGuidance;
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
    ...(!same || isArtifactProneSampler(s.sampler)
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
