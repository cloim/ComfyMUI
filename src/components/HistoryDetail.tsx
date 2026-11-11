import { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { Job } from '../domain';
import { Result } from './Result';

export function HistoryDetail({
  job,
  index,
  count,
  onNavigate,
}: {
  job: Job;
  index: number;
  count: number;
  onNavigate: (direction: -1 | 1) => void;
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
          <Result key={job.id} job={job} />
        </div>
      </div>
    </div>
  );
}
