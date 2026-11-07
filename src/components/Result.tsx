import { useState } from 'react';
import {
  Download,
  RotateCcw,
  Image,
  ArrowUpRight,
  Clock3,
  Pin,
  Sparkles,
  Maximize2,
  Share2,
  Star,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { type Job } from '../domain';
import { imageUrl } from '../api';
import { useStudio } from '../studio';
import { calculateRemainingEstimate } from '../estimate';
import { IconButton, Spinner } from './ui';
import { ImageViewer } from './ImageViewer';
export function Result({ job, compact = false }: { job?: Job; compact?: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const [imageFailed, setImageFailed] = useState(false);
  const [imageRetry, setImageRetry] = useState(0);
  const [cancelling, setCancelling] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const {
    setSettings,
    notify,
    cancel,
    generate,
    busy,
    livePreviewUrl,
    pinSeed,
    generateVariation,
    generateUpscale,
    shareImage,
    toggleFavorite,
    jobs,
    clientQueue,
    info,
  } = useStudio();
  const hasUpscaler = info ? Object.keys(info).some((k) => k.toLowerCase().includes('upscale')) : false;
  const active = job && ['submitting', 'queued', 'running'].includes(job.status);
  const estimate = active && job ? calculateRemainingEstimate(jobs, job, clientQueue.length) : null;
  const previewImg = active && job?.status === 'running' ? (job.livePreview || livePreviewUrl) : null;
  const source =
    job?.status === 'complete' && job.images[0]
      ? job.preview
        ? '/sample.svg'
        : imageUrl(job.base, job.images[0])
      : '/sample.svg';
  const reuse = () => {
    if (job) {
      setSettings(structuredClone(job.settings));
      notify('생성 설정을 불러왔어요');
    }
  };
  const labels = {
    submitting: '요청을 보내고 있어요',
    queued: '서버에서 순서를 기다려요',
    running: '이미지를 만들고 있어요',
    complete: '생성 완료',
    error: '생성을 다시 확인해 주세요',
    cancelled: '대기 취소됨',
  };
  return (
    <div className={`flex min-w-0 flex-col ${compact ? '' : 'gap-5'}`}>
      {!compact && (
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">{job ? '최근 생성' : '결과 미리보기'}</h2>
          <span className="flex items-center gap-1.5 text-xs text-muted">
            <Clock3 size={13} />
            {job
              ? new Date(job.createdAt).toLocaleTimeString('ko-KR', {
                  hour: '2-digit',
                  minute: '2-digit',
                })
              : '나만의 장면을 기다리는 중'}
          </span>
        </div>
      )}
      <div
        className={`group relative overflow-hidden rounded-2xl bg-[#d9dfd3] ${compact ? 'aspect-[4/3]' : 'aspect-[3/4] max-h-[540px]'} ${!active && !imageFailed ? 'cursor-zoom-in' : ''}`}
        onClick={() => {
          if (!active && !imageFailed) setExpanded(true);
        }}
        onKeyDown={(e) => {
          if (!active && !imageFailed && (e.key === 'Enter' || e.key === ' ')) {
            e.preventDefault();
            setExpanded(true);
          }
        }}
        role={!active && !imageFailed ? 'button' : undefined}
        tabIndex={!active && !imageFailed ? 0 : undefined}
        aria-label={!active && !imageFailed ? '이미지 크게 보기' : undefined}
      >
        <img
          key={previewImg ? 'live-preview' : `${source}-${imageRetry}`}
          src={
            previewImg ||
            source + (imageRetry ? `${source.includes('?') ? '&' : '?'}retry=${imageRetry}` : '')
          }
          alt={
            job?.status === 'complete' && !job.preview
              ? '생성한 이미지'
              : previewImg
                ? '실시간 생성 미리보기'
                : '우아한 성인 여성 인물을 담은 샘플 일러스트'
          }
          onError={() => {
            if (!previewImg) setImageFailed(true);
          }}
          onLoad={() => setImageFailed(false)}
          className={`h-full w-full object-cover transition-all duration-700 ${
            previewImg
              ? 'opacity-95'
              : active
                ? 'scale-105 opacity-35 blur-sm'
                : 'group-hover:scale-[1.02]'
          }`}
        />
        {previewImg && (
          <span className="absolute left-4 top-4 rounded-full bg-olive px-3 py-1.5 text-[11px] font-semibold text-white shadow-sm animate-pulse">
            실시간 생성 중
          </span>
        )}
        {(!job || job.preview) && !previewImg && (
          <span className="absolute left-4 top-4 rounded-full bg-white/90 px-3 py-1.5 text-[11px] font-semibold text-ink shadow-sm">
            {job ? '미리보기 체험' : '샘플 일러스트'}
          </span>
        )}
        {active && (
          <div
            className={`absolute inset-0 flex flex-col items-center justify-center gap-4 p-6 ${previewImg ? 'bg-black/30 backdrop-blur-[2px]' : ''}`}
            onClick={(e) => e.stopPropagation()}
          >
            <span className="flex h-14 w-14 items-center justify-center rounded-full bg-white/90 shadow-md">
              <Spinner />
            </span>
            <div className={`flex flex-col items-center gap-2 ${previewImg ? 'rounded-2xl bg-white/85 px-6 py-3 shadow-lg backdrop-blur-md' : ''}`}>
              <p className="text-center text-sm font-semibold">{labels[job!.status]}</p>
              <p className="font-mono text-3xl font-bold">{job!.progress}%</p>
              <div className="h-1.5 w-36 overflow-hidden rounded-full bg-ink/15">
                <div
                  className="h-full rounded-full bg-olive transition-all"
                  style={{ width: `${job!.progress}%` }}
                />
              </div>
              {estimate && (
                <div className="flex flex-col items-center gap-0.5 text-xs text-ink/80 font-medium">
                  <span>약 {estimate.remainingSeconds}초 남음</span>
                  {estimate.queueAheadCount > 0 && (
                    <span className="text-[11px] text-muted">
                      대기열 앞 {estimate.queueAheadCount}개 작업
                    </span>
                  )}
                </div>
              )}
            </div>
            {(job!.status === 'queued' || job!.preview) && (
              <button
                disabled={cancelling}
                className="btn-secondary mt-2"
                onClick={async () => {
                  setCancelling(true);
                  try {
                    await cancel(job!);
                  } finally {
                    setCancelling(false);
                  }
                }}
              >
                {cancelling && <Spinner />}대기 취소
              </button>
            )}
            {job!.error && (
              <p role="status" className="rounded-lg bg-white p-2 text-center text-xs text-red-700">
                연결 복구를 기다리고 있어요
              </p>
            )}
          </div>
        )}
        {imageFailed && !active && (
          <div
            className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-paper p-5 text-center"
            onClick={(e) => e.stopPropagation()}
          >
            <Image size={26} />
            <p className="text-sm">이미지를 불러오려면 서버 연결을 확인해 주세요</p>
            <button
              className="btn-secondary"
              onClick={() => {
                setImageFailed(false);
                setImageRetry((n) => n + 1);
              }}
            >
              이미지 다시 불러오기
            </button>
          </div>
        )}
        {!job && !compact && (
          <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-[#172921]/85 to-transparent px-6 pb-6 pt-16 text-white">
            <p className="font-display text-[28px] leading-tight">
              상상은 가볍게
              <br />
              디테일은 원하는 만큼
            </p>
            <p className="mt-3 text-xs text-white/85">프롬프트에서 나만의 장면이 시작돼요</p>
          </div>
        )}
      </div>
      {job && !compact && (
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className={`text-sm font-semibold ${job.status === 'error' ? 'text-red-700' : ''}`}>
              {labels[job.status]}
            </p>
            <span className="font-mono text-xs text-muted">
              {job.settings.width} × {job.settings.height} | {job.settings.steps} steps
            </span>
          </div>
          {job.error && (
            <p className="whitespace-pre-wrap rounded-xl bg-red-50 p-3 text-xs leading-relaxed text-red-800 [overflow-wrap:anywhere]">
              {job.error}
            </p>
          )}
          {['error', 'cancelled'].includes(job.status) && (
            <button
              disabled={regenerating || busy}
              className="btn-secondary"
              onClick={async () => {
                setRegenerating(true);
                try {
                  await generate(job.settings);
                } finally {
                  setRegenerating(false);
                }
              }}
            >
              {regenerating ? <Spinner /> : null}이 설정으로 다시 생성
            </button>
          )}
          {job.status === 'complete' && (
            <>
              <div className="flex flex-wrap gap-2">
                <Link to="/create" onClick={reuse} className="btn-secondary flex-1 min-w-[130px]">
                  <RotateCcw size={15} />
                  설정 재사용
                </Link>
                <button
                  className={`btn-secondary flex-1 min-w-[130px] ${job.favorite ? 'text-amber-700 border-amber-300 bg-amber-50/60' : ''}`}
                  onClick={() => toggleFavorite(job.id)}
                >
                  <Star size={15} className={job.favorite ? 'fill-amber-400 text-amber-500' : ''} />
                  {job.favorite ? '즐겨찾기 됨' : '즐겨찾기'}
                </button>
                <button
                  className="btn-secondary flex-1 min-w-[130px]"
                  onClick={() => pinSeed(job.settings.seed)}
                >
                  <Pin size={15} />
                  이 Seed 고정
                </button>
                <button
                  className="btn-secondary flex-1 min-w-[130px]"
                  onClick={() => generateVariation(job)}
                >
                  <Sparkles size={15} />
                  변형 생성
                </button>
                {hasUpscaler && (
                  <button
                    className="btn-secondary flex-1 min-w-[130px]"
                    onClick={() => generateUpscale(job)}
                  >
                    <Maximize2 size={15} />
                    업스케일
                  </button>
                )}
                <button
                  className="btn-secondary flex-1 min-w-[130px]"
                  onClick={() => void shareImage(job)}
                >
                  <Share2 size={15} />
                  공유
                </button>
                <a
                  className="btn-secondary flex-1 min-w-[130px]"
                  href={source}
                  download={job.preview ? 'sample.svg' : job.images[0]?.filename}
                  target="_blank"
                  rel="noreferrer"
                >
                  <Download size={15} />
                  이미지 저장
                </a>
              </div>
              {job.images.length > 1 && (
                <div className="flex flex-wrap gap-2">
                  {job.images.map((im, i) => (
                    <a
                      key={`${im.filename}-${i}`}
                      href={job.preview ? '/sample.svg' : imageUrl(job.base, im)}
                      target="_blank"
                      rel="noreferrer"
                      className="btn-secondary text-xs"
                    >
                      <ArrowUpRight size={14} />
                      이미지 {i + 1}
                    </a>
                  ))}
                </div>
              )}
              <div className="rounded-xl bg-stone p-4">
                <p className="line-clamp-3 text-xs leading-relaxed text-muted">
                  {job.settings.workflow ? '가져온 API 워크플로' : job.settings.positive}
                </p>
                <p className="mt-2 font-mono text-[11px] text-muted">Seed {job.settings.seed}</p>
              </div>
            </>
          )}
        </div>
      )}
      <ImageViewer
        src={source}
        alt={
          job?.status === 'complete' && !job.preview
            ? '생성한 이미지'
            : '우아한 성인 여성 인물을 담은 샘플 일러스트'
        }
        open={expanded}
        onClose={() => setExpanded(false)}
      />
    </div>
  );
}
