import { useState, useEffect, useLayoutEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import {
  Box,
  SlidersHorizontal,
  Layers2,
  Plus,
  Trash2,
  WandSparkles,
  ChevronDown,
  ArrowLeftRight,
  Sparkles,
  Check,
  FileJson,
  Upload,
  Download,
  RotateCcw,
  LockKeyhole,
  ListOrdered,
  ArrowUp,
  ArrowDown,
} from 'lucide-react';
import { useStudio } from '../studio';
import {
  hasPromptAttribute,
  togglePromptAttribute,
  options,
  parseWorkflow,
  downloadJson,
  buildWorkflow,
  type Generation,
  type PromptAssembleElement,
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
  modifiedField,
} from '../components/ui';
import { Result } from '../components/Result';
import { PromptHelper } from '../components/PromptHelper';
import ModelPanel from '../components/ModelPanel';
import {
  compatibleAssets,
  selectedEntry,
  isArtifactProneSampler,
  families,
  qualityProfiles,
} from '../models';

export default function Create() {
  const {
    settings: s,
    setSettings,
    promptAssemble,
    selectedAssembleId,
    setSelectedAssembleId,
    info,
    familyAssignments,
    notify,
    jobs,
  } = useStudio();
  const promptTextareaRef = useRef<HTMLTextAreaElement>(null);
  const [advanced, setAdvanced] = useState(false);
  const [advancedTab, setAdvancedTab] = useState('settings');
  function openAdvanced(tab = 'settings') {
    setAdvancedTab(tab);
    setAdvanced(true);
  }
  const [addLora, setAddLora] = useState(false);
  const [negative, setNegative] = useState(false);
  const patch = (v: Partial<Generation>) => setSettings((s) => ({ ...s, ...v }));
  // The batch size control was removed; multiple images come from the 연속 queue instead.
  useEffect(() => {
    if (s.batch !== 1) patch({ batch: 1 });
  }, [s.batch]);
  const ratios = [
    { name: '정사각', ratio: '1:1', w: 1024, h: 1024 },
    { name: '세로', ratio: '3:4', w: 768, h: 1024 },
    { name: '가로', ratio: '4:3', w: 1024, h: 768 },
    { name: '와이드', ratio: '16:9', w: 1024, h: 576 },
  ];
  const currentRatio = ratios.find((r) => r.w === s.width && r.h === s.height);
  const ratioValue = currentRatio ? `${currentRatio.w}x${currentRatio.h}` : 'custom';
  const loras = compatibleAssets(info, 'lora', s.architecture, familyAssignments);
  return (
    <div className="mx-auto flex w-full max-w-[1240px] flex-col gap-4 px-4 py-4 sm:px-5 lg:flex-row lg:gap-5 lg:px-6 lg:py-5">
      <div className="flex min-w-0 flex-1 flex-col gap-3.5">
        {s.workflow && (
          <div className="panel border-olive/30 bg-lime/15">
            <div className="flex items-center gap-2 text-xs font-semibold">
              <FileJson size={16} />
              가져온 워크플로 사용 중
            </div>
            <p className="mt-1.5 text-xs leading-relaxed text-muted">
              {Object.keys(s.workflow).length}개 노드의 입력을 그대로 실행해요
              <br />
              아래 기본 설정 대신 고급 설정의 노드 입력을 수정해 주세요
            </p>
            <button className="btn-secondary mt-3" onClick={() => openAdvanced('workflow')}>
              워크플로 편집
            </button>
          </div>
        )}
        <fieldset
          disabled={Boolean(s.workflow)}
          className="flex min-w-0 flex-col gap-3.5 disabled:opacity-45"
        >
          <ModelPanel />
          <Section
            title="프롬프트"
            icon={WandSparkles}
            action={<span className="font-mono text-2xs text-muted">{s.positive.length}자</span>}
          >
            <PromptAssembleBar
              elements={promptAssemble}
              selectedId={selectedAssembleId}
              onSelectId={setSelectedAssembleId}
              positive={s.positive}
              onToggleAttribute={(attr) =>
                patch({ positive: togglePromptAttribute(s.positive, attr) })
              }
            />
            <label htmlFor="positive" className="sr-only">
              그리고 싶은 장면
            </label>
            <textarea
              ref={promptTextareaRef}
              id="positive"
              className="field min-h-24 resize-y leading-relaxed"
              value={s.positive}
              onChange={(e) => patch({ positive: e.target.value })}
              placeholder="어떤 장면을 만들고 싶으세요?"
            />
            <PromptHelper
              value={s.positive}
              onChange={(val) => patch({ positive: val })}
              jobs={jobs}
              textareaRef={promptTextareaRef}
            />
            <button
              onClick={() => setNegative(!negative)}
              aria-expanded={negative}
              className="mt-3 flex min-h-8 w-full items-center justify-between gap-2 text-xs font-semibold text-muted"
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
                  className="field mt-1.5 min-h-16 resize-y text-xs leading-relaxed"
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
              <div className="-my-1 flex items-center gap-2">
                <button
                  className="flex min-h-7 items-center gap-1 text-xs font-semibold text-olive"
                  onClick={() => setAddLora(true)}
                >
                  <Plus size={14} />
                  추가
                </button>
              </div>
            }
          >
            {s.loras.length ? (
              <div className="flex flex-col gap-2.5">
                {s.loras.map((l, i) => (
                  <div key={i} className="rounded-lg bg-paper p-3">
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <p className="min-w-0 truncate text-xs font-semibold">{l.name}</p>
                      <IconButton
                        icon={Trash2}
                        danger
                        className="-my-1.5 -mr-1"
                        label={`LoRA ${i + 1} 제거`}
                        onClick={() => patch({ loras: s.loras.filter((_, idx) => idx !== i) })}
                      />
                    </div>
                    {!loras.includes(l.name) && (
                      <p role="status" className="mb-2 text-xs text-red-700">
                        현재 계열과 다른 LoRA예요 | 제거하거나 계열 분류를 확인해 주세요
                      </p>
                    )}
                    <div
                      className={`grid gap-3 ${s.architecture === 'flux' ? 'grid-cols-2' : 'grid-cols-1'}`}
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
                className="flex min-h-12 w-full items-center gap-3 rounded-lg border border-dashed border-line p-3 text-left"
                onClick={() => setAddLora(true)}
              >
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-stone">
                  <Plus size={16} className="text-muted" />
                </span>
                <span>
                  <span className="block text-xs font-medium">원하는 스타일을 더해 보세요</span>
                  <span className="mt-0.5 block text-2xs text-muted">
                    여러 LoRA와 강도를 자유롭게 조합해요
                  </span>
                </span>
              </button>
            )}
          </Section>
          <Section title="이미지 설정" icon={SlidersHorizontal}>
            <div className="grid grid-cols-1 items-end gap-2.5 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
              <Field label="비율">
                <SelectControl
                  aria-label="비율"
                  value={ratioValue}
                  onChange={(e) => {
                    const found = ratios.find((r) => `${r.w}x${r.h}` === e.target.value);
                    if (found) patch({ width: found.w, height: found.h });
                  }}
                >
                  {ratios.map((r) => (
                    <option key={r.ratio} value={`${r.w}x${r.h}`}>
                      {r.name} ({r.ratio})
                    </option>
                  ))}
                  {!currentRatio && (
                    <option value="custom" disabled>
                      직접 설정
                    </option>
                  )}
                </SelectControl>
              </Field>
              <div
                data-ui-audit-row
                className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-end gap-1.5"
              >
                <Numeric
                  label="너비"
                  value={s.width}
                  onChange={(width) => patch({ width })}
                  min={64}
                  max={4096}
                  step={8}
                />
                <IconButton
                  icon={ArrowLeftRight}
                  label="가로와 세로 바꾸기"
                  className="h-9 w-9"
                  onClick={() => patch({ width: s.height, height: s.width })}
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
            </div>
          </Section>
        </fieldset>
        <button
          aria-label="고급 설정"
          onClick={() => openAdvanced()}
          className="flex min-h-11 items-center justify-between gap-2.5 rounded-xl border border-line bg-white px-3.5 py-2.5 sm:px-4 text-left"
        >
          <span className="flex items-center gap-2 text-sm font-bold">
            <SlidersHorizontal size={15} className="text-muted" />
            고급 설정
          </span>
          <span className="flex items-center gap-2 font-mono text-2xs text-muted">
            <span className="hidden sm:inline">
              {s.steps} steps | CFG {s.cfg} | {s.sampler}
            </span>
            <ChevronDown size={15} />
          </span>
        </button>
      </div>
      <aside className="min-w-0 lg:sticky lg:top-0 lg:w-[37%] lg:self-start">
        <PreviewPanel />
      </aside>
      <Advanced open={advanced} initialTab={advancedTab} onClose={() => setAdvanced(false)} />
      <Modal title="LoRA 추가" open={addLora} onClose={() => setAddLora(false)}>
        <div className="flex flex-col gap-3">
          <p className="text-xs text-muted">모델과 같은 계열의 LoRA를 선택해 주세요</p>
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
function PromptAssembleBar({
  elements,
  selectedId,
  onSelectId,
  positive,
  onToggleAttribute,
}: {
  elements: PromptAssembleElement[];
  selectedId: string;
  onSelectId: (id: string) => void;
  positive: string;
  onToggleAttribute: (attr: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [menuStyle, setMenuStyle] = useState<{ left: number; top: number; width: number }>({
    left: 16,
    top: 16,
    width: 200,
  });

  const currentElement = elements.find((el) => el.id === selectedId) || elements[0];
  const activeAttrs = currentElement
    ? currentElement.attributes.filter((attr) => hasPromptAttribute(positive, attr))
    : [];

  useLayoutEffect(() => {
    if (!open) return;
    const syncPosition = () => {
      const rect = triggerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const width = Math.max(180, Math.min(rect.width, window.innerWidth - 24));
      const left = Math.max(12, Math.min(window.innerWidth - width - 12, rect.left));
      const estimatedHeight = Math.min(240, (currentElement?.attributes.length || 1) * 34 + 12);
      const top =
        rect.bottom + estimatedHeight + 12 > window.innerHeight && rect.top > estimatedHeight + 12
          ? rect.top - estimatedHeight - 6
          : rect.bottom + 6;
      setMenuStyle({ left, top, width });
    };
    syncPosition();
    window.addEventListener('resize', syncPosition);
    window.addEventListener('scroll', syncPosition, true);
    return () => {
      window.removeEventListener('resize', syncPosition);
      window.removeEventListener('scroll', syncPosition, true);
    };
  }, [open, currentElement]);

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (e: PointerEvent) => {
      const target = e.target as Node | null;
      if (triggerRef.current?.contains(target) || menuRef.current?.contains(target)) {
        return;
      }
      setOpen(false);
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  return (
    <div className="mb-2.5 flex flex-col gap-1.5">
      <div data-ui-audit-row className="grid grid-cols-2 items-center gap-2">
        <SelectControl
          aria-label="프롬프트 요소"
          value={currentElement?.id || ''}
          disabled={!elements.length}
          onChange={(e) => {
            onSelectId(e.target.value);
            setOpen(false);
          }}
        >
          {elements.length ? (
            elements.map((el) => (
              <option key={el.id} value={el.id}>
                {el.name}
              </option>
            ))
          ) : (
            <option value="">요소 없음</option>
          )}
        </SelectControl>
        <div className="relative min-w-0">
          <button
            ref={triggerRef}
            type="button"
            aria-label="프롬프트 속성"
            aria-haspopup="listbox"
            aria-expanded={open}
            disabled={!currentElement || currentElement.attributes.length === 0}
            onClick={() => setOpen((v) => !v)}
            className="field flex items-center justify-between gap-2 pr-8 text-left disabled:opacity-50"
          >
            <span className="min-w-0 truncate">
              {activeAttrs.length > 0 ? activeAttrs.join(', ') : '속성 선택'}
            </span>
            {activeAttrs.length > 0 && (
              <span className="shrink-0 rounded-full bg-olive/15 px-1.5 py-0.5 text-2xs font-bold text-olive">
                {activeAttrs.length}
              </span>
            )}
          </button>
          <ChevronDown
            className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-muted"
            size={15}
            aria-hidden="true"
          />
        </div>
      </div>
      {open &&
        currentElement &&
        createPortal(
          <div
            ref={menuRef}
            role="listbox"
            aria-multiselectable="true"
            aria-label={`${currentElement.name} 속성 목록`}
            data-ui-audit-overlay
            style={menuStyle}
            className="fixed z-[2100] flex max-h-60 flex-col gap-0.5 overflow-y-auto rounded-lg border border-line bg-white p-1 shadow-xl"
          >
            {currentElement.attributes.map((attr) => {
              const active = hasPromptAttribute(positive, attr);
              return (
                <button
                  key={attr}
                  type="button"
                  role="option"
                  aria-selected={active}
                  onClick={() => onToggleAttribute(attr)}
                  className={`flex min-h-8 w-full items-center justify-between gap-2 rounded-md px-2.5 py-1.5 text-left text-xs font-medium transition ${
                    active ? 'bg-lime/25 font-semibold text-olive' : 'text-ink hover:bg-paper'
                  }`}
                >
                  <span className="min-w-0 truncate">{attr}</span>
                  <span
                    className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                      active ? 'border-olive bg-olive text-white' : 'border-line bg-white'
                    }`}
                  >
                    {active && <Check size={11} />}
                  </span>
                </button>
              );
            })}
          </div>,
          document.body,
        )}
    </div>
  );
}
function PreviewPanel() {
  const { jobs } = useStudio();
  const lastComplete = jobs.find((j) => j.status === 'complete' && j.images.length > 0);
  return (
    <div className="rounded-xl border border-line bg-white p-3.5 sm:p-4">
      <Result key={jobs[0]?.id || 'sample'} job={jobs[0]} fallback={lastComplete} />
    </div>
  );
}
const RUN_LIMIT = 20;
const clampRuns = (n: number) =>
  Number.isFinite(n) ? Math.min(RUN_LIMIT, Math.max(1, Math.round(n))) : 1;
// Image count and generate button, shown in the top bar of the create screen.
export function GenerateControls() {
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
    clientQueue,
    removeFromQueue,
    moveQueueItem,
    clearQueue,
    enqueueBatch,
  } = useStudio();
  const [showQueue, setShowQueue] = useState(false);
  // How many times to run. 1 is a single generation; more queue runs with new Seeds.
  const [countText, setCountText] = useState('1');
  const count = clampRuns(Number(countText));
  const entry = selectedEntry(s, info, familyAssignments);
  const unavailable = !s.workflow && (!entry || entry.family !== s.architecture);
  const disabled = busy || unavailable || (!online && !connection.preview);
  function run() {
    if (disabled) return;
    if (count > 1) enqueueBatch(count);
    else void generate();
  }
  return (
    <>
      <div className="flex min-w-0 items-center gap-1.5">
            {clientQueue.length > 0 && (
              <button
                className="btn-secondary relative flex shrink-0 items-center gap-1.5 px-2.5"
                onClick={() => setShowQueue(true)}
                aria-label="기기 내 대기열 보기"
              >
                <ListOrdered size={15} />
                <span className="hidden sm:inline">대기열</span>
                <span className="rounded-full bg-olive px-1.5 py-0.5 text-2xs font-bold text-white">
                  {clientQueue.length}
                </span>
              </button>
            )}
            <label
              className="relative w-[60px] shrink-0 sm:w-[68px]"
              title={`장 수 | 2장 이상이면 Seed를 바꿔 ${RUN_LIMIT}장까지 이어서 생성`}
            >
              <input
                type="number"
                inputMode="numeric"
                min={1}
                max={RUN_LIMIT}
                step={1}
                aria-label="장 수"
                value={countText}
                onChange={(e) => setCountText(e.target.value)}
                onBlur={() => setCountText(String(count))}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') run();
                }}
                className="field pr-6 text-center font-mono [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
              />
              <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-2xs text-muted">
                장
              </span>
            </label>
            <button
              data-testid="generate"
              disabled={disabled}
              onClick={run}
              className="btn-primary shrink-0 whitespace-nowrap px-3"
            >
              <span className="flex items-center gap-1.5">
                {busy ? <Spinner /> : <Sparkles size={15} />}
                <span className="sm:hidden">
                  {active ? '추가' : connection.preview ? '체험' : '생성'}
                </span>
                <span className="hidden sm:inline">
                  {active
                    ? '대기열에 추가'
                    : connection.preview
                      ? '미리보기 체험하기'
                      : '이미지 생성'}
                </span>
              </span>
              <span className="hidden rounded bg-white/15 px-1.5 py-0.5 text-2xs font-normal sm:inline">
                {active
                  ? `${active.status === 'queued' ? '대기 중' : '생성 중'} ${active.progress}%`
                  : s.workflow
                    ? 'API'
                    : `${count}장`}
              </span>
            </button>
      </div>

      <Modal
        title={`기기 내 대기열 (${clientQueue.length}개)`}
        open={showQueue}
        onClose={() => setShowQueue(false)}
        footer={
          <>
            {clientQueue.length > 0 && (
              <button
                className="btn-secondary text-red-700"
                onClick={() => {
                  clearQueue();
                  setShowQueue(false);
                }}
              >
                <Trash2 size={14} />
                대기열 비우기
              </button>
            )}
            <button className="btn-primary" onClick={() => setShowQueue(false)}>
              닫기
            </button>
          </>
        }
      >
        {clientQueue.length === 0 ? (
          <p className="p-4 text-center text-xs text-muted">대기 중인 작업이 없어요</p>
        ) : (
          <div className="flex flex-col gap-2.5">
            <p className="text-xs text-muted">
              앞선 생성이 완료되면 순서대로 서버에 자동 전송돼요.
            </p>
            <div className="flex max-h-[360px] flex-col gap-1.5 overflow-y-auto pr-1">
              {clientQueue.map((item, index) => (
                <div
                  key={item.id}
                  className="flex items-center justify-between gap-2.5 rounded-lg border border-line bg-paper p-2.5 text-xs"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold text-ink">
                      {item.settings.workflow
                        ? 'API 워크플로'
                        : item.settings.positive || '(프롬프트 없음)'}
                    </p>
                    <p className="mt-0.5 text-2xs text-muted">
                      {item.settings.model} | Seed {item.settings.seed}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-0.5">
                    <IconButton
                      icon={ArrowUp}
                      disabled={index === 0}
                      onClick={() => moveQueueItem(index, index - 1)}
                      label="위로 이동"
                    />
                    <IconButton
                      icon={ArrowDown}
                      disabled={index === clientQueue.length - 1}
                      onClick={() => moveQueueItem(index, index + 1)}
                      label="아래로 이동"
                    />
                    <IconButton
                      icon={Trash2}
                      danger
                      onClick={() => removeFromQueue(item.id)}
                      label="대기열에서 삭제"
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </Modal>

    </>
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
  const prof = qualityProfiles[s.architecture] || qualityProfiles.flux;
  const archLabel = families.find((f) => f.id === s.architecture)?.label || s.architecture;
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
        <div className="flex flex-col gap-3.5">
          <div className="flex gap-1.5 rounded-lg bg-stone p-1">
            <button
              className={`flex-1 rounded-md px-2.5 py-1.5 text-xs font-semibold ${tab === 'settings' ? 'bg-white shadow-sm' : ''}`}
              onClick={() => setTab('settings')}
            >
              생성 설정
            </button>
            <button
              className={`flex-1 rounded-md px-2.5 py-1.5 text-xs font-semibold ${tab === 'workflow' ? 'bg-white shadow-sm' : ''}`}
              onClick={() => setTab('workflow')}
            >
              API 워크플로
            </button>
          </div>
          {tab === 'settings' ? (
            <>
              {s.workflow && (
                <p className="rounded-lg bg-stone p-2.5 text-xs leading-relaxed text-muted">
                  <LockKeyhole size={14} className="mr-1.5 inline" />
                  가져온 워크플로가 활성화되어 있어요 | API 워크플로 탭에서 실행값을 수정해 주세요
                </p>
              )}
              <fieldset
                disabled={Boolean(s.workflow)}
                className="flex flex-col gap-3.5 disabled:opacity-40"
              >
                <div className="grid grid-cols-2 gap-2.5">
                  <Numeric
                    label="Steps"
                    value={s.steps}
                    onChange={(steps) => patch({ steps })}
                    min={1}
                    max={150}
                    help={
                      <>
                        이미지의 노이즈를 걷어내는 반복 횟수예요. 높일수록 디테일이 늘지만 생성
                        시간도 비례해서 길어져요.
                        {s.architecture === 'krea2' &&
                          ' 증류 모델이라 스텝을 높이면 오히려 얼룩이 생길 수 있어요.'}
                        <br />
                        <b>{archLabel} 권장</b> {prof.steps}
                      </>
                    }
                    recommend={{
                      modified: s.steps !== prof.steps,
                      value: String(prof.steps),
                      onReset: () => patch({ steps: prof.steps }),
                    }}
                  />
                  <Numeric
                    label="CFG"
                    value={s.cfg}
                    onChange={(cfg) => patch({ cfg })}
                    min={0}
                    max={30}
                    step={0.1}
                    help={
                      <>
                        프롬프트를 얼마나 강하게 따를지 정해요. 너무 높으면 색이 타거나 대비가
                        과해져요.
                        {s.architecture === 'flux' &&
                          ' Flux1.d는 1.0으로 두고 디테일은 Flux Guidance로 조절해요.'}
                        <br />
                        <b>{archLabel} 권장</b> {prof.cfg}
                      </>
                    }
                    recommend={{
                      modified: s.cfg !== prof.cfg,
                      value: String(prof.cfg),
                      onReset: () => patch({ cfg: prof.cfg }),
                    }}
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
                    help={
                      <>
                        Flux 전용 가이던스로, CFG 대신 프롬프트 반영 강도를 조절해요. 높이면 대비와
                        채도가 강해지고 낮추면 부드럽고 자연스러워져요.
                        <br />
                        <b>{archLabel} 권장</b> {prof.guidance}
                      </>
                    }
                    recommend={
                      prof.guidance === undefined
                        ? undefined
                        : {
                            modified: s.guidance !== prof.guidance,
                            value: String(prof.guidance),
                            onReset: () => patch({ guidance: prof.guidance }),
                          }
                    }
                  />
                )}
                <div className="grid grid-cols-2 gap-2.5">
                  <Field
                    label="Sampler"
                    help={
                      <>
                        노이즈를 걷어내는 계산 방식이에요. 같은 Seed라도 Sampler에 따라 질감과
                        선명도가 달라져요. SDE 계열은 Flow Matching 모델에서 피부에 비늘 모양
                        노이즈를 만들 수 있어요.
                        <br />
                        <b>{archLabel} 권장</b> {prof.sampler}
                      </>
                    }
                    recommend={{
                      modified: s.sampler !== prof.sampler,
                      value: prof.sampler,
                      onReset: () => patch({ sampler: prof.sampler }),
                    }}
                  >
                    <SelectControl
                      aria-label="Sampler"
                      value={s.sampler}
                      className={s.sampler !== prof.sampler ? modifiedField : ''}
                      onChange={(e) => patch({ sampler: e.target.value })}
                    >
                      {options(info, 'KSampler', 'sampler_name').map((v) => (
                        <option key={v}>{v}</option>
                      ))}
                    </SelectControl>
                  </Field>
                  <Field
                    label="Scheduler"
                    help={
                      <>
                        스텝마다 노이즈를 얼마나 줄일지 정하는 곡선이에요. 초반 구도와 후반 디테일에
                        쓰는 비중이 달라져요.
                        <br />
                        <b>{archLabel} 권장</b> {prof.scheduler}
                      </>
                    }
                    recommend={{
                      modified: s.scheduler !== prof.scheduler,
                      value: prof.scheduler,
                      onReset: () => patch({ scheduler: prof.scheduler }),
                    }}
                  >
                    <SelectControl
                      aria-label="Scheduler"
                      value={s.scheduler}
                      className={s.scheduler !== prof.scheduler ? modifiedField : ''}
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
                  help={
                    <>
                      시작 노이즈를 얼마나 지울지 정해요. 빈 화면에서 새로 그리는 이 화면에서는
                      1.0을 유지하고, 낮추면 덜 그려진 흐릿한 이미지가 나와요.
                    </>
                  }
                />
                <div className="border-t border-line pt-3.5">
                  <label className="mb-3 flex min-h-7 items-center justify-between gap-2.5 text-xs font-medium">
                    매번 새로운 Seed
                    <input
                      type="checkbox"
                      className="h-4 w-4 accent-olive"
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
                    help={
                      <>
                        시작 노이즈를 만드는 번호예요. 같은 Seed와 같은 설정이면 같은 이미지가
                        나와서, 마음에 든 결과를 다시 만들거나 일부 설정만 바꿔 비교할 때 써요.
                      </>
                    }
                  />
                  <p className="mt-1.5 text-2xs text-muted">
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
                  <Upload size={14} />
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
                  <Download size={14} />
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
                    <RotateCcw size={14} />
                    기본 생성으로 돌아가기
                  </button>
                </>
              ) : (
                <p className="rounded-lg bg-stone p-4 text-center text-xs leading-relaxed text-muted">
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
        <p className="text-xs leading-relaxed text-muted">
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
    <div className="flex flex-col gap-2.5">
      {Object.entries(workflow).map(([id, node]) => (
        <details key={id} className="rounded-lg border border-line p-3">
          <summary className="cursor-pointer text-xs font-semibold [overflow-wrap:anywhere]">
            {id} | {node._meta?.title || node.class_type}
          </summary>
          <div className="mt-3 flex flex-col gap-3">
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
                      className="h-4 w-4 accent-olive"
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
                      className="field min-h-16 resize-y text-xs"
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
