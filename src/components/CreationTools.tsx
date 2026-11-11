import { useMemo, useState } from 'react';
import { FlaskConical, Zap } from 'lucide-react';
import { useStudioSelector } from '../studio';
import {
  buildExperiment,
  experimentLabels,
  makeDraftSettings,
  parseExperimentValues,
  type ExperimentAxis,
} from '../creation-tools';
import { Field, Modal, SelectControl, Spinner } from './ui';

export function CreationTools() {
  const { settings, generate, enqueueExperiment, busy, online, connection, notify } =
    useStudioSelector((s) => ({
      settings: s.settings,
      generate: s.generate,
      enqueueExperiment: s.enqueueExperiment,
      busy: s.busy,
      online: s.online,
      connection: s.connection,
      notify: s.notify,
    }));
  const [mode, setMode] = useState<'draft' | 'experiment' | null>(null);
  const [axis, setAxis] = useState<ExperimentAxis>('steps');
  const [values, setValues] = useState('');
  const [loraIndex, setLoraIndex] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const unsupported = Boolean(settings.workflow || settings.upscale);
  const disabled = busy || submitting || (!online && !connection.preview);
  const plan = useMemo(() => {
    if (!mode) return { jobs: [], error: '' };
    try {
      const jobs =
        mode === 'draft'
          ? [makeDraftSettings(settings)]
          : buildExperiment(settings, axis, parseExperimentValues(values), loraIndex);
      return { jobs, error: '' };
    } catch (error) {
      return { jobs: [], error: (error as Error).message };
    }
  }, [mode, settings, axis, values, loraIndex]);
  function changeAxis(next: ExperimentAxis) {
    setAxis(next);
    setValues(
      next === 'lora'
        ? '0.4, 0.7, 1'
        : next === 'cfg'
          ? '3, 4, 5'
          : settings.architecture === 'krea2'
            ? '4, 6, 8'
            : '12, 18, 24',
    );
  }
  async function run() {
    if (disabled || plan.error || !plan.jobs.length) return;
    setSubmitting(true);
    try {
      if (mode === 'draft') await generate(plan.jobs[0]);
      else await enqueueExperiment(plan.jobs);
      setMode(null);
    } catch (error) {
      notify((error as Error).message);
    } finally {
      setSubmitting(false);
    }
  }
  return (
    <>
      <div className="flex flex-col gap-2">
        <div className="grid grid-cols-2 gap-2">
          <button
            className="btn-secondary min-h-11"
            disabled={unsupported || disabled}
            onClick={() => setMode('draft')}
          >
            <Zap size={15} />
            빠른 시안
          </button>
          <button
            className="btn-secondary min-h-11"
            disabled={unsupported || disabled}
            onClick={() => {
              changeAxis('steps');
              setMode('experiment');
            }}
          >
            <FlaskConical size={15} />
            조건별 실험
          </button>
        </div>
        {unsupported && (
          <p className="text-2xs text-muted">
            시안과 조건별 실험은 기본 이미지 생성에서 사용할 수 있어요
          </p>
        )}
      </div>
      <Modal
        open={mode !== null}
        title={mode === 'experiment' ? '조건별 실험' : '빠른 시안'}
        onClose={() => {
          if (!submitting) setMode(null);
        }}
        footer={
          <>
            <button className="btn-secondary" disabled={submitting} onClick={() => setMode(null)}>
              닫기
            </button>
            <button
              className="btn-primary"
              disabled={disabled || Boolean(plan.error) || !plan.jobs.length}
              onClick={() => void run()}
            >
              {submitting && <Spinner />}
              {mode === 'draft' ? '시안 1장 생성' : `${plan.jobs.length || 0}장 실험 생성`}
            </button>
          </>
        }
      >
        <div className="flex flex-col gap-4 text-xs">
          {mode === 'draft' ? (
            <>
              <p className="leading-relaxed text-muted">
                해상도와 Steps를 줄여 구도와 분위기를 먼저 살펴봐요
                <br />
                결과에서 원래 설정으로 최종 생성할 수 있어요
              </p>
              {plan.jobs[0] && (
                <div
                  className="rounded-lg bg-stone p-3 font-mono leading-relaxed"
                  aria-label="시안 설정 미리보기"
                >
                  <p>
                    해상도 {settings.width} × {settings.height} → {plan.jobs[0].width} ×{' '}
                    {plan.jobs[0].height}
                  </p>
                  <p>
                    Steps {settings.steps} → {plan.jobs[0].steps}
                  </p>
                  <p>모델 · 프롬프트 · LoRA 유지</p>
                </div>
              )}
              <p className="text-2xs leading-relaxed text-muted">
                시안은 모델에 따라 품질이 달라요 · 최종 생성에서 해상도를 바꾸면 같은 Seed여도
                구도가 달라질 수 있어요
              </p>
            </>
          ) : (
            <>
              <p className="leading-relaxed text-muted">
                Seed와 나머지 설정을 고정하고 한 조건만 바꿔 비교해요
              </p>
              <Field label="비교할 조건">
                <SelectControl
                  aria-label="비교할 조건"
                  value={axis}
                  onChange={(e) => changeAxis(e.target.value as ExperimentAxis)}
                >
                  {Object.entries(experimentLabels).map(([key, label]) => (
                    <option
                      key={key}
                      value={key}
                      disabled={key === 'lora' && !settings.loras.length}
                    >
                      {label}
                    </option>
                  ))}
                </SelectControl>
              </Field>
              {axis === 'lora' && (
                <Field label="비교할 LoRA">
                  <SelectControl
                    aria-label="비교할 LoRA"
                    value={loraIndex}
                    onChange={(e) => setLoraIndex(Number(e.target.value))}
                  >
                    {settings.loras.map((lora, index) => (
                      <option key={index} value={index}>
                        {lora.name}
                      </option>
                    ))}
                  </SelectControl>
                </Field>
              )}
              <Field label="비교 값" hint="쉼표로 구분한 서로 다른 값 2~6개">
                <input
                  className="field"
                  aria-label="비교 값"
                  aria-invalid={Boolean(plan.error)}
                  aria-describedby={plan.error ? 'experiment-error' : undefined}
                  value={values}
                  onChange={(e) => setValues(e.target.value)}
                  placeholder="예: 12, 18, 24"
                />
              </Field>
              {plan.jobs.length > 0 && (
                <div className="rounded-lg bg-stone p-3" aria-label="실험 설정 미리보기">
                  <p className="font-semibold">
                    {plan.jobs.length}장 · 각 1장씩 서버 대기열에 등록
                  </p>
                  <p className="mt-1 font-mono text-2xs text-muted">
                    고정 Seed {plan.jobs[0].seed}
                  </p>
                  <ul className="mt-2 flex flex-col gap-1">
                    {plan.jobs.map((job) => (
                      <li key={job.experiment!.label} className="break-all">
                        {job.experiment!.label}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <p className="text-2xs leading-relaxed text-muted">
                이미지마다 GPU 작업을 실행해요 · 기록에서 같은 실험을 모아 비교하고 원하는 결과의
                설정을 재사용할 수 있어요
              </p>
            </>
          )}
          {plan.error && (
            <p
              id="experiment-error"
              role="alert"
              className="rounded-lg bg-red-50 p-3 text-xs text-red-700"
            >
              {plan.error}
            </p>
          )}
        </div>
      </Modal>
    </>
  );
}
