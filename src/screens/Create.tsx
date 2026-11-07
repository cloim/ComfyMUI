import { useState, useEffect } from 'react';
import {
  Box,
  SlidersHorizontal,
  Layers2,
  Plus,
  Trash2,
  WandSparkles,
  ChevronDown,
  ArrowDownUp,
  Sparkles,
  Check,
  FileJson,
  Upload,
  Download,
  RotateCcw,
  LockKeyhole,
  Images,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { useStudio } from '../studio';
import {
  options,
  parseWorkflow,
  downloadJson,
  buildWorkflow,
  type Generation,
  type Workflow,
} from '../domain';
import {
  Field,
  Picker,
  Section,
  Numeric,
  Slider,
  Modal,
  SelectControl,
  IconButton,
  Spinner,
} from '../components/ui';
import { Result } from '../components/Result';
import ModelPanel from '../components/ModelPanel';
import {
  compatibleAssets,
  selectedEntry,
  isArtifactProneSampler,
  families,
  qualityProfiles,
  checkQualityIssues,
  getOptimalQualitySettings,
  isOptimalQuality,
} from '../models';

export default function Create() {
  const { settings: s, setSettings, info, familyAssignments, notify } = useStudio();
  const [advanced, setAdvanced] = useState(false);
  const [advancedTab, setAdvancedTab] = useState('settings');
  function openAdvanced(tab = 'settings') {
    setAdvancedTab(tab);
    setAdvanced(true);
  }
  const [addLora, setAddLora] = useState(false);
  const [negative, setNegative] = useState(Boolean(s.negative));
  const patch = (v: Partial<Generation>) => setSettings((s) => ({ ...s, ...v }));
  const ratios = [
    { name: '정사각', ratio: '1:1', w: 1024, h: 1024 },
    { name: '세로', ratio: '3:4', w: 768, h: 1024 },
    { name: '가로', ratio: '4:3', w: 1024, h: 768 },
    { name: '와이드', ratio: '16:9', w: 1024, h: 576 },
  ];
  const loras = compatibleAssets(info, 'lora', s.architecture, familyAssignments);
  return (
    <div className="mx-auto flex w-full max-w-[1240px] flex-col gap-6 px-4 py-6 sm:px-7 lg:flex-row lg:gap-8 lg:px-9 lg:py-8">
      <div className="flex min-w-0 flex-1 flex-col gap-4">
        <span className="hidden self-end text-xs text-muted sm:block">
          모든 설정은 자동 저장돼요
        </span>
        {s.workflow && (
          <div className="panel border-olive/30 bg-lime/15">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <FileJson size={18} />
              가져온 워크플로 사용 중
            </div>
            <p className="mt-2 text-xs leading-relaxed text-muted">
              {Object.keys(s.workflow).length}개 노드의 입력을 그대로 실행해요
              <br />
              아래 기본 설정 대신 고급 설정의 노드 입력을 수정해 주세요
            </p>
            <button className="btn-secondary mt-4" onClick={() => openAdvanced('workflow')}>
              워크플로 편집
            </button>
          </div>
        )}
        <fieldset
          disabled={Boolean(s.workflow)}
          className="flex min-w-0 flex-col gap-4 disabled:opacity-45"
        >
          <ModelPanel />
          <Section
            title="프롬프트"
            icon={WandSparkles}
            action={<span className="font-mono text-[11px] text-muted">{s.positive.length}자</span>}
          >
            <label htmlFor="positive" className="sr-only">
              그리고 싶은 장면
            </label>
            <textarea
              id="positive"
              className="field min-h-36 resize-y leading-7"
              value={s.positive}
              onChange={(e) => patch({ positive: e.target.value })}
              placeholder="어떤 장면을 만들고 싶으세요?"
            />
            <div className="mt-3 flex flex-wrap gap-2">
              {['cinematic lighting', 'analog film', 'soft pastel'].map((tag) => (
                <button
                  key={tag}
                  className="inline-flex min-h-11 items-center justify-center gap-1 rounded-full border border-line px-3 py-2 text-[11px] text-muted transition hover:border-olive hover:text-olive"
                  onClick={() =>
                    patch({ positive: s.positive.trim() + (s.positive.trim() ? ', ' : '') + tag })
                  }
                >
                  <Plus size={11} />
                  {tag}
                </button>
              ))}
            </div>
            <button
              onClick={() => setNegative(!negative)}
              aria-expanded={negative}
              className="mt-5 flex min-h-11 w-full items-center justify-between gap-2 text-xs font-semibold text-muted"
            >
              네거티브 프롬프트
              <ChevronDown size={15} className={negative ? 'rotate-180' : ''} />
            </button>
            {negative && (
              <>
                <label htmlFor="negative" className="sr-only">
                  네거티브 프롬프트
                </label>
                <textarea
                  id="negative"
                  className="field mt-2 min-h-20 resize-y text-xs leading-6"
                  value={s.negative}
                  onChange={(e) => patch({ negative: e.target.value })}
                  placeholder="이미지에서 제외할 요소"
                />
              </>
            )}
          </Section>
          <Section
            title="LoRA"
            icon={Layers2}
            action={
              <button
                className="-my-1.5 flex min-h-8 items-center gap-1 text-xs font-semibold text-olive"
                onClick={() => setAddLora(true)}
              >
                <Plus size={14} />
                추가
              </button>
            }
          >
            {s.loras.length ? (
              <div className="flex flex-col gap-4">
                {s.loras.map((l, i) => (
                  <div key={i} className="rounded-xl bg-paper p-4">
                    <div className="mb-3 flex items-center justify-between gap-2">
                      <p className="min-w-0 truncate text-xs font-semibold">{l.name}</p>
                      <IconButton
                        icon={Trash2}
                        danger
                        className="-my-2.5 -mr-2"
                        label={`LoRA ${i + 1} 제거`}
                        onClick={() => patch({ loras: s.loras.filter((_, idx) => idx !== i) })}
                      />
                    </div>
                    {!loras.includes(l.name) && (
                      <p role="status" className="mb-3 text-xs text-red-700">
                        현재 계열과 다른 LoRA예요 | 제거하거나 계열 분류를 확인해 주세요
                      </p>
                    )}
                    <div
                      className={`grid gap-5 ${s.architecture === 'flux' ? 'grid-cols-2' : 'grid-cols-1'}`}
                    >
                      <Slider
                        label={`LoRA ${i + 1} 모델 강도`}
                        value={l.model}
                        onChange={(model) =>
                          patch({
                            loras: s.loras.map((v, idx) => (idx === i ? { ...v, model } : v)),
                          })
                        }
                      />
                      {s.architecture === 'flux' && (
                        <Slider
                          label={`LoRA ${i + 1} CLIP 강도`}
                          value={l.clip}
                          onChange={(clip) =>
                            patch({
                              loras: s.loras.map((v, idx) => (idx === i ? { ...v, clip } : v)),
                            })
                          }
                        />
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <button
                className="flex min-h-16 w-full items-center gap-4 rounded-xl border border-dashed border-line p-4 text-left"
                onClick={() => setAddLora(true)}
              >
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-stone">
                  <Plus size={18} className="text-muted" />
                </span>
                <span>
                  <span className="block text-xs font-medium">원하는 스타일을 더해 보세요</span>
                  <span className="mt-1 block text-[11px] text-muted">
                    여러 LoRA와 강도를 자유롭게 조합해요
                  </span>
                </span>
              </button>
            )}
          </Section>
          <Section title="이미지 설정" icon={SlidersHorizontal}>
            <div className="grid grid-cols-4 gap-2">
              {ratios.map((r) => (
                <button
                  key={r.name}
                  onClick={() => patch({ width: r.w, height: r.h })}
                  aria-pressed={s.width === r.w && s.height === r.h}
                  className={`flex min-h-[88px] min-w-0 flex-col items-center justify-center gap-2 rounded-xl border transition ${s.width === r.w && s.height === r.h ? 'border-olive bg-lime/25 text-olive' : 'border-line text-muted hover:bg-paper'}`}
                >
                  <span
                    className="block rounded-[3px] border-[1.5px] border-current"
                    style={{
                      width: r.w / r.h > 1 ? 23 : 18,
                      height: r.w / r.h > 1 ? (23 * r.h) / r.w : (18 * r.h) / r.w,
                    }}
                  />
                  <span className="text-[11px] font-semibold">{r.name}</span>
                  <span className="font-mono text-[10px]">{r.ratio}</span>
                </button>
              ))}
            </div>
            <div data-ui-audit-row className="mt-5 grid grid-cols-2 items-end gap-3">
              <Field label="해상도">
                <button
                  className="field flex items-center justify-between text-sm"
                  onClick={() => openAdvanced()}
                >
                  <span className="font-mono text-xs">
                    {s.width} × {s.height}
                  </span>
                  <SlidersHorizontal size={14} className="text-muted" />
                </button>
              </Field>
              <Field label="생성 수">
                <SelectControl
                  aria-label="생성 수"
                  value={s.batch}
                  onChange={(e) => patch({ batch: Number(e.target.value) })}
                >
                  {[1, 2, 3, 4, 6, 8].map((n) => (
                    <option key={n} value={n}>
                      {n}장
                    </option>
                  ))}
                </SelectControl>
              </Field>
            </div>
          </Section>
        </fieldset>
        <button
          aria-label="고급 설정"
          onClick={() => openAdvanced()}
          className="flex min-h-16 items-center justify-between gap-3 rounded-2xl border border-line bg-white px-5 py-4 text-left"
        >
          <span className="flex items-center gap-3 text-sm font-semibold">
            <SlidersHorizontal size={17} className="text-muted" />
            고급 설정
          </span>
          <span className="flex items-center gap-2 font-mono text-[11px] text-muted">
            <span className="hidden sm:inline">
              {s.steps} steps | CFG {s.cfg} | {s.sampler}
            </span>
            <ChevronDown size={16} />
          </span>
        </button>
      </div>
      <aside className="min-w-0 lg:sticky lg:top-0 lg:w-[37%] lg:self-start">
        <PreviewPanel />
      </aside>
      <Advanced open={advanced} initialTab={advancedTab} onClose={() => setAdvanced(false)} />
      <Modal title="LoRA 추가" open={addLora} onClose={() => setAddLora(false)}>
        <div className="flex flex-col gap-4">
          <p className="text-sm text-muted">모델과 같은 계열의 LoRA를 선택해 주세요</p>
          <Picker
            label="LoRA"
            value=""
            items={loras.filter((v) => !s.loras.some((l) => l.name === v))}
            onChange={(name) => {
              if (s.loras.length >= 20) {
                notify('LoRA는 최대 20개까지 추가할 수 있어요');
                return;
              }
              patch({
                loras: [
                  ...s.loras,
                  { name, model: 0.8, clip: s.architecture === 'flux' ? 0.8 : 0 },
                ],
              });
              setAddLora(false);
            }}
          />
        </div>
      </Modal>
    </div>
  );
}
function PreviewPanel() {
  const { jobs } = useStudio();
  return (
    <div className="rounded-2xl border border-line bg-white p-5">
      <Result key={jobs[0]?.id || 'sample'} job={jobs[0]} />
    </div>
  );
}
export function GenerateBar() {
  const {
    settings: s,
    generate,
    active,
    busy,
    connection,
    online,
    jobs,
    info,
    familyAssignments,
  } = useStudio();
  const entry = selectedEntry(s, info, familyAssignments);
  const unavailable = !s.workflow && (!entry || entry.family !== s.architecture);
  const result = !active && jobs[0]?.status === 'complete' ? jobs[0] : undefined;
  return (
    <div className="border-t border-line bg-paper/95 px-4 py-3 backdrop-blur-xl sm:px-7 lg:px-9">
      <div className="mx-auto flex max-w-[1240px] items-center justify-between gap-3">
        <div className="hidden sm:block">
          <p className="text-xs font-semibold">
            {s.workflow ? 'API 워크플로' : `${s.width} × ${s.height} | ${s.batch}장`}
          </p>
          <p className="mt-1 text-[11px] text-muted">
            {s.workflow
              ? '가져온 노드 입력값으로 생성'
              : s.random
                ? '매번 새로운 Seed로 생성'
                : '고정 Seed로 생성'}
          </p>
        </div>
        <div className="flex min-w-0 flex-1 justify-end gap-2">
          {result && (
            <Link
              to={`/gallery?job=${encodeURIComponent(result.id)}`}
              className="btn-secondary h-13 shrink-0 px-3"
            >
              <Images size={16} />
              <span className="whitespace-nowrap">결과 보기</span>
            </Link>
          )}
          <button
            data-testid="generate"
            disabled={busy || Boolean(active) || unavailable || (!online && !connection.preview)}
            onClick={() => void generate()}
            className="btn-primary h-13 min-w-0 flex-1 px-3 sm:max-w-[340px]"
          >
            <span className="flex items-center gap-2">
              {busy || active ? <Spinner /> : <Sparkles size={18} />}
              <span>
                {active
                  ? `${active.status === 'queued' ? '대기 중' : '생성 중'} ${active.progress}%`
                  : connection.preview
                    ? '미리보기 체험하기'
                    : '이미지 생성'}
              </span>
            </span>
            {!active && (
              <span
                className={`${result ? 'hidden sm:inline' : 'inline'} rounded-md bg-white/15 px-2 py-1 text-[11px] font-normal`}
              >
                {s.workflow ? 'API' : `${s.batch}장`}
              </span>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
function Advanced({
  open,
  onClose,
  initialTab,
}: {
  open: boolean;
  onClose: () => void;
  initialTab: string;
}) {
  const { settings: s, setSettings, info, notify } = useStudio();
  const patch = (v: Partial<Generation>) => setSettings((s) => ({ ...s, ...v }));
  const [tab, setTab] = useState('settings');
  useEffect(() => {
    if (open) setTab(initialTab);
  }, [open, initialTab]);
  const [restore, setRestore] = useState(false);
  async function load(file?: File) {
    try {
      if (!file) return;
      if (file.size > 2_000_000) throw new Error('2MB 이하 JSON 파일을 선택해 주세요');
      const w = parseWorkflow(JSON.parse(await file.text()));
      patch({ workflow: w });
      setTab('workflow');
      notify('워크플로를 가져왔어요');
    } catch (e) {
      notify((e as Error).message);
    }
  }
  return (
    <>
      <Modal
        title="고급 설정"
        open={open}
        onClose={onClose}
        footer={
          <button className="btn-primary" onClick={onClose}>
            설정 완료
          </button>
        }
      >
        <div className="flex flex-col gap-5">
          <div className="flex gap-2 rounded-xl bg-stone p-1">
            <button
              className={`flex-1 rounded-lg p-2.5 text-xs font-semibold ${tab === 'settings' ? 'bg-white shadow-sm' : ''}`}
              onClick={() => setTab('settings')}
            >
              생성 설정
            </button>
            <button
              className={`flex-1 rounded-lg p-2.5 text-xs font-semibold ${tab === 'workflow' ? 'bg-white shadow-sm' : ''}`}
              onClick={() => setTab('workflow')}
            >
              API 워크플로
            </button>
          </div>
          {tab === 'settings' ? (
            <>
              {s.workflow && (
                <p className="rounded-xl bg-stone p-3 text-xs leading-relaxed text-muted">
                  <LockKeyhole size={14} className="mr-2 inline" />
                  가져온 워크플로가 활성화되어 있어요 | API 워크플로 탭에서 실행값을 수정해 주세요
                </p>
              )}
              {(() => {
                const prof = qualityProfiles[s.architecture] || qualityProfiles.flux;
                const optimal = isOptimalQuality(s);
                const issues = checkQualityIssues(s);
                const archLabel =
                  families.find((f) => f.id === s.architecture)?.label || s.architecture;
                return (
                  <div className="flex flex-col gap-3">
                    <div className="rounded-2xl border border-olive/30 bg-lime/10 p-4">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-olive text-lime">
                            <Sparkles size={15} />
                          </span>
                          <div>
                            <p className="text-xs font-bold text-ink">
                              {archLabel} 최고 화질 공식 권장값
                            </p>
                            <p className="text-[11px] text-muted">{prof.badge}</p>
                          </div>
                        </div>
                        {optimal ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-olive/15 px-2.5 py-1 text-[11px] font-semibold text-olive">
                            <Check size={12} />
                            최고 화질 적용됨
                          </span>
                        ) : (
                          <button
                            type="button"
                            className="btn-primary min-h-8 px-3 py-1.5 text-[11px]"
                            onClick={() => {
                              patch(getOptimalQualitySettings(s.architecture));
                              notify(`${archLabel} 최고 화질 권장 설정으로 맞추었어요`);
                            }}
                          >
                            최고 화질 권장값 적용
                          </button>
                        )}
                      </div>
                      <div className="mt-3 grid grid-cols-2 gap-2 text-xs font-mono text-ink/90 sm:grid-cols-4">
                        <div className="rounded-lg bg-white/80 p-2 text-center">
                          <span className="block text-[10px] text-muted">Sampler</span>
                          <span className="font-semibold">{prof.sampler}</span>
                        </div>
                        <div className="rounded-lg bg-white/80 p-2 text-center">
                          <span className="block text-[10px] text-muted">Scheduler</span>
                          <span className="font-semibold">{prof.scheduler}</span>
                        </div>
                        <div className="rounded-lg bg-white/80 p-2 text-center">
                          <span className="block text-[10px] text-muted">Steps</span>
                          <span className="font-semibold">{prof.steps}</span>
                        </div>
                        <div className="rounded-lg bg-white/80 p-2 text-center">
                          <span className="block text-[10px] text-muted">CFG</span>
                          <span className="font-semibold">{prof.cfg}</span>
                        </div>
                      </div>
                      <p className="mt-2.5 text-[11px] leading-relaxed text-muted">
                        💡 {prof.reason}
                      </p>
                    </div>

                    {issues.map((issue) => (
                      <div
                        key={issue.id}
                        className="rounded-2xl border border-amber-300 bg-amber-50 p-4 text-xs leading-relaxed text-amber-900"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="font-bold text-amber-950">⚠️ {issue.title}</p>
                            <p className="mt-1 text-amber-900/90">{issue.message}</p>
                          </div>
                          <button
                            type="button"
                            className="shrink-0 rounded-xl bg-amber-200/80 px-3 py-2 text-[11px] font-semibold text-amber-950 transition hover:bg-amber-300 active:scale-95"
                            onClick={() => {
                              patch(issue.fix);
                              notify('화질 저하 요소를 안전하게 보정했어요');
                            }}
                          >
                            즉시 보정
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                );
              })()}
              <fieldset
                disabled={Boolean(s.workflow)}
                className="flex flex-col gap-5 disabled:opacity-40"
              >
                <div className="grid grid-cols-2 gap-3">
                  <Numeric
                    label="너비"
                    value={s.width}
                    onChange={(width) => patch({ width })}
                    min={64}
                    max={4096}
                    step={8}
                  />
                  <Numeric
                    label="높이"
                    value={s.height}
                    onChange={(height) => patch({ height })}
                    min={64}
                    max={4096}
                    step={8}
                  />
                </div>
                <button
                  className="btn-secondary self-start"
                  onClick={() => patch({ width: s.height, height: s.width })}
                >
                  <ArrowDownUp size={15} />
                  가로와 세로 바꾸기
                </button>
                <div className="grid grid-cols-2 gap-3">
                  <Numeric
                    label="Steps"
                    value={s.steps}
                    onChange={(steps) => patch({ steps })}
                    min={1}
                    max={150}
                  />
                  <Numeric
                    label="CFG"
                    value={s.cfg}
                    onChange={(cfg) => patch({ cfg })}
                    min={0}
                    max={30}
                    step={0.1}
                  />
                </div>
                {s.architecture === 'flux' && (
                  <Numeric
                    label="Flux Guidance"
                    value={s.guidance}
                    onChange={(guidance) => patch({ guidance })}
                    min={0}
                    max={100}
                    step={0.1}
                  />
                )}
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Sampler">
                    <SelectControl
                      aria-label="Sampler"
                      value={s.sampler}
                      onChange={(e) => patch({ sampler: e.target.value })}
                    >
                      {options(info, 'KSampler', 'sampler_name').map((v) => (
                        <option key={v}>{v}</option>
                      ))}
                    </SelectControl>
                  </Field>
                  <Field label="Scheduler">
                    <SelectControl
                      aria-label="Scheduler"
                      value={s.scheduler}
                      onChange={(e) => patch({ scheduler: e.target.value })}
                    >
                      {options(info, 'KSampler', 'scheduler').map((v) => (
                        <option key={v}>{v}</option>
                      ))}
                    </SelectControl>
                  </Field>
                </div>
                <Numeric
                  label="Denoise"
                  value={s.denoise}
                  onChange={(denoise) => patch({ denoise })}
                  min={0}
                  max={1}
                  step={0.05}
                />
                <div className="border-t border-line pt-5">
                  <label className="mb-4 flex min-h-8 items-center justify-between gap-3 text-sm font-medium">
                    매번 새로운 Seed
                    <input
                      type="checkbox"
                      className="h-5 w-5 accent-olive"
                      checked={s.random}
                      onChange={(e) => patch({ random: e.target.checked })}
                    />
                  </label>
                  <Numeric
                    label="Seed"
                    value={s.seed}
                    onChange={(seed) => patch({ seed })}
                    min={0}
                    max={Number.MAX_SAFE_INTEGER}
                  />
                  <p className="mt-2 text-xs text-muted">
                    새로운 Seed를 켜면 생성 시 무작위 값으로 바뀌어요
                  </p>
                </div>
              </fieldset>
            </>
          ) : (
            <>
              <p className="text-xs leading-relaxed text-muted">
                ComfyUI에서 내보낸 API 형식 JSON을 사용하세요
                <br />
                가져온 그래프는 아래 입력값 그대로 실행되며 기본 화면 설정을 적용하지 않아요
              </p>
              <div className="flex flex-wrap gap-2">
                <label className="btn-secondary cursor-pointer">
                  <Upload size={15} />
                  JSON 가져오기
                  <input
                    aria-label="워크플로 JSON 가져오기"
                    type="file"
                    accept=".json,application/json"
                    className="sr-only"
                    onChange={(e) => {
                      void load(e.target.files?.[0]);
                      e.target.value = '';
                    }}
                  />
                </label>
                <button
                  className="btn-secondary"
                  onClick={() => {
                    try {
                      downloadJson('comfymui-workflow.json', buildWorkflow(s));
                    } catch (e) {
                      notify((e as Error).message);
                    }
                  }}
                >
                  <Download size={15} />
                  내보내기
                </button>
              </div>
              {s.workflow ? (
                <>
                  <WorkflowInputs
                    workflow={s.workflow}
                    onChange={(workflow) => patch({ workflow })}
                  />
                  <button className="btn-secondary self-start" onClick={() => setRestore(true)}>
                    <RotateCcw size={15} />
                    기본 생성으로 돌아가기
                  </button>
                </>
              ) : (
                <p className="rounded-xl bg-stone p-6 text-center text-xs leading-relaxed text-muted">
                  워크플로를 가져오면 노드별 텍스트, 숫자와 선택값을 여기서 수정할 수 있어요
                </p>
              )}
            </>
          )}
        </div>
      </Modal>
      <Modal
        title="기본 생성으로 돌아갈까요?"
        open={restore}
        onClose={() => setRestore(false)}
        footer={
          <>
            <button className="btn-secondary" onClick={() => setRestore(false)}>
              계속 편집
            </button>
            <button
              className="btn-primary"
              onClick={() => {
                patch({ workflow: null });
                setRestore(false);
              }}
            >
              기본 생성 사용
            </button>
          </>
        }
      >
        <p className="text-sm leading-relaxed text-muted">
          현재 가져온 워크플로를 해제하고 기본 화면의 설정을 사용할게요
          <br />
          보관하려면 먼저 JSON으로 내보내 주세요
        </p>
      </Modal>
    </>
  );
}
function WorkflowInputs({
  workflow,
  onChange,
}: {
  workflow: Workflow;
  onChange: (w: Workflow) => void;
}) {
  const { info } = useStudio();
  function edit(id: string, key: string, value: unknown) {
    const w = structuredClone(workflow);
    w[id].inputs[key] = value;
    onChange(w);
  }
  return (
    <div className="flex flex-col gap-3">
      {Object.entries(workflow).map(([id, node]) => (
        <details key={id} className="rounded-xl border border-line p-4">
          <summary className="cursor-pointer text-xs font-semibold [overflow-wrap:anywhere]">
            {id} | {node._meta?.title || node.class_type}
          </summary>
          <div className="mt-4 flex flex-col gap-4">
            {Object.entries(node.inputs).map(([key, v]) => {
              const spec =
                info?.[node.class_type]?.input.required?.[key] ||
                info?.[node.class_type]?.input.optional?.[key];
              const label = `${id} / ${key}`;
              return (
                <Field key={key} label={key}>
                  {Array.isArray(v) ? (
                    <p className="text-xs text-muted">노드 {String(v[0])}에서 연결된 입력</p>
                  ) : Array.isArray(spec?.[0]) ? (
                    <SelectControl
                      aria-label={label}
                      value={String(v)}
                      onChange={(e) => edit(id, key, e.target.value)}
                    >
                      {spec[0].map((v) => (
                        <option key={v}>{v}</option>
                      ))}
                    </SelectControl>
                  ) : typeof v === 'boolean' ? (
                    <input
                      aria-label={label}
                      type="checkbox"
                      className="h-5 w-5 accent-olive"
                      checked={v}
                      onChange={(e) => edit(id, key, e.target.checked)}
                    />
                  ) : typeof v === 'number' ? (
                    <input
                      aria-label={label}
                      className="field"
                      type="number"
                      step={spec?.[0] === 'INT' ? 1 : 'any'}
                      value={Number.isNaN(v) ? '' : v}
                      onChange={(e) =>
                        edit(id, key, e.target.value === '' ? NaN : Number(e.target.value))
                      }
                    />
                  ) : typeof v === 'string' ? (
                    <textarea
                      aria-label={label}
                      className="field min-h-20 resize-y text-xs"
                      value={v}
                      onChange={(e) => edit(id, key, e.target.value)}
                    />
                  ) : (
                    <p className="text-xs text-muted">복합 입력은 원본 JSON에서 수정해 주세요</p>
                  )}
                </Field>
              );
            })}
          </div>
        </details>
      ))}
    </div>
  );
}
