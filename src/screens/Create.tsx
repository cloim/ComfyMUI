import {
  useState,
  useEffect,
  useLayoutEffect,
  useRef,
  type ComponentProps,
  type RefObject,
} from 'react';
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
  Dices,
  Languages,
  X,
  Film,
} from 'lucide-react';
import { useStudio, useStudioSelector } from '../studio';
import { translatePrompt } from '../ai-settings';
import {
  loadTranslationPair,
  pairAfterEdit,
  pairAfterTranslate,
  saveTranslationPair,
  swapTranslationPair,
  type TranslationPair,
} from '../prompt-translation';
import {
  hasPromptAttribute,
  togglePromptAttribute,
  buildRandomAssemblePrompt,
  options,
  parseWorkflow,
  downloadJson,
  buildWorkflow,
  type Generation,
  type Job,
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
  HelpTip,
  modifiedField,
} from '../components/ui';
import { Result } from '../components/Result';
import { PromptHelper } from '../components/PromptHelper';
import { DraftTextarea } from '../components/DraftField';
import ModelPanel from '../components/ModelPanel';
import { LoraPicker } from '../components/LoraPicker';
import { fetchLoraList, extractLoraTriggerWords, type LoraItem } from '../lora-manager';
import {
  compatibleAssets,
  selectedEntry,
  isArtifactProneSampler,
  isVideoFamily,
  families,
  qualityProfiles,
} from '../models';
import { imageUrl } from '../api';
import { ltxFrameRates, ltxFrames, ltxSizes, videoOptions } from '../ltx';

const POSITIVE_HEIGHT_KEY = 'cm-prompt-height';
const NEGATIVE_HEIGHT_KEY = 'cm-negative-prompt-height';

function loadTextareaHeight(key: string, min: number, max: number): number | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed < min) return null;
    return Math.min(Math.round(parsed), max);
  } catch {
    return null;
  }
}

function saveTextareaHeight(key: string, height: number) {
  try {
    localStorage.setItem(key, String(height));
  } catch {
    /* ignore storage failures */
  }
}

function usePersistedTextareaHeight(
  ref: RefObject<HTMLTextAreaElement | null>,
  key: string,
  min: number,
  max: number,
  active = true,
) {
  const [height, setHeight] = useState<number | null>(() => loadTextareaHeight(key, min, max));
  const lastSaved = useRef<number | null>(height);

  useEffect(() => {
    if (!active) return;
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => {
      if (!el.style.height || el.offsetHeight === 0) return;
      const raw = Number.parseFloat(el.style.height);
      if (!Number.isFinite(raw)) return;
      const clamped = Math.min(Math.max(Math.round(raw), min), max);
      if (clamped !== lastSaved.current) {
        lastSaved.current = clamped;
        saveTextareaHeight(key, clamped);
        setHeight(clamped);
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref, key, min, max, active]);

  return height ? { height: `${height}px` } : undefined;
}

export default function Create() {
  const {
    settings: s,
    setSettings,
    promptAssemble,
    selectedAssembleId,
    setSelectedAssembleId,
    info,
    familyAssignments,
    connection,
    notify,
  } = useStudioSelector((state) => ({
    settings: state.settings,
    setSettings: state.setSettings,
    promptAssemble: state.promptAssemble,
    selectedAssembleId: state.selectedAssembleId,
    setSelectedAssembleId: state.setSelectedAssembleId,
    info: state.info,
    familyAssignments: state.familyAssignments,
    connection: state.connection,
    notify: state.notify,
  }));
  const promptTextareaRef = useRef<HTMLTextAreaElement>(null);
  const negativeTextareaRef = useRef<HTMLTextAreaElement>(null);
  const loraListCache = useRef<LoraItem[] | null>(null);
  const [randomizing, setRandomizing] = useState(false);

  async function handleRandomPrompt() {
    if (s.loras.length === 0) {
      notify('등록된 LoRA가 없어요. 먼저 LoRA를 추가해 주세요');
      return;
    }
    setRandomizing(true);
    try {
      let items = loraListCache.current;
      if (!items) {
        try {
          const res = await fetchLoraList(connection.base, { page: 1, pageSize: 100 });
          items = res.items;
          loraListCache.current = items;
        } catch {
          items = [];
        }
      }
      const allNames = options(info, 'LoraLoaderModelOnly', 'lora_name').concat(
        options(info, 'LoraLoader', 'lora_name'),
      );
      const triggers = s.loras.flatMap((l) =>
        extractLoraTriggerWords(l.name, items || [], allNames),
      );
      const generated = buildRandomAssemblePrompt(triggers, promptAssemble);
      patch({ positive: generated });
      notify('등록된 LoRA와 어셈블을 조합한 랜덤 프롬프트를 적용했어요');
    } finally {
      setRandomizing(false);
    }
  }
  const [translating, setTranslating] = useState(false);
  const prevStorePositive = useRef(s.positive);
  const latestPositive = useRef(s.positive);
  if (s.positive !== prevStorePositive.current) {
    prevStorePositive.current = s.positive;
    latestPositive.current = s.positive;
  }
  const [translationPair, setTranslationPair] = useState<TranslationPair | null>(
    loadTranslationPair,
  );
  useEffect(() => saveTranslationPair(translationPair), [translationPair]);
  const visiblePair =
    translationPair &&
    (translationPair.current === s.positive || translationPair.current === latestPositive.current)
      ? translationPair
      : null;

  function editPositive(next: string) {
    const previous = latestPositive.current;
    latestPositive.current = next;
    setTranslationPair((pair) => pairAfterEdit(pair, previous, next));
    patch({ positive: next });
  }

  function swapTranslation() {
    if (!visiblePair) return;
    const next = swapTranslationPair(visiblePair);
    latestPositive.current = next.current;
    setTranslationPair(next);
    patch({ positive: next.current });
  }

  async function handleTranslatePrompt() {
    const source = s.positive;
    if (!/[ㄱ-ㅎㅏ-ㅣ가-힣]/.test(source)) {
      notify('번역할 한국어 묘사를 입력해 주세요');
      return;
    }
    setTranslating(true);
    try {
      const translated = await translatePrompt(source);
      // Text typed while the model was working is never replaced.
      if (latestPositive.current !== source) {
        notify('번역 중 프롬프트가 바뀌어서 결과를 적용하지 않았어요');
        return;
      }
      setTranslationPair((pair) => pairAfterTranslate(pair, source, translated));
      patch({ positive: translated });
      notify('영문 프롬프트로 번역했어요');
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setTranslating(false);
    }
  }
  const [advanced, setAdvanced] = useState(false);
  const [advancedTab, setAdvancedTab] = useState('settings');
  function openAdvanced(tab = 'settings') {
    setAdvancedTab(tab);
    setAdvanced(true);
  }
  const [addLora, setAddLora] = useState(false);
  const [negative, setNegative] = useState(false);
  const positiveStyle = usePersistedTextareaHeight(promptTextareaRef, POSITIVE_HEIGHT_KEY, 96, 800);
  const negativeStyle = usePersistedTextareaHeight(
    negativeTextareaRef,
    NEGATIVE_HEIGHT_KEY,
    64,
    600,
    negative,
  );
  const patch = (v: Partial<Generation>) => setSettings((s) => ({ ...s, ...v }));
  // The batch size control was removed; multiple images come from the 연속 queue instead.
  useEffect(() => {
    if (s.batch !== 1) patch({ batch: 1 });
  }, [s.batch]);
  const video = isVideoFamily(s.architecture);
  const ratios = video
    ? ltxSizes
    : [
        { name: '정사각', ratio: '1:1', w: 1024, h: 1024 },
        { name: '세로', ratio: '3:4', w: 768, h: 1024 },
        { name: '가로', ratio: '4:3', w: 1024, h: 768 },
        { name: '와이드', ratio: '16:9', w: 1024, h: 576 },
      ];
  const sizeRange = video ? { min: 256, max: 1920 } : { min: 64, max: 4096 };
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
              onToggleAttribute={(attr) => editPositive(togglePromptAttribute(s.positive, attr))}
              onRandomAssemble={handleRandomPrompt}
              randomizing={randomizing}
              onTranslate={handleTranslatePrompt}
              translating={translating}
            />
            <label htmlFor="positive" className="sr-only">
              그리고 싶은 장면
            </label>
            <DraftTextarea
              ref={promptTextareaRef}
              id="positive"
              className="field min-h-24 resize-y leading-relaxed"
              style={positiveStyle}
              value={s.positive}
              onValueChange={editPositive}
              placeholder={
                video ? '장면과 카메라의 움직임을 묘사해 주세요' : '어떤 장면을 만들고 싶으세요?'
              }
            />
            {visiblePair && (
              <div className="mt-2 rounded-lg bg-paper px-2.5 py-1.5 text-xs">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-muted">
                    {visiblePair.showing === 'translated' ? '한국어 원문' : '영문 번역'}
                  </span>
                  <div className="flex items-center gap-0.5">
                    <button
                      type="button"
                      onClick={swapTranslation}
                      className="flex min-h-8 items-center gap-1 rounded-md px-2 font-semibold text-olive hover:bg-white active:scale-95"
                    >
                      <ArrowLeftRight size={14} />
                      {visiblePair.showing === 'translated' ? '원문으로 전환' : '번역문으로 전환'}
                    </button>
                    <button
                      type="button"
                      aria-label="보관한 번역 닫기"
                      title="보관한 번역 닫기"
                      onClick={() => setTranslationPair(null)}
                      className="flex h-8 w-8 items-center justify-center rounded-md text-muted hover:bg-white hover:text-ink active:scale-95"
                    >
                      <X size={14} />
                    </button>
                  </div>
                </div>
                <p className="max-h-16 overflow-y-auto whitespace-pre-wrap break-words pb-1 leading-relaxed text-ink">
                  {visiblePair.other}
                </p>
              </div>
            )}
            <RecentPromptHelper
              value={s.positive}
              onChange={editPositive}
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
                <DraftTextarea
                  ref={negativeTextareaRef}
                  id="negative"
                  className="field mt-1.5 min-h-16 resize-y text-xs leading-relaxed"
                  style={negativeStyle}
                  value={s.negative}
                  onValueChange={(v) => patch({ negative: v })}
                  placeholder={video ? '영상에서 제외할 요소' : '이미지에서 제외할 요소'}
                />
                {video && s.cfg <= 1 && (
                  <p className="mt-1.5 text-2xs text-muted">
                    영상은 고급 설정의 CFG가 1보다 클 때 네거티브 프롬프트를 적용해요
                  </p>
                )}
              </>
            )}
          </Section>
          <Section
            title="LoRA"
            icon={Layers2}
            help={
              <HelpTip label="LoRA 강도">
                <div className="flex flex-col gap-2 break-keep">
                  <p>
                    <b>모델 강도</b>
                    <br />
                    이미지를 만드는 모델에 LoRA의 스타일과 특징을 반영하는 정도예요
                  </p>
                  <p>
                    <b>CLIP 강도</b>
                    <br />
                    프롬프트를 해석하는 텍스트 인코더에 LoRA를 반영하는 정도예요
                  </p>
                  <p>
                    0은 적용하지 않고, 1은 기본 배율로 적용해요. 값을 높일수록 효과가 강해지며
                    이미지가 왜곡될 수 있어요
                  </p>
                  <p>
                    CLIP 강도는 Flux 계열에서 조절하며, 텍스트 인코더 가중치가 포함된 LoRA에
                    적용돼요
                  </p>
                </div>
              </HelpTip>
            }
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
          <Section
            title={video ? '영상 설정' : '이미지 설정'}
            icon={video ? Film : SlidersHorizontal}
          >
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
                  {...sizeRange}
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
                  {...sizeRange}
                  step={8}
                />
              </div>
            </div>
            {video && <VideoSettings />}
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
      <LoraPicker open={addLora} onClose={() => setAddLora(false)} />
    </div>
  );
}
// Length, frame rate, audio and first frame of a video family, below its size.
function VideoSettings() {
  const {
    settings: s,
    setSettings,
    uploadFirstFrame,
  } = useStudioSelector((state) => ({
    settings: state.settings,
    setSettings: state.setSettings,
    uploadFirstFrame: state.uploadFirstFrame,
  }));
  const [uploading, setUploading] = useState(false);
  const patch = (v: Partial<Generation>) => setSettings((prev) => ({ ...prev, ...v }));
  const { seconds, fps, audio, frameStrength } = videoOptions(s);
  const frames = ltxFrames(seconds, fps);
  const heavy = s.width * s.height * frames > 1280 * 720 * 145;
  const distilledSteps = qualityProfiles[s.architecture].steps;
  return (
    <div className="mt-3.5 flex flex-col gap-3 border-t border-line pt-3.5">
      <div className="flex flex-col gap-1.5">
        <div
          data-ui-audit-row
          className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] items-end gap-2.5"
        >
          <Numeric
            label="길이 (초)"
            value={seconds}
            onChange={(seconds) => patch({ seconds })}
            min={1}
            max={20}
            step={0.5}
          />
          <Field label="FPS">
            <SelectControl
              aria-label="FPS"
              value={fps}
              onChange={(e) => patch({ fps: Number(e.target.value) })}
            >
              {ltxFrameRates.map((rate) => (
                <option key={rate} value={rate}>
                  {rate} FPS
                </option>
              ))}
            </SelectControl>
          </Field>
        </div>
        {Number.isFinite(frames / fps) && (
          <p className="text-2xs text-muted">
            {frames}프레임, 약 {(frames / fps).toFixed(2)}초
          </p>
        )}
        {heavy && (
          <p className="text-2xs leading-relaxed text-muted">
            HD 6초보다 메모리를 많이 사용해요. 서버에서 메모리 오류가 나면 해상도나 길이를 줄여
            주세요
          </p>
        )}
      </div>
      {s.steps !== distilledSteps && (
        <div
          role="status"
          className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-[#ece4c9] px-3 py-2 text-xs text-[#69521e]"
        >
          <span className="min-w-0 flex-1 leading-relaxed">
            Steps {s.steps}은 증류 모델 전용 스케줄을 쓰지 않아 움직일 때 번질 수 있어요
          </span>
          <button
            type="button"
            className="btn-secondary shrink-0"
            onClick={() => patch({ steps: distilledSteps })}
          >
            {distilledSteps}스텝으로 되돌리기
          </button>
        </div>
      )}
      <label className="flex min-h-7 items-center justify-between gap-2.5 text-xs font-medium">
        MP4에 오디오 포함
        <input
          type="checkbox"
          className="h-4 w-4 accent-olive"
          checked={audio}
          onChange={(e) => patch({ audio: e.target.checked })}
        />
      </label>
      <Field label="첫 프레임 (선택)">
        {s.firstFrame ? (
          <div className="flex min-w-0 flex-col gap-2.5 rounded-lg bg-paper p-2.5">
            <div className="flex min-w-0 items-center gap-2.5">
              <img
                src={imageUrl(s.firstFrame.base, s.firstFrame.image)}
                alt="첫 프레임 이미지"
                className="h-14 w-14 shrink-0 rounded-md bg-stone object-cover"
              />
              <span className="min-w-0 flex-1 truncate text-xs" title={s.firstFrame.image.filename}>
                {s.firstFrame.image.filename}
              </span>
              <IconButton
                icon={X}
                label="첫 프레임 해제"
                className="shrink-0"
                onClick={() => patch({ firstFrame: null })}
              />
            </div>
            <Numeric
              label="첫 프레임 강도"
              value={frameStrength}
              onChange={(frameStrength) => patch({ frameStrength })}
              min={0}
              max={1}
              step={0.05}
              help="1이면 첫 프레임을 그대로 유지하고, 낮출수록 프롬프트에 맞게 다시 그려요."
            />
          </div>
        ) : (
          <label
            className={`flex min-h-12 w-full cursor-pointer items-center gap-3 rounded-lg border border-dashed border-line p-3 text-left ${uploading ? 'opacity-60' : ''}`}
          >
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-stone">
              {uploading ? <Spinner /> : <Upload size={16} className="text-muted" />}
            </span>
            <span>
              <span className="block text-xs font-medium">이미지에서 영상 시작하기</span>
              <span className="mt-0.5 block text-2xs text-muted">
                JPG, PNG, WebP 최대 20MB | 설정한 비율로 가운데를 잘라요
              </span>
            </span>
            <input
              type="file"
              aria-label="첫 프레임 이미지 선택"
              accept="image/jpeg,image/png,image/webp"
              className="sr-only"
              disabled={uploading}
              onChange={async (e) => {
                const file = e.target.files?.[0];
                e.target.value = '';
                if (!file) return;
                setUploading(true);
                try {
                  await uploadFirstFrame(file);
                } finally {
                  setUploading(false);
                }
              }}
            />
          </label>
        )}
      </Field>
    </div>
  );
}
function RecentPromptHelper(props: Omit<ComponentProps<typeof PromptHelper>, 'jobs'>) {
  const recent = useRef<Job[]>([]);
  const jobs = useStudioSelector((state) => {
    const next = state.jobs.filter((job) => !job.video).slice(0, 50);
    // Autocomplete depends only on recent prompt text, never on image progress.
    if (
      recent.current.length !== next.length ||
      next.some(
        (job, index) => job.settings?.positive !== recent.current[index]?.settings?.positive,
      )
    )
      recent.current = next;
    return recent.current;
  });
  return <PromptHelper {...props} jobs={jobs} />;
}

function PromptAssembleBar({
  elements,
  selectedId,
  onSelectId,
  positive,
  onToggleAttribute,
  onRandomAssemble,
  randomizing,
  onTranslate,
  translating,
}: {
  elements: PromptAssembleElement[];
  selectedId: string;
  onSelectId: (id: string) => void;
  positive: string;
  onToggleAttribute: (attr: string) => void;
  onRandomAssemble?: () => void;
  randomizing?: boolean;
  onTranslate?: () => void;
  translating?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [menuStyle, setMenuStyle] = useState<{ left: number; top: number; minWidth: number }>({
    left: 16,
    top: 16,
    minWidth: 180,
  });

  const currentElement = elements.find((el) => el.id === selectedId) || elements[0];
  const activeAttrs = currentElement
    ? currentElement.attributes.filter((attr) => hasPromptAttribute(positive, attr))
    : [];

  useLayoutEffect(() => {
    if (!open) return;
    const syncPosition = () => {
      const rect = triggerRef.current?.getBoundingClientRect();
      const menu = menuRef.current;
      if (!rect || !menu) return;
      // The menu grows to its longest option, so it can be wider than a narrow trigger.
      const available = window.innerWidth - 24;
      const minWidth = Math.min(available, Math.max(180, rect.width));
      const width = Math.min(available, Math.max(minWidth, menu.offsetWidth));
      const left = Math.max(12, Math.min(window.innerWidth - width - 12, rect.left));
      const height = menu.offsetHeight;
      const top =
        rect.bottom + height + 12 > window.innerHeight && rect.top > height + 12
          ? rect.top - height - 6
          : rect.bottom + 6;
      setMenuStyle({ left, top, minWidth });
    };
    syncPosition();
    // A selected option turns bold and can change the menu's size.
    const resizeObserver = new ResizeObserver(syncPosition);
    if (menuRef.current) resizeObserver.observe(menuRef.current);
    window.addEventListener('resize', syncPosition);
    window.addEventListener('scroll', syncPosition, true);
    return () => {
      resizeObserver.disconnect();
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
      <div
        data-ui-audit-row
        className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] items-center gap-2"
      >
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
        <div className="flex items-center gap-2">
          {onRandomAssemble && (
            <button
              type="button"
              aria-label="등록한 LoRA 기준 어셈블 랜덤 조합"
              title="등록한 LoRA 기준 어셈블 랜덤 조합"
              disabled={randomizing}
              onClick={onRandomAssemble}
              className="btn-secondary flex h-9 w-9 shrink-0 items-center justify-center p-0 text-olive hover:text-olive active:scale-95 disabled:opacity-50"
            >
              <Dices size={16} />
            </button>
          )}
          {onTranslate && (
            <button
              type="button"
              aria-label="한국어 묘사를 영문 프롬프트로 번역"
              title="한국어 묘사를 영문 프롬프트로 번역"
              aria-busy={translating}
              disabled={translating}
              onClick={onTranslate}
              className="btn-secondary flex h-9 w-9 shrink-0 items-center justify-center p-0 text-olive hover:text-olive active:scale-95 disabled:opacity-50"
            >
              {translating ? <Spinner /> : <Languages size={16} />}
            </button>
          )}
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
            className="fixed z-[2100] flex max-h-60 w-max max-w-[calc(100vw-24px)] flex-col gap-0.5 overflow-y-auto rounded-lg border border-line bg-white p-1 shadow-xl"
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
                  <span className="min-w-0 break-words">{attr}</span>
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
// Shows the latest result of the selected family's medium; earlier videos can be picked
// here because the history screen lists only images.
function PreviewPanel() {
  const { jobs, video } = useStudioSelector((state) => ({
    jobs: state.jobs,
    video: isVideoFamily(state.settings.architecture),
  }));
  const [pickedId, setPickedId] = useState('');
  const sameKind = jobs.filter((job) => Boolean(job.video) === video);
  // A new generation replaces the picked earlier video.
  const newestId = sameKind[0]?.id;
  useEffect(() => setPickedId(''), [newestId]);
  const latest = sameKind.find((job) => job.id === pickedId) || sameKind[0];
  const lastComplete = sameKind.find(
    (j) => j.status === 'complete' && (j.video ? Boolean(j.videos?.length) : j.images.length > 0),
  );
  const recent = video ? sameKind.slice(0, 20) : [];
  return (
    <div className="flex flex-col gap-2.5 rounded-xl border border-line bg-white p-3.5 sm:p-4">
      {recent.length > 1 && (
        <SelectControl
          aria-label="최근 생성 영상"
          value={latest?.id || ''}
          onChange={(e) => setPickedId(e.target.value)}
        >
          {recent.map((job) => (
            <option key={job.id} value={job.id}>
              {new Date(job.createdAt).toLocaleString('ko-KR', {
                month: 'numeric',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
              })}{' '}
              | {job.settings.positive.slice(0, 40) || '(프롬프트 없음)'}
            </option>
          ))}
        </SelectControl>
      )}
      <Result
        key={latest?.id || (video ? 'video-sample' : 'sample')}
        job={latest}
        fallback={latest?.id === sameKind[0]?.id ? lastComplete : undefined}
        video={video}
      />
    </div>
  );
}
const clampRuns = (n: number) => (Number.isFinite(n) ? Math.max(1, Math.round(n)) : 1);
// Image count and generate button, shown in the top bar of the create screen.
export function GenerateControls() {
  const {
    settings: s,
    generate,
    active,
    busy,
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
  const video = !s.workflow && isVideoFamily(s.architecture);
  const unit = video ? '개' : '장';
  const disabled = busy || unavailable || !online;
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
          title={`${video ? '개수' : '장 수'} | 2${unit} 이상이면 Seed를 바꿔 이어서 생성`}
        >
          <input
            type="number"
            inputMode="numeric"
            min={1}
            step={1}
            aria-label={video ? '개수' : '장 수'}
            value={countText}
            onChange={(e) => setCountText(e.target.value)}
            onBlur={() => setCountText(String(count))}
            onKeyDown={(e) => {
              if (e.key === 'Enter') run();
            }}
            className="field pr-6 text-center font-mono [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
          />
          <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-2xs text-muted">
            {unit}
          </span>
        </label>
        <button
          data-testid="generate"
          disabled={disabled}
          onClick={run}
          className="btn-primary shrink-0 whitespace-nowrap px-3"
        >
          <span className="flex items-center gap-1.5">
            {busy ? <Spinner /> : video ? <Film size={15} /> : <Sparkles size={15} />}
            <span className="sm:hidden">{active ? '추가' : '생성'}</span>
            <span className="hidden sm:inline">
              {active ? '대기열에 추가' : video ? '영상 생성' : '이미지 생성'}
            </span>
          </span>
          <span className="hidden rounded bg-white/15 px-1.5 py-0.5 text-2xs font-normal sm:inline">
            {active
              ? `${active.status === 'queued' ? '대기 중' : '생성 중'} ${active.progress}%`
              : s.workflow
                ? 'API'
                : `${count}${unit}`}
          </span>
        </button>
      </div>

      <Modal
        title={`서버 대기열 (${clientQueue.length}개)`}
        open={showQueue}
        onClose={() => setShowQueue(false)}
        onCancel={() => setShowQueue(false)}
        footer={
          <>
            {clientQueue.length > 0 && (
              <button
                className="btn-secondary text-red-700"
                data-modal-no-cancel
                onClick={() => {
                  void clearQueue();
                  setShowQueue(false);
                }}
              >
                <Trash2 size={14} />
                대기열 모두 취소
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
              ComfyUI 서버 대기열에 등록된 작업입니다. PWA 창을 최소화하거나 닫아도 서버에서 계속
              생성돼요.
            </p>
            <div className="flex max-h-[360px] flex-col gap-1.5 overflow-y-auto pr-1">
              {clientQueue.map((item) => (
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
                      icon={Trash2}
                      danger
                      onClick={() => void removeFromQueue(item.id)}
                      label="대기 취소"
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
  const {
    settings: s,
    setSettings,
    info,
    notify,
  } = useStudioSelector((state) => ({
    settings: state.settings,
    setSettings: state.setSettings,
    info: state.info,
    notify: state.notify,
  }));
  const patch = (v: Partial<Generation>) => setSettings((s) => ({ ...s, ...v }));
  const prof = qualityProfiles[s.architecture] || qualityProfiles.flux;
  const archLabel = families.find((f) => f.id === s.architecture)?.label || s.architecture;
  const video = isVideoFamily(s.architecture);
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
                        {video &&
                          ' 8스텝은 증류 모델 전용 스케줄을, 다른 값은 LTX 스케줄러를 사용해요.'}
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
                    min={video ? 1 : 0}
                    max={video ? 10 : 30}
                    step={0.1}
                    help={
                      <>
                        프롬프트를 얼마나 강하게 따를지 정해요. 너무 높으면 색이 타거나 대비가
                        과해져요.
                        {s.architecture === 'flux' &&
                          ' Flux1.d는 1.0으로 두고 디테일은 Flux Guidance로 조절해요.'}
                        {video && ' 1보다 크면 네거티브 프롬프트를 적용해요.'}
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
                <div className={`grid gap-2.5 ${video ? 'grid-cols-1' : 'grid-cols-2'}`}>
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
                      {options(info, video ? 'KSamplerSelect' : 'KSampler', 'sampler_name').map(
                        (v) => (
                          <option key={v}>{v}</option>
                        ),
                      )}
                    </SelectControl>
                  </Field>
                  {!video && (
                    <Field
                      label="Scheduler"
                      help={
                        <>
                          스텝마다 노이즈를 얼마나 줄일지 정하는 곡선이에요. 초반 구도와 후반
                          디테일에 쓰는 비중이 달라져요.
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
                  )}
                </div>
                {!video && (
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
                )}
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
  const info = useStudioSelector((state) => state.info);
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
