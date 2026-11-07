import { useState, useRef, useEffect, useCallback } from 'react';
import { X, ArrowLeftRight, Check, AlertCircle } from 'lucide-react';
import type { Job } from '../domain';
import { imageUrl } from '../api';

export type CompareViewerProps = {
  leftJob: Job;
  rightJob: Job;
  onClose: () => void;
};

type SettingDiff = {
  key: string;
  label: string;
  leftVal: string;
  rightVal: string;
  isDiff: boolean;
};

export function CompareViewer({ leftJob, rightJob, onClose }: CompareViewerProps) {
  const [sliderPos, setSliderPos] = useState(50); // 0 to 100 percent
  const [isDragging, setIsDragging] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const leftSrc =
    leftJob.images[0] && !leftJob.preview
      ? imageUrl(leftJob.base, leftJob.images[0])
      : '/sample.svg';
  const rightSrc =
    rightJob.images[0] && !rightJob.preview
      ? imageUrl(rightJob.base, rightJob.images[0])
      : '/sample.svg';

  // Keyboard navigation & ESC to close
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowLeft') setSliderPos((p) => Math.max(0, p - 5));
      if (e.key === 'ArrowRight') setSliderPos((p) => Math.min(100, p + 5));
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  // Pointer drag logic
  const handlePointerMove = useCallback(
    (clientX: number) => {
      if (!containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const x = clientX - rect.left;
      const percent = Math.min(100, Math.max(0, (x / rect.width) * 100));
      setSliderPos(percent);
    },
    [],
  );

  const onMouseDown = () => setIsDragging(true);
  const onTouchStart = () => setIsDragging(true);

  useEffect(() => {
    if (!isDragging) return;
    const onMove = (e: MouseEvent) => handlePointerMove(e.clientX);
    const onTouch = (e: TouchEvent) => {
      if (e.touches[0]) handlePointerMove(e.touches[0].clientX);
    };
    const onEnd = () => setIsDragging(false);

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onEnd);
    window.addEventListener('touchmove', onTouch);
    window.addEventListener('touchend', onEnd);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onEnd);
      window.removeEventListener('touchmove', onTouch);
      window.removeEventListener('touchend', onEnd);
    };
  }, [isDragging, handlePointerMove]);

  // Extract setting diffs
  const diffs: SettingDiff[] = [
    {
      key: 'model',
      label: '모델',
      leftVal: leftJob.settings.model || leftJob.settings.architecture,
      rightVal: rightJob.settings.model || rightJob.settings.architecture,
      isDiff: leftJob.settings.model !== rightJob.settings.model,
    },
    {
      key: 'seed',
      label: 'Seed',
      leftVal: String(leftJob.settings.seed),
      rightVal: String(rightJob.settings.seed),
      isDiff: leftJob.settings.seed !== rightJob.settings.seed,
    },
    {
      key: 'steps',
      label: 'Steps',
      leftVal: String(leftJob.settings.steps),
      rightVal: String(rightJob.settings.steps),
      isDiff: leftJob.settings.steps !== rightJob.settings.steps,
    },
    {
      key: 'cfg',
      label: 'CFG',
      leftVal: String(leftJob.settings.cfg),
      rightVal: String(rightJob.settings.cfg),
      isDiff: leftJob.settings.cfg !== rightJob.settings.cfg,
    },
    {
      key: 'size',
      label: '해상도',
      leftVal: `${leftJob.settings.width} × ${leftJob.settings.height}`,
      rightVal: `${rightJob.settings.width} × ${rightJob.settings.height}`,
      isDiff:
        leftJob.settings.width !== rightJob.settings.width ||
        leftJob.settings.height !== rightJob.settings.height,
    },
    {
      key: 'sampler',
      label: '샘플러',
      leftVal: `${leftJob.settings.sampler} / ${leftJob.settings.scheduler}`,
      rightVal: `${rightJob.settings.sampler} / ${rightJob.settings.scheduler}`,
      isDiff:
        leftJob.settings.sampler !== rightJob.settings.sampler ||
        leftJob.settings.scheduler !== rightJob.settings.scheduler,
    },
    {
      key: 'loras',
      label: 'LoRA',
      leftVal:
        leftJob.settings.loras.map((l) => `${l.name}(${l.model})`).join(', ') || '없음',
      rightVal:
        rightJob.settings.loras.map((l) => `${l.name}(${l.model})`).join(', ') || '없음',
      isDiff:
        JSON.stringify(leftJob.settings.loras) !== JSON.stringify(rightJob.settings.loras),
    },
    {
      key: 'prompt',
      label: '프롬프트',
      leftVal: leftJob.settings.positive,
      rightVal: rightJob.settings.positive,
      isDiff: leftJob.settings.positive.trim() !== rightJob.settings.positive.trim(),
    },
  ];

  const changedDiffs = diffs.filter((d) => d.isDiff);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="결과 이미지 비교 뷰어"
      className="fixed inset-0 z-50 flex flex-col bg-ink/90 backdrop-blur-md text-white select-none"
    >
      {/* Top Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/10 bg-black/40">
        <div className="flex items-center gap-2">
          <ArrowLeftRight size={18} className="text-olive" />
          <h2 className="text-sm font-semibold">이미지 비교 뷰어 (Before & After)</h2>
        </div>
        <button
          onClick={onClose}
          aria-label="비교 뷰어 닫기"
          className="rounded-full p-2 text-white/70 hover:bg-white/10 hover:text-white"
        >
          <X size={20} />
        </button>
      </div>

      {/* Main Split Slider Area */}
      <div className="relative flex-1 flex items-center justify-center p-4 overflow-hidden">
        <div
          ref={containerRef}
          className="relative max-w-4xl w-full h-[60vh] max-h-[700px] rounded-2xl overflow-hidden bg-black/60 shadow-2xl cursor-ew-resize"
          onMouseDown={onMouseDown}
          onTouchStart={onTouchStart}
          onClick={(e) => handlePointerMove(e.clientX)}
        >
          {/* Right Image (Background) */}
          <img
            src={rightSrc}
            alt="비교 대상 B 이미지"
            className="absolute inset-0 w-full h-full object-contain pointer-events-none"
          />

          {/* Left Image (Clipped Overlay) */}
          <div
            className="absolute inset-0 overflow-hidden pointer-events-none"
            style={{ width: `${sliderPos}%` }}
          >
            <img
              src={leftSrc}
              alt="비교 대상 A 이미지"
              className="absolute inset-0 w-full h-full object-contain pointer-events-none"
              style={{
                // Scale width back up to container size so image aligns exactly
                width: containerRef.current?.clientWidth || '100%',
                maxWidth: 'none',
              }}
            />
          </div>

          {/* Slider Line Divider */}
          <div
            className="absolute top-0 bottom-0 w-1 bg-white shadow-[0_0_8px_rgba(0,0,0,0.8)] pointer-events-none"
            style={{ left: `${sliderPos}%` }}
          >
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 flex items-center justify-center w-8 h-8 rounded-full bg-white text-ink shadow-lg font-bold text-xs pointer-events-auto">
              <ArrowLeftRight size={14} />
            </div>
          </div>

          {/* Corner Labels */}
          <div className="absolute top-3 left-3 rounded-md bg-black/70 px-2.5 py-1 text-xs font-semibold text-white/90 backdrop-blur-sm pointer-events-none">
            작업 A (좌)
          </div>
          <div className="absolute top-3 right-3 rounded-md bg-black/70 px-2.5 py-1 text-xs font-semibold text-white/90 backdrop-blur-sm pointer-events-none">
            작업 B (우)
          </div>
        </div>
      </div>

      {/* Bottom Diff Inspector Panel */}
      <div className="border-t border-white/10 bg-black/60 px-4 py-3 max-h-48 overflow-y-auto">
        <div className="max-w-4xl mx-auto flex flex-col gap-2">
          <div className="flex items-center gap-1.5 text-xs text-white/70">
            <AlertCircle size={14} className="text-amber-400" />
            <span className="font-semibold">
              설정 차이점 ({changedDiffs.length}개 항목이 다름):
            </span>
          </div>

          {changedDiffs.length === 0 ? (
            <p className="text-xs text-white/60">두 작업의 생성 설정이 완전히 동일합니다.</p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
              {changedDiffs.map((diff) => (
                <div
                  key={diff.key}
                  className="flex flex-col gap-1 rounded-lg border border-amber-500/40 bg-amber-500/10 p-2 text-xs"
                >
                  <span className="font-semibold text-amber-300">{diff.label}</span>
                  <div className="flex items-center justify-between text-[11px] gap-2">
                    <span className="truncate text-white/80" title={diff.leftVal}>
                      A: {diff.leftVal}
                    </span>
                    <span className="text-amber-400 font-bold shrink-0">vs</span>
                    <span className="truncate text-white/80" title={diff.rightVal}>
                      B: {diff.rightVal}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
