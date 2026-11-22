import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { imageUrl } from '../api';
import type { Job } from '../domain';
import { formatBytes } from '../lora-manager';
import { Result } from './Result';

export function HistoryResult({
  job,
  durationMs,
  indexedSize,
  onDelete,
}: {
  job: Job;
  durationMs: number | null;
  indexedSize?: number;
  onDelete: () => void;
}) {
  const image = job.status === 'complete' ? job.images[0] : undefined;
  const hasIndexedSize = indexedSize != null && Number.isFinite(indexedSize) && indexedSize >= 0;
  const sizeUrl = !hasIndexedSize && image ? imageUrl(job.base, image) : '';
  const [measuredSize, setMeasuredSize] = useState<{ url: string; bytes: number | null }>();

  useEffect(() => {
    if (!sizeUrl) return;
    const controller = new AbortController();
    const storeSize = (bytes: number | null) => {
      if (!controller.signal.aborted) setMeasuredSize({ url: sizeUrl, bytes });
    };
    // Direct ComfyUI connections can report the original size without transferring the image.
    fetch(sizeUrl, {
      method: 'HEAD',
      signal: AbortSignal.any([controller.signal, AbortSignal.timeout(5000)]),
    })
      .then((response) => {
        const length = Number(response.headers.get('Content-Length') ?? NaN);
        const isImage = response.headers.get('Content-Type')?.startsWith('image/');
        const encoding = response.headers.get('Content-Encoding');
        storeSize(
          response.ok &&
            isImage &&
            (!encoding || encoding === 'identity') &&
            Number.isSafeInteger(length) &&
            length >= 0
            ? length
            : null,
        );
      })
      .catch(() => storeSize(null));
    return () => controller.abort();
  }, [sizeUrl]);

  const bytes = hasIndexedSize
    ? indexedSize
    : sizeUrl && measuredSize?.url === sizeUrl
      ? measuredSize.bytes
      : undefined;
  const duration =
    durationMs == null
      ? '정보 없음'
      : (durationMs / 1000).toLocaleString('ko-KR', {
          style: 'unit',
          unit: 'second',
          maximumFractionDigits: 1,
        });

  return (
    <Result
      job={job}
      onDelete={onDelete}
      heading={
        <dl className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted">
          <div className="flex items-baseline gap-1.5">
            <dt>생성 소요 시간</dt>
            <dd className="font-semibold text-ink">{duration}</dd>
          </div>
          <div className="flex items-baseline gap-1.5">
            <dt>파일 크기</dt>
            <dd className="font-semibold text-ink">
              {bytes != null
                ? formatBytes(bytes)
                : sizeUrl && bytes === undefined
                  ? '확인 중'
                  : '정보 없음'}
            </dd>
          </div>
        </dl>
      }
    />
  );
}

export function HistoryDetail({
  job,
  index,
  count,
  onNavigate,
  children,
}: {
  job: Job;
  index: number;
  count: number;
  onNavigate: (direction: -1 | 1) => void;
  children: ReactNode;
}) {
  const root = useRef<HTMLDivElement>(null);
  const slide = useRef<HTMLDivElement>(null);
  const gesture = useRef<{ id: number; x: number; y: number } | null>(null);
  const suppressClick = useRef(false);
  const [direction, setDirection] = useState<-1 | 1>(1);
  const canPrevious = index > 0;
  const canNext = index >= 0 && index < count - 1;
  const navigate = (step: -1 | 1) => {
    if (step === -1 ? !canPrevious : !canNext) return;
    setDirection(step);
    onNavigate(step);
  };

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const animation = slide.current?.animate(
      [
        { transform: `translateX(${direction * 32}px)`, opacity: 0.4 },
        { transform: 'translateX(0)', opacity: 1 },
      ],
      { duration: 180, easing: 'ease-out' },
    );
    return () => animation?.cancel();
  }, [job.id, direction]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const dialogs = document.querySelectorAll('[role="dialog"][aria-modal="true"]');
      if (root.current?.closest('[role="dialog"]') !== dialogs[dialogs.length - 1]) return;
      if (
        event.defaultPrevented ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        (event.target instanceof Element &&
          (event.target.closest('input, textarea, select, [contenteditable="true"]') ||
            event.target.matches('.modal-header')))
      )
        return;
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        event.preventDefault();
        event.stopPropagation();
        navigate(event.key === 'ArrowLeft' ? -1 : 1);
      }
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  });

  return (
    <div
      ref={root}
      className="min-w-0"
      onPointerDown={(event) => {
        suppressClick.current = false;
        // Only the result image starts a slide. Actions and nested viewers keep their gestures.
        if (
          !event.isPrimary ||
          event.button !== 0 ||
          !(event.target instanceof HTMLImageElement) ||
          !event.currentTarget.contains(event.target)
        ) {
          gesture.current = null;
          return;
        }
        gesture.current = { id: event.pointerId, x: event.clientX, y: event.clientY };
        event.target.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        const start = gesture.current;
        if (
          start &&
          start.id === event.pointerId &&
          Math.hypot(event.clientX - start.x, event.clientY - start.y) > 10
        ) {
          suppressClick.current = true;
        }
      }}
      onPointerUp={(event) => {
        const start = gesture.current;
        gesture.current = null;
        if (!start || start.id !== event.pointerId) return;
        const dx = event.clientX - start.x;
        const dy = event.clientY - start.y;
        if (Math.abs(dx) >= 50 && Math.abs(dx) > Math.abs(dy) * 1.5) {
          suppressClick.current = true;
          navigate(dx < 0 ? 1 : -1);
        }
      }}
      onPointerCancel={() => {
        gesture.current = null;
      }}
      onClickCapture={(event) => {
        if (suppressClick.current) {
          suppressClick.current = false;
          event.preventDefault();
          event.stopPropagation();
        }
      }}
      onDragStart={(event) => {
        if (event.target instanceof HTMLImageElement) event.preventDefault();
      }}
    >
      <div className="mb-3 flex items-center justify-between gap-3" aria-label="생성 기록 탐색">
        <button
          type="button"
          className="btn-secondary"
          aria-label="이전 이미지"
          disabled={!canPrevious}
          onClick={() => navigate(-1)}
        >
          <ChevronLeft size={16} aria-hidden="true" />
          이전
        </button>
        <span role="status" className="font-mono text-xs text-muted">
          {index >= 0 ? index + 1 : 0} / {count}
        </span>
        <button
          type="button"
          className="btn-secondary"
          aria-label="다음 이미지"
          disabled={!canNext}
          onClick={() => navigate(1)}
        >
          다음
          <ChevronRight size={16} aria-hidden="true" />
        </button>
      </div>
      <div className="overflow-hidden">
        <div ref={slide} className="[&_img]:touch-pan-y [&_img]:touch-pinch-zoom">
          {children}
        </div>
      </div>
    </div>
  );
}
