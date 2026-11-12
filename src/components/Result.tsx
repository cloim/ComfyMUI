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
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { type Generation, type Job, reusableSettings } from '../domain';
import { classifyJobError, jobStageLabel, lowerMemorySettings } from '../job-recovery';
import { imageUrl } from '../api';
import { useStudio } from '../studio';
import { calculateRemainingEstimate, jobsAhead } from '../estimate';
import { IconButton, Spinner, Modal } from './ui';
import { ImageViewer } from './ImageViewer';
import { UpscaleDialog } from './UpscaleDialog';
// `fallback` is the latest completed job, shown while `job` has no image yet (running, failed or cancelled).
export function Result({
  job,
  fallback,
  compact = false,
}: {
  job?: Job;
  fallback?: Job;
  compact?: boolean;
}) {
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
    jobs,
    clientQueue,
    info,
    reconnect,
    checkSubmission,
  } = useStudio();
  const [upscaling, setUpscaling] = useState(false);
  const [plan, setPlan] = useState<{
    title: string;
    settings: Generation;
    warning: string;
    uncertain?: boolean;
  } | null>(null);
  const active = job && ['submitting', 'queued', 'running'].includes(job.status);
  const queuedCount = job ? jobsAhead(jobs, job).length : 0;
  const estimate = active && job ? calculateRemainingEstimate(jobs, job, queuedCount) : null;
  const recovery = classifyJobError(job?.error || '');
  async function retry() {
    if (!job || busy || regenerating) return;
    setRegenerating(true);
    try {
      if (job.submissionUncertain) {
        if (!(await checkSubmission(job)))
          setPlan({
            title: '새 요청으로 다시 생성',
            settings: { ...reusableSettings(job.settings), random: false },
            warning:
              '기존 요청이 이미 완료됐거나 서버에 남아 있을 수 있어요. 기록을 확인한 뒤 새 요청을 보내세요. 중복 생성될 수 있어요',
            uncertain: true,
          });
      } else await generate(job.settings);
    } catch (error) {
      notify((error as Error).message);
    } finally {
      setRegenerating(false);
    }
  }
  const previewImg = active ? job?.livePreview || livePreviewUrl || null : null;
  const hasImage = (j?: Job): j is Job => j?.status === 'complete' && Boolean(j.images[0]);
  const shown = hasImage(job) ? job : hasImage(fallback) ? fallback : undefined;
  const showingFallback = Boolean(shown && shown !== job);
  const source = shown ? imageUrl(shown.base, shown.images[0]) : '';
  const generatedImage = Boolean(shown);
  const canExpand = !active && !imageFailed && generatedImage;
  const frameRatio = shown
    ? `${shown.settings.width} / ${shown.settings.height}`
    : compact
      ? '4 / 3'
      : '3 / 4';
  const reuse = () => {
    if (job) {
      setSettings(reusableSettings(job.settings));
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
    <div className={`flex min-w-0 flex-col ${compact ? '' : 'gap-3.5'}`}>
      {!compact && (
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-bold">{job ? '최근 생성' : '생성 결과'}</h2>
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
        style={{ aspectRatio: frameRatio }}
        className={`group relative overflow-hidden rounded-xl bg-[#d9dfd3] ${compact ? '' : 'max-h-[480px]'} ${canExpand ? 'cursor-zoom-in' : ''}`}
        onClick={() => {
          if (canExpand) setExpanded(true);
        }}
        onKeyDown={(e) => {
          if (canExpand && (e.key === 'Enter' || e.key === ' ')) {
            e.preventDefault();
            setExpanded(true);
          }
        }}
        role={canExpand ? 'button' : undefined}
        tabIndex={canExpand ? 0 : undefined}
        aria-label={canExpand ? '이미지 크게 보기' : undefined}
      >
        {!previewImg && !source && (
          <div className="absolute inset-0 flex items-center justify-center p-4 text-center text-xs text-muted">
            아직 생성한 이미지가 없어요
          </div>
        )}
        {(previewImg || source) && (
          <img
            key={previewImg ? 'live-preview' : `${source}-${imageRetry}`}
            src={
              previewImg ||
              source + (imageRetry ? `${source.includes('?') ? '&' : '?'}retry=${imageRetry}` : '')
            }
            alt={
              previewImg
                ? '실시간 생성 미리보기'
                : showingFallback
                  ? '직전에 생성한 이미지'
                  : '생성한 이미지'
            }
            onError={() => {
              if (!previewImg) setImageFailed(true);
            }}
            onLoad={() => setImageFailed(false)}
            className={`h-full w-full object-contain transition-opacity duration-700 ${
              previewImg ? 'opacity-95' : active ? 'opacity-35 blur-sm' : ''
            }`}
          />
        )}
        {previewImg && (
          <span className="absolute left-3 top-3 rounded-full bg-olive px-2.5 py-1 text-2xs font-semibold text-white shadow-sm animate-pulse">
            실시간 생성 중
          </span>
        )}
        {!previewImg && !active && showingFallback && (
          <span className="absolute left-3 top-3 rounded-full bg-white/90 px-2.5 py-1 text-2xs font-semibold text-ink shadow-sm">
            직전 생성 이미지
          </span>
        )}
        {active && (
          <div
            className={`absolute inset-0 flex flex-col items-center justify-center gap-3 p-4 ${previewImg ? 'bg-black/30 backdrop-blur-[2px]' : ''}`}
            onClick={(e) => e.stopPropagation()}
          >
            <span className="flex h-11 w-11 items-center justify-center rounded-full bg-white/90 shadow-md">
              <Spinner />
            </span>
            <div
              className={`flex flex-col items-center gap-1.5 ${previewImg ? 'rounded-xl bg-white/85 px-4 py-2.5 shadow-lg backdrop-blur-md' : ''}`}
            >
              <p className="text-center text-xs font-semibold">{jobStageLabel(job!)}</p>
              <p className="font-mono text-base font-bold">{job!.progress}%</p>
              <div className="h-1.5 w-32 overflow-hidden rounded-full bg-ink/15">
                <div
                  className="h-full rounded-full bg-olive transition-all"
                  style={{ width: `${job!.progress}%` }}
                />
              </div>
              {estimate && (
                <div className="flex flex-col items-center gap-0.5 text-xs text-ink/80 font-medium">
                  <span>
                    {job!.status === 'queued' ? '생성 예상' : '약'} {estimate.minSeconds}~
                    {estimate.maxSeconds}초
                    {job!.status === 'queued' ? ' (대기 시간 제외)' : ' 남음'}
                  </span>
                  <span className="text-2xs text-muted">
                    최근 {estimate.sampleCount}건 기준
                    {estimate.confidence === 'low'
                      ? ' · 표본이 적어요'
                      : ' · 모델 준비에 따라 달라져요'}
                  </span>
                </div>
              )}
              {!estimate && (
                <span className="text-2xs text-muted">
                  {job!.settings.workflow || job!.settings.upscale
                    ? '이 작업은 예상 시간을 제공하지 않아요'
                    : '예상 시간을 계산할 기록이 부족해요'}
                </span>
              )}
              {queuedCount > 0 && (
                <span className="text-2xs text-muted">
                  앞에 이 앱의 작업 {queuedCount}개 · 다른 작업도 있을 수 있어요
                </span>
              )}
            </div>
            {job!.status === 'queued' && (
              <button
                disabled={cancelling}
                className="btn-secondary mt-1"
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
            className="absolute inset-0 flex flex-col items-center justify-center gap-2.5 bg-paper p-4 text-center"
            onClick={(e) => e.stopPropagation()}
          >
            <Image size={22} />
            <p className="text-xs">이미지를 불러오려면 서버 연결을 확인해 주세요</p>
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
        {!shown && !job && !compact && (
          <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-[#172921]/85 to-transparent px-4 pb-4 pt-12 text-white">
            <p className="font-display text-base font-bold leading-snug">
              상상은 가볍게
              <br />
              디테일은 원하는 만큼
            </p>
            <p className="mt-1.5 text-xs text-white/85">프롬프트에서 나만의 장면이 시작돼요</p>
          </div>
        )}
      </div>
      {job && !compact && (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className={`text-xs font-semibold ${job.status === 'error' ? 'text-red-700' : ''}`}>
              {labels[job.status]}
            </p>
            <span className="font-mono text-xs text-muted">
              {job.settings.upscale
                ? `업스케일 ${job.settings.upscale.sourceWidth} × ${job.settings.upscale.sourceHeight} → `
                : ''}
              {job.settings.width} × {job.settings.height}
              {!job.settings.upscale && ` | ${job.settings.steps} steps`}
            </span>
          </div>
          {job.error && (
            <p className="whitespace-pre-wrap rounded-lg bg-red-50 p-2.5 text-xs leading-relaxed text-red-800 [overflow-wrap:anywhere]">
              {job.error}
            </p>
          )}
          {job.status === 'error' &&
            recovery === 'memory' &&
            !job.settings.workflow &&
            !job.settings.upscale && (
              <button
                className="btn-secondary"
                disabled={busy || regenerating}
                onClick={() =>
                  setPlan({
                    title: '해상도 낮춰 재시도',
                    settings: lowerMemorySettings(job.settings),
                    warning:
                      '해상도를 줄이고 배치 수를 1로 바꿔 메모리 사용을 줄여요. Seed와 프롬프트는 유지해요',
                  })
                }
              >
                해상도 낮춰 재시도
              </button>
            )}
          {job.status === 'error' && recovery === 'model' && (
            <Link
              className="btn-secondary"
              to="/create"
              onClick={() => {
                setSettings(reusableSettings(job.settings));
                reconnect();
              }}
            >
              모델·설치 목록 다시 확인
            </Link>
          )}
          {job.status === 'error' && recovery === 'connection' && !job.submissionUncertain && (
            <Link className="btn-secondary" to="/settings" onClick={reconnect}>
              연결 설정 확인
            </Link>
          )}
          {job.submissionUncertain && (
            <button
              className="btn-secondary"
              disabled={busy || regenerating}
              onClick={async () => {
                setRegenerating(true);
                try {
                  await checkSubmission(job);
                } catch {
                  /* The connection error is shown by the store. */
                } finally {
                  setRegenerating(false);
                }
              }}
            >
              {regenerating && <Spinner />}서버 작업 확인
            </button>
          )}
          {['error', 'cancelled'].includes(job.status) && (
            <button
              disabled={regenerating || busy}
              className="btn-secondary"
              onClick={() => void retry()}
            >
              {regenerating ? <Spinner /> : null}이 설정으로 다시 생성
            </button>
          )}
          {job.status === 'complete' && (
            <>
              <div className="flex flex-wrap gap-1.5">
                <Link to="/create" onClick={reuse} className="btn-secondary flex-1 min-w-[112px]">
                  <RotateCcw size={14} />
                  설정 재사용
                </Link>
                <button
                  className="btn-secondary flex-1 min-w-[112px]"
                  onClick={() => pinSeed(job.settings.seed)}
                >
                  <Pin size={14} />이 Seed 고정
                </button>
                <button
                  className="btn-secondary flex-1 min-w-[112px]"
                  onClick={() => generateVariation(job)}
                >
                  <Sparkles size={14} />
                  변형 생성
                </button>
                <button
                  className="btn-secondary flex-1 min-w-[112px]"
                  onClick={() => setUpscaling(true)}
                >
                  <Maximize2 size={14} />
                  업스케일
                </button>
                <button
                  className="btn-secondary flex-1 min-w-[112px]"
                  onClick={() => void shareImage(job)}
                >
                  <Share2 size={14} />
                  공유
                </button>
                <a
                  className="btn-secondary flex-1 min-w-[112px]"
                  href={source}
                  download={job.images[0]?.filename}
                  target="_blank"
                  rel="noreferrer"
                >
                  <Download size={14} />
                  이미지 저장
                </a>
              </div>
              {job.images.length > 1 && (
                <div className="flex flex-wrap gap-1.5">
                  {job.images.map((im, i) => (
                    <a
                      key={`${im.filename}-${i}`}
                      href={imageUrl(job.base, im)}
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
              <div className="rounded-lg bg-stone p-3">
                <p className="line-clamp-3 text-xs leading-relaxed text-muted">
                  {job.settings.workflow ? '가져온 API 워크플로' : job.settings.positive}
                </p>
                <p className="mt-1.5 font-mono text-2xs text-muted">Seed {job.settings.seed}</p>
              </div>
            </>
          )}
        </div>
      )}
      {job?.status === 'complete' && (
        <UpscaleDialog job={job} open={upscaling} onClose={() => setUpscaling(false)} />
      )}
      <Modal
        title={plan?.title || '생성 설정 확인'}
        open={Boolean(plan)}
        onClose={() => {
          if (!regenerating) setPlan(null);
        }}
        footer={
          <>
            <button className="btn-secondary" disabled={regenerating} onClick={() => setPlan(null)}>
              취소
            </button>
            <button
              className="btn-primary"
              disabled={regenerating || busy}
              onClick={async () => {
                if (!plan || regenerating || busy) return;
                setRegenerating(true);
                try {
                  if (plan.uncertain && job && (await checkSubmission(job))) {
                    setPlan(null);
                    return;
                  }
                  await generate(plan.settings);
                  setPlan(null);
                } catch (error) {
                  notify((error as Error).message);
                } finally {
                  setRegenerating(false);
                }
              }}
            >
              {regenerating && <Spinner />}확인하고 생성
            </button>
          </>
        }
      >
        {plan && (
          <div className="flex flex-col gap-3 text-xs leading-relaxed">
            <p>{plan.warning}</p>
            <dl className="grid grid-cols-2 gap-2 rounded-xl bg-paper p-4">
              <dt>해상도</dt>
              <dd className="text-right font-mono">
                {job?.settings.width} × {job?.settings.height} → {plan.settings.width} ×{' '}
                {plan.settings.height}
              </dd>
              <dt>Steps</dt>
              <dd className="text-right font-mono">
                {job?.settings.steps} → {plan.settings.steps}
              </dd>
              <dt>배치 수</dt>
              <dd className="text-right font-mono">
                {job?.settings.batch} → {plan.settings.batch}
              </dd>
              <dt>Seed</dt>
              <dd className="break-all text-right font-mono">{plan.settings.seed}</dd>
            </dl>
          </div>
        )}
      </Modal>
      <ImageViewer
        src={source}
        alt="생성한 이미지"
        open={expanded}
        onClose={() => setExpanded(false)}
      />
    </div>
  );
}
