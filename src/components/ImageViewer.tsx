import { useEffect, useRef, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { X, ZoomIn, ZoomOut, RotateCcw } from 'lucide-react';

interface ImageViewerProps {
  src: string;
  alt?: string;
  open: boolean;
  onClose: () => void;
}

const MIN_SCALE = 1;
const MAX_SCALE = 5;
const DOUBLE_TAP_SCALE = 2.5;

export function ImageViewer({ src, alt = '확대된 이미지', open, onClose }: ImageViewerProps) {
  const [scale, setScale] = useState(1);
  const [translate, setTranslate] = useState({ x: 0, y: 0 });
  const [isGesturing, setIsGesturing] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);

  // Gesture tracking refs
  const scaleRef = useRef(1);
  const translateRef = useRef({ x: 0, y: 0 });
  scaleRef.current = scale;
  translateRef.current = translate;

  const dragStartRef = useRef<{ x: number; y: number; tx: number; ty: number } | null>(null);
  const pinchStartRef = useRef<{
    dist: number;
    initialScale: number;
    centerX: number;
    centerY: number;
  } | null>(null);
  const lastTapRef = useRef<{ time: number; x: number; y: number }>({ time: 0, x: 0, y: 0 });
  const movedRef = useRef(false);

  // Reset zoom & pan when opening or closing
  useEffect(() => {
    if (open) {
      setScale(1);
      setTranslate({ x: 0, y: 0 });
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [open, src]);

  // Escape key handler
  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, onClose]);

  // Compute maximum allowable pan limits based on current image rendered dimensions
  const getPanBounds = useCallback((curScale: number) => {
    if (curScale <= 1 || !imgRef.current) {
      return { maxX: 0, maxY: 0 };
    }
    const rect = imgRef.current.getBoundingClientRect();
    // Base unscaled dimensions
    const baseW = rect.width / scaleRef.current;
    const baseH = rect.height / scaleRef.current;
    const scaledW = baseW * curScale;
    const scaledH = baseH * curScale;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const maxX = Math.max(0, (scaledW - vw) / 2 + 30);
    const maxY = Math.max(0, (scaledH - vh) / 2 + 30);
    return { maxX, maxY };
  }, []);

  const clampTranslate = useCallback(
    (x: number, y: number, curScale: number) => {
      const { maxX, maxY } = getPanBounds(curScale);
      return {
        x: Math.max(-maxX, Math.min(maxX, x)),
        y: Math.max(-maxY, Math.min(maxY, y)),
      };
    },
    [getPanBounds],
  );

  const resetZoom = useCallback(() => {
    setScale(1);
    setTranslate({ x: 0, y: 0 });
  }, []);

  const toggleZoom = useCallback(
    (clientX: number, clientY: number) => {
      if (scaleRef.current > 1.2) {
        resetZoom();
      } else {
        const newScale = DOUBLE_TAP_SCALE;
        // Zoom centered around tap/click location
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        const offsetX = (vw / 2 - clientX) * (newScale - 1);
        const offsetY = (vh / 2 - clientY) * (newScale - 1);
        const clamped = clampTranslate(offsetX, offsetY, newScale);
        setScale(newScale);
        setTranslate(clamped);
      }
    },
    [clampTranslate, resetZoom],
  );

  // Native touch listener to prevent default pull-to-refresh & browser pinch while zooming
  useEffect(() => {
    const el = containerRef.current;
    if (!open || !el) return;

    const onTouchMoveNative = (e: TouchEvent) => {
      if (e.touches.length > 1 || scaleRef.current > 1) {
        e.preventDefault();
      }
    };

    el.addEventListener('touchmove', onTouchMoveNative, { passive: false });
    return () => {
      el.removeEventListener('touchmove', onTouchMoveNative);
    };
  }, [open]);

  // Touch Handlers
  const handleTouchStart = (e: React.TouchEvent) => {
    movedRef.current = false;
    if (e.touches.length === 1) {
      const touch = e.touches[0];
      const now = Date.now();
      const distFromLast = Math.hypot(
        touch.clientX - lastTapRef.current.x,
        touch.clientY - lastTapRef.current.y,
      );

      // Check double tap
      if (now - lastTapRef.current.time < 300 && distFromLast < 35) {
        toggleZoom(touch.clientX, touch.clientY);
        lastTapRef.current = { time: 0, x: 0, y: 0 };
        dragStartRef.current = null;
        pinchStartRef.current = null;
        return;
      }
      lastTapRef.current = { time: now, x: touch.clientX, y: touch.clientY };

      if (scaleRef.current > 1) {
        setIsGesturing(true);
        dragStartRef.current = {
          x: touch.clientX,
          y: touch.clientY,
          tx: translateRef.current.x,
          ty: translateRef.current.y,
        };
      }
    } else if (e.touches.length === 2) {
      setIsGesturing(true);
      const t1 = e.touches[0];
      const t2 = e.touches[1];
      const dist = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
      pinchStartRef.current = {
        dist,
        initialScale: scaleRef.current,
        centerX: (t1.clientX + t2.clientX) / 2,
        centerY: (t1.clientY + t2.clientY) / 2,
      };
      dragStartRef.current = null;
    }
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    movedRef.current = true;
    if (e.touches.length === 2 && pinchStartRef.current) {
      const t1 = e.touches[0];
      const t2 = e.touches[1];
      const currentDist = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
      const factor = currentDist / pinchStartRef.current.dist;
      const targetScale = Math.min(
        Math.max(pinchStartRef.current.initialScale * factor, MIN_SCALE * 0.8),
        MAX_SCALE * 1.2,
      );
      setScale(targetScale);
    } else if (e.touches.length === 1 && dragStartRef.current && scaleRef.current > 1) {
      const touch = e.touches[0];
      const dx = touch.clientX - dragStartRef.current.x;
      const dy = touch.clientY - dragStartRef.current.y;
      const nextX = dragStartRef.current.tx + dx;
      const nextY = dragStartRef.current.ty + dy;
      setTranslate(clampTranslate(nextX, nextY, scaleRef.current));
    }
  };

  const handleTouchEnd = () => {
    setIsGesturing(false);
    dragStartRef.current = null;
    pinchStartRef.current = null;

    // Bounce back if scale is below 1 or beyond max
    if (scaleRef.current < MIN_SCALE) {
      setScale(MIN_SCALE);
      setTranslate({ x: 0, y: 0 });
    } else if (scaleRef.current > MAX_SCALE) {
      setScale(MAX_SCALE);
      setTranslate((prev) => clampTranslate(prev.x, prev.y, MAX_SCALE));
    } else if (scaleRef.current === MIN_SCALE) {
      setTranslate({ x: 0, y: 0 });
    } else {
      setTranslate((prev) => clampTranslate(prev.x, prev.y, scaleRef.current));
    }
  };

  // Mouse Wheel Zoom
  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const zoomDelta = -e.deltaY * 0.003;
    const nextScale = Math.min(Math.max(scaleRef.current + zoomDelta, MIN_SCALE), MAX_SCALE);
    if (nextScale <= 1) {
      setScale(1);
      setTranslate({ x: 0, y: 0 });
    } else {
      setScale(nextScale);
      setTranslate((prev) => clampTranslate(prev.x, prev.y, nextScale));
    }
  };

  // Mouse Drag Pan
  const handleMouseDown = (e: React.MouseEvent) => {
    movedRef.current = false;
    if (scaleRef.current > 1 && e.button === 0) {
      setIsGesturing(true);
      dragStartRef.current = {
        x: e.clientX,
        y: e.clientY,
        tx: translateRef.current.x,
        ty: translateRef.current.y,
      };
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!dragStartRef.current || scaleRef.current <= 1) return;
    movedRef.current = true;
    const dx = e.clientX - dragStartRef.current.x;
    const dy = e.clientY - dragStartRef.current.y;
    const nextX = dragStartRef.current.tx + dx;
    const nextY = dragStartRef.current.ty + dy;
    setTranslate(clampTranslate(nextX, nextY, scaleRef.current));
  };

  const handleMouseUp = () => {
    setIsGesturing(false);
    dragStartRef.current = null;
  };

  // Overlay backdrop click to close (only if didn't drag/pan)
  const handleOverlayClick = (e: React.MouseEvent) => {
    if (!movedRef.current && (e.target === e.currentTarget || e.target === imgRef.current)) {
      if (scaleRef.current <= 1) {
        onClose();
      } else {
        // If zoomed in, single tap/click resets zoom first
        resetZoom();
      }
    }
  };

  if (!open) return null;

  return createPortal(
    <div
      ref={containerRef}
      role="dialog"
      aria-modal="true"
      aria-label="이미지 전체 화면 뷰어"
      className="fixed inset-0 z-[10000] flex select-none items-center justify-center bg-black/95 backdrop-blur-md"
      style={{ touchAction: 'none' }}
      onClick={handleOverlayClick}
      onWheel={handleWheel}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      onTouchCancel={handleTouchEnd}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
    >
      {/* Floating Header Controls */}
      <div
        className="pointer-events-none absolute inset-x-0 top-0 z-20 flex items-center justify-between p-4"
        style={{ paddingTop: 'max(1rem, env(safe-area-inset-top))' }}
      >
        <div className="pointer-events-auto flex items-center gap-2">
          {scale > 1.05 && (
            <button
              type="button"
              onClick={resetZoom}
              className="flex min-h-10 items-center gap-1.5 rounded-full bg-white/15 px-3 py-1.5 text-xs font-medium text-white backdrop-blur-md transition hover:bg-white/25 active:scale-95"
              aria-label="확대 초기화"
            >
              <RotateCcw size={13} />
              <span>{Math.round(scale * 100)}%</span>
            </button>
          )}
        </div>

        <div className="pointer-events-auto flex items-center gap-2">
          {/* Zoom In/Out quick buttons */}
          <button
            type="button"
            onClick={() => {
              const next = Math.min(scaleRef.current + 0.5, MAX_SCALE);
              setScale(next);
              setTranslate((prev) => clampTranslate(prev.x, prev.y, next));
            }}
            className="flex h-11 w-11 items-center justify-center rounded-full bg-white/15 text-white backdrop-blur-md transition hover:bg-white/25 active:scale-95"
            aria-label="확대"
          >
            <ZoomIn size={18} />
          </button>
          <button
            type="button"
            onClick={() => {
              const next = Math.max(scaleRef.current - 0.5, MIN_SCALE);
              if (next <= 1) {
                resetZoom();
              } else {
                setScale(next);
                setTranslate((prev) => clampTranslate(prev.x, prev.y, next));
              }
            }}
            className="flex h-11 w-11 items-center justify-center rounded-full bg-white/15 text-white backdrop-blur-md transition hover:bg-white/25 active:scale-95"
            aria-label="축소"
          >
            <ZoomOut size={18} />
          </button>
          <button
            type="button"
            onClick={onClose}
            className="flex h-11 w-11 items-center justify-center rounded-full bg-white/20 text-white backdrop-blur-md transition hover:bg-white/35 active:scale-95"
            aria-label="닫기"
          >
            <X size={20} />
          </button>
        </div>
      </div>

      {/* Main Image Surface */}
      <div className="relative flex h-full w-full items-center justify-center overflow-hidden p-2 sm:p-6">
        <img
          ref={imgRef}
          src={src}
          alt={alt}
          draggable={false}
          onDoubleClick={(e) => toggleZoom(e.clientX, e.clientY)}
          className={`max-h-full max-w-full select-none object-contain ${
            scale > 1 ? (isGesturing ? 'cursor-grabbing' : 'cursor-grab') : 'cursor-zoom-in'
          }`}
          style={{
            transform: `translate3d(${translate.x}px, ${translate.y}px, 0) scale(${scale})`,
            transition: isGesturing ? 'none' : 'transform 0.2s cubic-bezier(0.16, 1, 0.3, 1)',
            transformOrigin: 'center center',
          }}
        />
      </div>

      {/* Bottom Hint on Mobile */}
      <div
        className="pointer-events-none absolute inset-x-0 bottom-4 z-20 flex justify-center px-4"
        style={{ paddingBottom: 'max(0.5rem, env(safe-area-inset-bottom))' }}
      >
        <span className="rounded-full bg-black/60 px-3.5 py-1.5 text-[11px] font-medium text-white/80 backdrop-blur-md">
          {scale > 1
            ? '드래그하여 이동 | 두 손가락 핀치로 축소'
            : '두 손가락 핀치 또는 더블 탭으로 확대'}
        </span>
      </div>
    </div>,
    document.body,
  );
}
