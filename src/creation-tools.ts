import { baseSettings, newId, randomSeed, type Generation } from './domain';

export type ExperimentAxis = 'steps' | 'cfg' | 'lora';
export const experimentLabels: Record<ExperimentAxis, string> = {
  steps: 'Steps',
  cfg: 'CFG',
  lora: 'LoRA 모델 강도',
};

const draftSteps = { flux: 12, krea2: 4, moss: 12, qwen21: 14 };

function requirePlainGeneration(base: Generation) {
  if (base.workflow || base.upscale)
    throw new Error('시안과 조건별 실험은 기본 이미지 생성에서 사용할 수 있어요');
}

// A reused result becomes an independent editable generation. Job snapshots retain
// their group and final target, while later edits cannot accidentally inherit them.
export function reusableSettings(input: Generation): Generation {
  const next = baseSettings(structuredClone(input));
  delete next.draftTarget;
  delete next.experiment;
  return next;
}

function validateTarget(target: Pick<Generation, 'width' | 'height' | 'steps'>, multiple: number) {
  if (
    ![target.width, target.height].every(
      (v) => Number.isInteger(v) && v >= 64 && v <= 4096 && v % multiple === 0,
    )
  )
    throw new Error(`원래 해상도는 64~4096 사이의 ${multiple} 배수로 입력해 주세요`);
  if (!Number.isInteger(target.steps) || target.steps < 1 || target.steps > 150)
    throw new Error('원래 Steps는 1~150 사이의 정수로 입력해 주세요');
}

export function makeDraftSettings(base: Generation): Generation {
  requirePlainGeneration(base);
  const target = base.draftTarget || { width: base.width, height: base.height, steps: base.steps };
  const multiple = ['moss', 'qwen21'].includes(base.architecture) ? 32 : 16;
  validateTarget(target, multiple);
  const scale = Math.min(1, 768 / Math.max(target.width, target.height));
  const fit = (value: number) => Math.max(64, Math.floor((value * scale) / multiple) * multiple);
  return {
    ...structuredClone(base),
    width: fit(target.width),
    height: fit(target.height),
    steps: Math.min(target.steps, draftSteps[base.architecture]),
    batch: 1,
    draftTarget: { width: target.width, height: target.height, steps: target.steps },
    experiment: undefined,
  };
}

export function makeFinalSettings(draft: Generation): Generation {
  requirePlainGeneration(draft);
  if (!draft.draftTarget) throw new Error('최종 생성할 시안의 원래 설정을 찾을 수 없어요');
  const next = structuredClone(draft);
  const { width, height, steps } = draft.draftTarget;
  // Imported presets may contain extra metadata; only restore these three settings.
  Object.assign(next, { width, height, steps, random: false, batch: 1 });
  validateTarget(next, ['moss', 'qwen21'].includes(next.architecture) ? 32 : 16);
  delete next.draftTarget;
  delete next.experiment;
  return next;
}

export function parseExperimentValues(text: string): number[] {
  const parts = text
    .trim()
    .split(/[,\s]+/)
    .filter(Boolean);
  if (parts.length < 2 || parts.length > 6)
    throw new Error('비교할 값을 쉼표로 구분해 2~6개 입력해 주세요');
  const values = parts.map(Number);
  if (!values.every(Number.isFinite)) throw new Error('비교할 값은 숫자로 입력해 주세요');
  if (new Set(values).size !== values.length) throw new Error('중복된 값을 제거해 주세요');
  return values;
}

export function buildExperiment(
  base: Generation,
  axis: ExperimentAxis,
  values: number[],
  loraIndex = 0,
): Generation[] {
  requirePlainGeneration(base);
  if (values.length < 2 || values.length > 6 || new Set(values).size !== values.length)
    throw new Error('서로 다른 비교 값을 2~6개 입력해 주세요');
  if (axis === 'lora' && !base.loras[loraIndex])
    throw new Error('비교할 LoRA를 먼저 추가해 주세요');
  const [min, max] = axis === 'steps' ? [1, 150] : axis === 'cfg' ? [0, 30] : [-2, 2];
  if (
    !values.every(
      (v) =>
        Number.isFinite(v) && v >= min && v <= max && (axis !== 'steps' || Number.isInteger(v)),
    )
  )
    throw new Error(
      `${experimentLabels[axis]} 값은 ${min}~${max}${axis === 'steps' ? ' 사이의 정수' : ' 사이'}로 입력해 주세요`,
    );
  const seed = base.random ? randomSeed() : base.seed;
  const id = newId();
  return values.map((value) => {
    const next = structuredClone(base);
    next.seed = seed;
    next.random = false;
    next.batch = 1;
    if (axis === 'lora') next.loras[loraIndex].model = value;
    else next[axis] = value;
    next.experiment = {
      id,
      label: `${axis === 'lora' ? `${base.loras[loraIndex].name.split(/[\\/]/).pop()} 모델 강도` : experimentLabels[axis]} ${value}`,
    };
    return next;
  });
}
