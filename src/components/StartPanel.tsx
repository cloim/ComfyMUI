import { useEffect, useRef, useState, type ClipboardEvent, type DragEvent } from 'react';
import { Film, ImagePlus, Images, PenLine, Sparkles, Wand2, X } from 'lucide-react';
import { useStudioSelector } from '../studio';
import { assistEncoder, type AssistMode } from '../assist';
import { catalog, isVideoFamily } from '../models';
import { IconButton, Section, Spinner } from './ui';

type Photo = { file: File; url: string; width: number; height: number };
const PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MODES: {
  id: Exclude<AssistMode, 'write'>;
  label: string;
  hint: string;
  icon: typeof Images;
}[] = [
  { id: 'remake', label: '닮게 새로', hint: '구도와 분위기를 살려 새로 그려요', icon: Images },
  { id: 'edit', label: '사진 고치기', hint: '사진은 그대로 두고 말한 부분만 바꿔요', icon: Wand2 },
  { id: 'motion', label: '영상으로', hint: '사진이 첫 장면인 영상을 만들어요', icon: Film },
];

async function readPhoto(file: File): Promise<Photo> {
  if (!PHOTO_TYPES.includes(file.type) || file.size > 20 * 1024 * 1024)
    throw new Error('20MB 이하의 JPG, PNG 또는 WebP 사진을 넣어 주세요');
  const bitmap = await createImageBitmap(file);
  const photo = {
    file,
    url: URL.createObjectURL(file),
    width: bitmap.width,
    height: bitmap.height,
  };
  bitmap.close();
  return photo;
}

// One place to start: write an idea in any language, or add a photo and say what to do
// with it. The helper writes the prompt in the prompt field below, so it stays editable.
export function StartPanel() {
  const { info, familyAssignments, modelOrder, architecture, writeWithAssist, notify } =
    useStudioSelector((s) => ({
      info: s.info,
      familyAssignments: s.familyAssignments,
      modelOrder: s.modelOrder,
      architecture: s.settings.architecture,
      writeWithAssist: s.writeWithAssist,
      notify: s.notify,
    }));
  const [idea, setIdea] = useState('');
  const [photo, setPhoto] = useState<Photo | null>(null);
  const [mode, setMode] = useState<Exclude<AssistMode, 'write'>>('remake');
  const [working, setWorking] = useState<null | 'write' | 'generate'>(null);
  const [dragging, setDragging] = useState(false);
  const abort = useRef<AbortController | null>(null);
  useEffect(() => () => abort.current?.abort(), []);
  useEffect(() => () => void (photo && URL.revokeObjectURL(photo.url)), [photo]);

  const encoder = assistEncoder(info);
  const list = info ? catalog(info, familyAssignments, modelOrder) : [];
  const available = {
    remake: list.some((e) => !isVideoFamily(e.family)),
    edit: list.some((e) => e.family === 'qwen21'),
    motion: list.some((e) => isVideoFamily(e.family)),
  };
  const activeMode: AssistMode = photo ? mode : 'write';
  const needsIdea = !photo || mode === 'edit';
  const ready = Boolean(encoder) && (!needsIdea || idea.trim().length > 0);

  async function addPhoto(file: File | undefined) {
    if (!file) return;
    try {
      const next = await readPhoto(file);
      setPhoto(next);
      // An image model is the natural choice; a video model selected now suggests motion.
      setMode(isVideoFamily(architecture) && available.motion ? 'motion' : 'remake');
    } catch (e) {
      notify((e as Error).message);
    }
  }
  async function run(andGenerate: boolean) {
    if (!ready || working) return;
    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;
    setWorking(andGenerate ? 'generate' : 'write');
    try {
      await writeWithAssist({
        mode: activeMode,
        idea: idea.trim(),
        photo: photo ? { file: photo.file, width: photo.width, height: photo.height } : undefined,
        andGenerate,
        signal: controller.signal,
      });
    } finally {
      if (abort.current === controller) abort.current = null;
      setWorking(null);
    }
  }
  function onPaste(e: ClipboardEvent) {
    const file = Array.from(e.clipboardData.files).find((f) => PHOTO_TYPES.includes(f.type));
    if (!file) return;
    e.preventDefault();
    void addPhoto(file);
  }
  function onDrop(e: DragEvent) {
    e.preventDefault();
    setDragging(false);
    void addPhoto(Array.from(e.dataTransfer.files)[0]);
  }

  const placeholder = !photo
    ? '떠오르는 장면을 편하게 적어 주세요. 한국어도 좋아요'
    : mode === 'edit'
      ? '무엇을 바꿀까요? 예: 머리를 금발로, 배경을 바다로'
      : mode === 'motion'
        ? '어떻게 움직일까요? 비워 두면 장면에 맞게 자연스럽게 움직여요'
        : '바꾸고 싶은 점이 있으면 적어 주세요 (선택)';
  return (
    <Section title="무엇을 만들까요?" icon={Sparkles}>
      <div
        onDragOver={(e) => {
          if (!Array.from(e.dataTransfer.types).includes('Files')) return;
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={`flex flex-col gap-2.5 rounded-lg ${dragging ? 'outline-dashed outline-2 outline-offset-4 outline-olive' : ''}`}
      >
        <div className="flex items-start gap-2.5">
          {photo ? (
            <div className="relative shrink-0">
              <img
                src={photo.url}
                alt="넣은 사진"
                className="h-[84px] w-[84px] rounded-lg bg-stone object-cover"
              />
              <IconButton
                icon={X}
                label="사진 빼기"
                className="absolute -right-2 -top-2 h-7 w-7 rounded-full border border-line bg-white shadow-sm"
                onClick={() => setPhoto(null)}
              />
            </div>
          ) : (
            <label className="flex h-[84px] w-[84px] shrink-0 cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-line text-center text-2xs font-semibold text-muted hover:bg-paper">
              <ImagePlus size={18} />
              사진 넣기
              <input
                type="file"
                aria-label="시작할 사진 선택"
                accept={PHOTO_TYPES.join(',')}
                className="sr-only"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = '';
                  void addPhoto(file);
                }}
              />
            </label>
          )}
          <label className="min-w-0 flex-1">
            <span className="sr-only">만들고 싶은 것</span>
            <textarea
              value={idea}
              onChange={(e) => setIdea(e.target.value)}
              onPaste={onPaste}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  void run(true);
                }
              }}
              placeholder={placeholder}
              rows={3}
              className="field h-[84px] min-h-[84px] resize-y leading-relaxed"
            />
          </label>
        </div>
        {photo && (
          <div role="radiogroup" aria-label="사진으로 할 일" className="grid grid-cols-3 gap-1.5">
            {MODES.map((m) => {
              const on = mode === m.id;
              return (
                <button
                  key={m.id}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  disabled={!available[m.id]}
                  title={
                    available[m.id]
                      ? m.hint
                      : m.id === 'edit'
                        ? 'Qwen 2.1 모델이 있어야 사진을 고칠 수 있어요'
                        : 'LTX 영상 모델이 있어야 해요'
                  }
                  onClick={() => setMode(m.id)}
                  className={`flex min-h-14 min-w-0 flex-col items-start justify-center gap-0.5 rounded-lg border px-2.5 py-2 text-left transition disabled:cursor-not-allowed disabled:opacity-40 ${on ? 'border-olive bg-lime/20' : 'border-line bg-white hover:bg-paper'}`}
                >
                  <span className="flex items-center gap-1.5 text-xs font-bold">
                    <m.icon size={14} className={on ? 'text-olive' : 'text-muted'} />
                    {m.label}
                  </span>
                  <span className="hidden text-2xs leading-snug text-muted sm:block">{m.hint}</span>
                </button>
              );
            })}
          </div>
        )}
        {!encoder && info && (
          <p className="text-2xs leading-relaxed text-muted">
            프롬프트를 대신 쓰려면 Qwen3-VL 텍스트 인코더(Krea2용 qwen3vl 4b 또는 Qwen 2.1용 qwen3vl
            8b)가 필요해요
          </p>
        )}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p
            aria-live="polite"
            className={`min-w-0 flex-1 text-2xs leading-relaxed text-muted ${working ? '' : 'hidden sm:block'}`}
          >
            {working
              ? photo
                ? '사진을 보고 프롬프트를 쓰고 있어요 · 보통 20~30초'
                : '프롬프트를 쓰고 있어요 · 보통 몇 초'
              : photo
                ? '사진을 끌어다 놓거나 붙여 넣어도 돼요'
                : '사진을 넣으면 그 사진으로 새로 그리거나, 고치거나, 움직일 수 있어요'}
          </p>
          <div className="ml-auto flex shrink-0 gap-2">
            <button
              type="button"
              className="btn-secondary flex items-center gap-1.5"
              disabled={!ready || Boolean(working)}
              onClick={() => void run(false)}
            >
              {working === 'write' ? <Spinner /> : <PenLine size={15} />}
              프롬프트만 쓰기
            </button>
            <button
              type="button"
              className="btn-primary flex items-center gap-1.5"
              disabled={!ready || Boolean(working)}
              onClick={() => void run(true)}
            >
              {working === 'generate' ? <Spinner /> : <Sparkles size={15} />}
              바로 만들기
            </button>
          </div>
        </div>
      </div>
    </Section>
  );
}
