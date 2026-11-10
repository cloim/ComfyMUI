import { useEffect, useState } from 'react';
import { Maximize2 } from 'lucide-react';
import { useStudio } from '../studio';
import {
  options,
  baseSettings,
  upscaleSize,
  UPSCALE_REFINES,
  UPSCALE_SCALES,
  type Job,
} from '../domain';
import { Field, Modal, SelectControl } from './ui';

const STORAGE_KEY = 'cm-upscale';
type Choice = { model: string; scale: number; refine: number };
function readChoice(): Partial<Choice> {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
  } catch {
    return {};
  }
}
function saveChoice(choice: Choice) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(choice));
  } catch {
    // The last choice is a convenience only.
  }
}

export function UpscaleDialog({
  job,
  open,
  onClose,
}: {
  job: Job;
  open: boolean;
  onClose: () => void;
}) {
  const { info, generateUpscale } = useStudio();
  const models = options(info, 'UpscaleModelLoader', 'model_name');
  const base = baseSettings(job.settings);
  const fits = (scale: number) => base.width * scale <= 4096 && base.height * scale <= 4096;
  const [choice, setChoice] = useState<Choice>({ model: '', scale: 2, refine: 0.2 });
  const [imageIndex, setImageIndex] = useState(0);
  useEffect(() => {
    if (!open) return;
    const saved = readChoice();
    const scale = UPSCALE_SCALES.includes(saved.scale!) && fits(saved.scale!) ? saved.scale! : 2;
    setChoice({
      model: models.includes(saved.model || '') ? saved.model! : models[0] || '',
      scale: fits(scale) ? scale : 1.5,
      refine: UPSCALE_REFINES.some((r) => r.value === saved.refine) ? saved.refine! : 0.2,
    });
    setImageIndex(0);
    // Re-read the stored choice each time the dialog opens.
  }, [open]);
  const target = upscaleSize(base.width, base.height, choice.scale);
  const refine = UPSCALE_REFINES.find((r) => r.value === choice.refine) || UPSCALE_REFINES[0];
  function start() {
    saveChoice(choice);
    const picked = { ...job, images: [job.images[imageIndex] || job.images[0]] };
    generateUpscale(picked, choice.model, choice.scale, choice.refine);
    onClose();
  }
  return (
    <Modal
      title="업스케일"
      open={open}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn-secondary" onClick={onClose}>
            취소
          </button>
          <button type="button" className="btn-primary" disabled={!choice.model} onClick={start}>
            <Maximize2 size={14} />
            업스케일 시작
          </button>
        </>
      }
    >
      <div className="flex flex-col gap-3.5">
        <p className="text-xs leading-relaxed text-muted">
          생성한 이미지를 업스케일 모델로 확대해요. 디테일 보정을 켜면 같은 모델과 프롬프트로 낮은
          강도로 한 번 더 그려서 질감을 살려요.
        </p>
        {job.images.length > 1 && (
          <Field label="대상 이미지">
            <SelectControl
              aria-label="대상 이미지"
              value={imageIndex}
              onChange={(e) => setImageIndex(Number(e.target.value))}
            >
              {job.images.map((im, i) => (
                <option key={`${im.filename}-${i}`} value={i}>
                  이미지 {i + 1}
                </option>
              ))}
            </SelectControl>
          </Field>
        )}
        <Field label="업스케일 모델">
          {models.length ? (
            <SelectControl
              aria-label="업스케일 모델"
              value={choice.model}
              onChange={(e) => setChoice((c) => ({ ...c, model: e.target.value }))}
            >
              {models.map((m) => (
                <option key={m}>{m}</option>
              ))}
            </SelectControl>
          ) : (
            <p className="rounded-lg bg-paper p-3 text-xs leading-relaxed text-muted">
              설치된 업스케일 모델이 없어요. ComfyUI의 <code>models/upscale_models</code> 폴더에
              모델(예: 4x-UltraSharp)을 넣고 설치 목록을 새로고침해 주세요.
            </p>
          )}
        </Field>
        <Field label="배율">
          <div role="radiogroup" aria-label="배율" className="grid grid-cols-4 gap-1.5">
            {UPSCALE_SCALES.map((scale) => (
              <button
                key={scale}
                type="button"
                role="radio"
                aria-checked={choice.scale === scale}
                disabled={!fits(scale)}
                onClick={() => setChoice((c) => ({ ...c, scale }))}
                className={`min-h-9 rounded-lg border text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-40 ${choice.scale === scale ? 'border-ink bg-ink text-lime' : 'border-line bg-paper text-ink hover:bg-stone'}`}
              >
                {scale}x
              </button>
            ))}
          </div>
        </Field>
        <Field label="디테일 보정">
          <div role="radiogroup" aria-label="디테일 보정" className="grid grid-cols-4 gap-1.5">
            {UPSCALE_REFINES.map((r) => (
              <button
                key={r.value}
                type="button"
                role="radio"
                aria-checked={choice.refine === r.value}
                onClick={() => setChoice((c) => ({ ...c, refine: r.value }))}
                className={`min-h-9 rounded-lg border text-xs font-semibold ${choice.refine === r.value ? 'border-ink bg-ink text-lime' : 'border-line bg-paper text-ink hover:bg-stone'}`}
              >
                {r.label}
              </button>
            ))}
          </div>
          <p className="text-2xs leading-relaxed text-muted">
            {refine.hint}
            {refine.value > 0 && ' | 해상도가 클수록 보정 시간이 오래 걸려요'}
          </p>
        </Field>
        <div className="flex items-center justify-between rounded-lg bg-stone px-3 py-2.5 font-mono text-xs">
          <span className="text-muted">
            {base.width} × {base.height}
          </span>
          <span className="font-semibold text-ink">
            → {target.width} × {target.height}
          </span>
        </div>
      </div>
    </Modal>
  );
}
