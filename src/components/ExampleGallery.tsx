import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  EyeOff,
  Info,
  LoaderCircle,
  Play,
  Wand2,
  X,
} from 'lucide-react';
import { useStudio } from '../studio';
import {
  civitaiMediaUrl,
  isVideoMedia,
  type CivitaiImage,
  type CivitaiImageMeta,
  type ExampleKind,
} from '../lora-manager';
import { canBecomeDefault, useExampleImages } from '../example-images';
import { options } from '../domain';
import { remixSettings } from '../remix';
import { useNavigate } from 'react-router-dom';
import { isTopModal, popModal, pushModal } from './Modal/modalStack.js';
import { IconButton } from './ui';

// Same threshold as the model cards: R and above stays blurred until revealed.
const SENSITIVE_LEVEL = 4;

// Example images for a model or LoRA detail modal, with the default-image checkbox.
export function DetailExamples({
  kind,
  item,
  showNsfw,
  revision,
  onPreviewChanged,
}: {
  kind: ExampleKind;
  item: { file_path: string; sha256?: string; civitai?: { modelId?: number } | null };
  showNsfw: boolean;
  revision: number;
  onPreviewChanged: (filePath: string, previewUrl: string, nsfwLevel: number) => void;
}) {
  const ex = useExampleImages(kind, item, onPreviewChanged, revision);
  return (
    <ExampleGallery
      images={ex.images}
      loading={ex.loading}
      showNsfw={showNsfw}
      defaultUrl={ex.defaultUrl}
      settingUrl={ex.settingUrl}
      onSetDefault={(im) => void ex.setDefault(im)}
      canSetDefault={(im) => canBecomeDefault(im, ex.preview)}
      emptyText={
        ex.error
          ? `예시 이미지를 불러오지 못했어요 | ${ex.error}`
          : item.civitai?.modelId
            ? '이 버전에 등록된 예시 이미지가 없어요'
            : 'CivitAI 정보가 없어요 | 아래 메타데이터 동기화를 실행하면 예시 이미지를 받아와요'
      }
    />
  );
}

export function ExampleGallery({
  images,
  loading,
  showNsfw,
  emptyText,
  defaultUrl,
  settingUrl,
  onSetDefault,
  canSetDefault,
}: {
  images: CivitaiImage[];
  loading: boolean;
  showNsfw: boolean;
  emptyText: string;
  // The example currently used as the card preview, if known.
  defaultUrl?: string;
  settingUrl?: string;
  onSetDefault?: (image: CivitaiImage) => void;
  canSetDefault?: (image: CivitaiImage) => boolean;
}) {
  const { connection } = useStudio();
  const stripRef = useRef<HTMLDivElement | null>(null);
  const [revealed, setRevealed] = useState<Set<number>>(new Set());
  const [viewing, setViewing] = useState<number | null>(null);
  const [edges, setEdges] = useState({ start: true, end: true });
  const hidden = (i: number) =>
    (images[i]?.nsfwLevel || 0) >= SENSITIVE_LEVEL && !showNsfw && !revealed.has(i);
  const reveal = (i: number) => setRevealed((prev) => new Set(prev).add(i));

  function measure() {
    const el = stripRef.current;
    if (!el) return;
    setEdges({
      start: el.scrollLeft <= 2,
      end: el.scrollLeft + el.clientWidth >= el.scrollWidth - 2,
    });
  }
  useEffect(() => {
    setRevealed(new Set());
    setViewing(null);
    stripRef.current?.scrollTo({ left: 0 });
    const t = window.setTimeout(measure, 50);
    return () => window.clearTimeout(t);
  }, [images]);
  function scrollBy(dir: 1 | -1) {
    const el = stripRef.current;
    if (el) el.scrollBy({ left: dir * el.clientWidth * 0.8, behavior: 'smooth' });
  }

  return (
    <section aria-label="예시 이미지" className="flex min-w-0 flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-xs font-semibold">
          예시 이미지
          {images.length > 0 && <span className="ml-1.5 text-muted">{images.length}</span>}
        </h3>
        {images.length > 1 && (
          <div className="-my-1 flex items-center">
            <IconButton
              icon={ChevronLeft}
              label="이전 예시 이미지"
              disabled={edges.start}
              onClick={() => scrollBy(-1)}
            />
            <IconButton
              icon={ChevronRight}
              label="다음 예시 이미지"
              disabled={edges.end}
              onClick={() => scrollBy(1)}
            />
          </div>
        )}
      </div>
      {loading ? (
        <div className="flex h-56 gap-2 overflow-hidden sm:h-72" aria-label="예시 이미지를 불러오는 중">
          {[0.78, 0.66, 1].map((r) => (
            <div
              key={r}
              className="h-full shrink-0 animate-pulse rounded-xl bg-stone"
              style={{ aspectRatio: r }}
            />
          ))}
        </div>
      ) : images.length ? (
        <div
          ref={stripRef}
          onScroll={measure}
          className="flex h-56 snap-x snap-mandatory gap-2 overflow-x-auto overscroll-x-contain pb-1 sm:h-72"
        >
          {images.map((im, i) => {
            const video = isVideoMedia(im);
            const src = civitaiMediaUrl(connection.base, im.url, 'thumb', video);
            const isHidden = hidden(i);
            const isDefault = Boolean(defaultUrl) && defaultUrl === im.url;
            const isSetting = settingUrl === im.url;
            return (
              <div
                key={`${im.url}-${i}`}
                className="group relative h-full max-w-[85%] shrink-0 snap-start overflow-hidden rounded-xl bg-stone"
                style={{ aspectRatio: `${im.width || 1} / ${im.height || 1}` }}
              >
              <button
                type="button"
                aria-label={isHidden ? `예시 이미지 ${i + 1} 민감한 이미지 보기` : `예시 이미지 ${i + 1} 크게 보기`}
                onClick={() => (isHidden ? reveal(i) : setViewing(i))}
                className="absolute inset-0 rounded-xl focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-olive"
              >
                {video ? (
                  <video
                    src={src}
                    muted
                    loop
                    autoPlay={!isHidden}
                    playsInline
                    preload="metadata"
                    className={`h-full w-full object-cover ${isHidden ? 'scale-110 blur-2xl' : ''}`}
                  />
                ) : (
                  <img
                    src={src}
                    alt=""
                    loading="lazy"
                    draggable={false}
                    className={`h-full w-full object-cover transition-transform duration-300 ${isHidden ? 'scale-110 blur-2xl' : 'group-hover:scale-[1.03]'}`}
                  />
                )}
                {isHidden ? (
                  <span className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 bg-black/30 text-white">
                    <EyeOff size={18} aria-hidden="true" />
                    <span className="rounded-full bg-black/50 px-3 py-1 text-2xs font-semibold">
                      보기
                    </span>
                  </span>
                ) : (
                  <>
                    {video && (
                      <span className="absolute left-2 top-2 flex h-6 w-6 items-center justify-center rounded-full bg-black/55 text-white">
                        <Play size={11} aria-hidden="true" />
                      </span>
                    )}
                    {hasGenerationData(im.meta) && (
                      <span className="absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded-full bg-black/55 text-white">
                        <Info size={12} aria-hidden="true" />
                      </span>
                    )}
                  </>
                )}
              </button>
              {onSetDefault && !isHidden && canSetDefault?.(im) !== false && (
                <button
                  type="button"
                  role="checkbox"
                  aria-checked={isDefault}
                  aria-busy={isSetting || undefined}
                  aria-label={`예시 이미지 ${i + 1} 기본 이미지로 설정`}
                  disabled={Boolean(settingUrl) && !isSetting}
                  onClick={() => onSetDefault(im)}
                  className={`absolute bottom-2 left-2 flex min-h-7 items-center gap-1.5 rounded-full py-1 pl-1.5 pr-2.5 text-2xs font-semibold text-white backdrop-blur-sm transition disabled:opacity-60 ${isDefault ? 'bg-olive' : 'bg-black/55 hover:bg-black/70'}`}
                >
                  <span
                    className={`flex h-4 w-4 items-center justify-center rounded border-[1.5px] ${isDefault ? 'border-white bg-white text-olive' : 'border-white/90 text-transparent'}`}
                  >
                    {isSetting ? (
                      <LoaderCircle size={11} className="animate-spin text-white" aria-hidden="true" />
                    ) : (
                      <Check size={11} strokeWidth={3.5} aria-hidden="true" />
                    )}
                  </span>
                  기본 이미지로 설정
                </button>
              )}
              </div>
            );
          })}
        </div>
      ) : (
        <p className="rounded-xl bg-paper p-4 text-center text-xs leading-relaxed text-muted">
          {emptyText}
        </p>
      )}
      {viewing !== null && images[viewing] && (
        <ExampleViewer
          images={images}
          index={viewing}
          onIndex={setViewing}
          onClose={() => setViewing(null)}
          hidden={hidden}
          reveal={reveal}
        />
      )}
    </section>
  );
}

function ExampleViewer({
  images,
  index,
  onIndex,
  onClose,
  hidden,
  reveal,
}: {
  images: CivitaiImage[];
  index: number;
  onIndex: (i: number) => void;
  onClose: () => void;
  hidden: (i: number) => boolean;
  reveal: (i: number) => void;
}) {
  const { connection, info, settings, setSettings, notify } = useStudio();
  const navigate = useNavigate();
  const id = useId();
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const [zIndex, setZIndex] = useState<number | null>(null);
  const image = images[index];
  const video = isVideoMedia(image);
  const isHidden = hidden(index);
  const go = (dir: 1 | -1) => onIndex((index + dir + images.length) % images.length);
  const latest = useRef({ go, onClose });
  latest.current = { go, onClose };
  // Bring this example's prompt, Seed, size and sampling values into the create form.
  function remix() {
    const { settings: next, applied } = remixSettings(
      settings,
      image.meta,
      { width: image.width, height: image.height },
      {
        samplers: options(info, 'KSampler', 'sampler_name'),
        schedulers: options(info, 'KSampler', 'scheduler'),
      },
    );
    if (!applied.length) return;
    setSettings(next);
    notify(`예시의 ${applied.join(', ')} 값을 가져왔어요 | 모델과 LoRA는 지금 설정을 사용해요`);
    onClose();
    navigate('/create');
  }

  // Join the shared modal stack so Escape closes this viewer before the detail modal.
  useEffect(() => {
    setZIndex(pushModal(id));
    const previous = document.activeElement;
    window.setTimeout(() => closeRef.current?.focus(), 0);
    const onKey = (e: KeyboardEvent) => {
      if (!isTopModal(id)) return;
      if (e.key === 'Escape') {
        e.stopPropagation();
        latest.current.onClose();
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        const target = e.target as HTMLElement | null;
        if (target?.closest('input, textarea, select')) return;
        e.preventDefault();
        latest.current.go(e.key === 'ArrowLeft' ? -1 : 1);
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      popModal(id);
      if (previous instanceof HTMLElement && document.contains(previous)) previous.focus();
    };
  }, [id]);

  const navButton =
    'absolute top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-white/15 text-white backdrop-blur-md transition hover:bg-white/30';
  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`예시 이미지 ${index + 1} / ${images.length}`}
      className="fixed inset-0 flex flex-col bg-neutral-950/[0.97] lg:flex-row"
      style={{ zIndex: zIndex ?? 1100 }}
    >
      <div
        className="relative flex min-h-0 flex-1 items-center justify-center p-3 sm:p-6"
        onClick={(e) => {
          if (e.target === e.currentTarget) onClose();
        }}
      >
        <span className="absolute left-4 top-4 rounded-full bg-black/55 px-3 py-1 font-mono text-2xs text-white/85">
          {index + 1} / {images.length}
        </span>
        {isHidden ? (
          <button
            type="button"
            onClick={() => reveal(index)}
            className="flex flex-col items-center gap-2 rounded-xl bg-white/10 px-6 py-5 text-sm font-semibold text-white hover:bg-white/20"
          >
            <EyeOff size={22} aria-hidden="true" />
            민감한 이미지 보기
          </button>
        ) : video ? (
          <video
            key={image.url}
            src={civitaiMediaUrl(connection.base, image.url, 'full', true)}
            controls
            autoPlay
            loop
            playsInline
            className="max-h-full max-w-full object-contain"
          />
        ) : (
          <img
            key={image.url}
            src={civitaiMediaUrl(connection.base, image.url, 'full')}
            alt={`예시 이미지 ${index + 1}`}
            draggable={false}
            className="max-h-full max-w-full select-none object-contain"
          />
        )}
        {images.length > 1 && (
          <>
            <button
              type="button"
              aria-label="이전 이미지"
              onClick={() => go(-1)}
              className={`${navButton} left-3`}
            >
              <ChevronLeft size={22} aria-hidden="true" />
            </button>
            <button
              type="button"
              aria-label="다음 이미지"
              onClick={() => go(1)}
              className={`${navButton} right-3`}
            >
              <ChevronRight size={22} aria-hidden="true" />
            </button>
          </>
        )}
        <button
          ref={closeRef}
          type="button"
          aria-label="예시 이미지 닫기"
          onClick={onClose}
          className="absolute right-4 top-4 flex h-10 w-10 items-center justify-center rounded-full bg-white/20 text-white backdrop-blur-md hover:bg-white/35"
        >
          <X size={19} aria-hidden="true" />
        </button>
      </div>
      <aside
        aria-label="생성 정보"
        className="max-h-[42dvh] shrink-0 overflow-y-auto bg-white p-4 lg:max-h-none lg:w-[360px]"
      >
        <GenerationData
          meta={image.meta}
          width={image.width}
          height={image.height}
          onRemix={remix}
        />
      </aside>
    </div>,
    document.body,
  );
}

function GenerationData({
  meta,
  width,
  height,
  onRemix,
}: {
  meta?: CivitaiImageMeta | null;
  width?: number;
  height?: number;
  onRemix: () => void;
}) {
  const rows = metaRows(meta, width, height);
  const resources = metaResources(meta);
  const prompt = text(meta?.prompt);
  const negative = text(meta?.negativePrompt);
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">생성 정보</h3>
        {prompt && (
          <button type="button" className="btn-primary" onClick={onRemix}>
            <Wand2 size={14} aria-hidden="true" />
            이 설정으로 만들기
          </button>
        )}
      </div>
      {!prompt && !negative && rows.length <= 1 && !resources.length && (
        <p className="rounded-lg bg-paper p-3 text-xs leading-relaxed text-muted">
          이 이미지에는 작성자가 남긴 생성 정보가 없어요
        </p>
      )}
      {resources.length > 0 && (
        <Block title="사용 리소스">
          <ul className="flex flex-col gap-1.5">
            {resources.map((r, i) => (
              <li
                key={`${r.name}-${i}`}
                className="flex items-center justify-between gap-2 rounded-lg bg-paper px-3 py-2 text-xs"
              >
                <span className="min-w-0 [overflow-wrap:anywhere]">{r.name}</span>
                <span className="flex shrink-0 items-center gap-1">
                  {r.type && <span className="chip uppercase">{r.type}</span>}
                  {r.weight !== undefined && <span className="chip font-mono">{r.weight}</span>}
                </span>
              </li>
            ))}
          </ul>
        </Block>
      )}
      {prompt && <PromptBlock title="프롬프트" value={prompt} />}
      {negative && <PromptBlock title="네거티브 프롬프트" value={negative} />}
      {rows.length > 0 && (
        <Block title="기타 정보">
          <dl className="flex flex-wrap gap-1.5">
            {rows.map(([label, value]) => (
              <div
                key={label}
                className="flex min-w-0 items-center gap-1.5 rounded-md bg-paper px-2.5 py-1.5 text-xs"
              >
                <dt className="font-semibold text-muted">{label}</dt>
                <dd className="min-w-0 font-mono [overflow-wrap:anywhere]">{value}</dd>
              </div>
            ))}
          </dl>
        </Block>
      )}
    </div>
  );
}

function Block({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex min-h-8 items-center justify-between gap-2">
        <h4 className="text-xs font-semibold">{title}</h4>
        {action}
      </div>
      {children}
    </div>
  );
}

function PromptBlock({ title, value }: { title: string; value: string }) {
  const { notify } = useStudio();
  return (
    <Block
      title={title}
      action={
        <IconButton
          icon={Copy}
          label={`${title} 복사`}
          onClick={() => {
            navigator.clipboard
              ?.writeText(value)
              .then(() => notify(`${title}를 복사했어요`))
              .catch(() => notify('클립보드 권한을 확인해 주세요'));
          }}
        />
      }
    >
      <p className="max-h-48 overflow-y-auto whitespace-pre-wrap rounded-lg bg-paper p-3 text-xs leading-relaxed [overflow-wrap:anywhere]">
        {value}
      </p>
    </Block>
  );
}

function text(v: unknown): string {
  return typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : '';
}

function hasGenerationData(meta?: CivitaiImageMeta | null): boolean {
  return Boolean(meta && (text(meta.prompt) || text(meta.sampler) || text(meta.seed)));
}

// CivitAI shows these as "other metadata"; the first matching key wins for each row.
const META_FIELDS: [string, string[]][] = [
  ['CFG', ['cfgScale', 'cfg']],
  ['Guidance', ['Distilled CFG Scale', 'guidance', 'Guidance']],
  ['Steps', ['steps']],
  ['Sampler', ['sampler']],
  ['Scheduler', ['scheduler', 'Schedule type']],
  ['Seed', ['seed']],
  ['Clip skip', ['clipSkip', 'Clip skip']],
  ['Denoise', ['denoise', 'Denoising strength']],
  ['모델', ['Model']],
];

function metaRows(
  meta: CivitaiImageMeta | null | undefined,
  width?: number,
  height?: number,
): [string, string][] {
  const rows: [string, string][] = [];
  for (const [label, keys] of META_FIELDS) {
    const value = keys.map((k) => text(meta?.[k])).find(Boolean);
    if (value) rows.push([label, value]);
  }
  const size = text(meta?.Size) || (width && height ? `${width}x${height}` : '');
  if (size) rows.push(['크기', size.replace('x', ' × ')]);
  return rows;
}

function metaResources(meta?: CivitaiImageMeta | null) {
  const out: { name: string; type?: string; weight?: number }[] = [];
  for (const r of meta?.resources || []) {
    if (text(r?.name)) out.push({ name: text(r.name), type: r.type, weight: r.weight });
  }
  if (!out.length) {
    for (const r of meta?.civitaiResources || []) {
      if (text(r?.modelVersionName))
        out.push({ name: text(r.modelVersionName), type: r.type, weight: r.weight });
    }
  }
  return out;
}
