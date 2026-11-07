import {
  useState,
  useEffect,
  useLayoutEffect,
  useRef,
  type RefObject,
  type ReactNode,
  type SelectHTMLAttributes,
  useId,
} from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, Search, Check, LoaderCircle, X, type LucideIcon } from 'lucide-react';
import { Modal as SharedModal } from './Modal/Modal.jsx';
export function Modal({
  title,
  open,
  onClose,
  children,
  footer,
}: {
  title: string;
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <SharedModal
      isOpen={open}
      onClose={onClose}
      title={title}
      footer={footer}
      size="md"
      draggable
      resizable={false}
      storageKey={title}
      initialFocusRef={undefined}
      minWidth={280}
      minHeight={180}
      className=""
      closeOnOverlayClick
      closeOnEscape
    >
      {children}
    </SharedModal>
  );
}
export function IconButton({
  icon: Icon,
  label,
  onClick,
  disabled = false,
  danger = false,
  className = '',
}: {
  icon: LucideIcon;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
  className?: string;
}) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const id = useId();
  useEffect(() => {
    const close = () => setAnchor(null);
    const escape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    document.addEventListener('keydown', escape);
    return () => {
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
      document.removeEventListener('keydown', escape);
    };
  }, []);
  const rect = anchor?.getBoundingClientRect();
  const width = Math.min(208, window.innerWidth - 24);
  return (
    <>
      <button
        type="button"
        aria-label={label}
        aria-describedby={anchor ? id : undefined}
        disabled={disabled}
        onPointerEnter={(e) => {
          if (e.pointerType === 'mouse') setAnchor(e.currentTarget);
        }}
        onPointerLeave={() => setAnchor(null)}
        onFocus={(e) => setAnchor(e.currentTarget)}
        onBlur={() => setAnchor(null)}
        onClick={() => {
          setAnchor(null);
          onClick();
        }}
        className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl transition-colors disabled:opacity-40 ${danger ? 'text-red-700 hover:bg-red-50' : 'text-ink/70 hover:bg-black/5'} ${className}`}
      >
        <Icon size={19} aria-hidden="true" />
      </button>
      {rect &&
        createPortal(
          <span
            id={id}
            role="tooltip"
            style={{
              left: Math.max(
                12,
                Math.min(window.innerWidth - width - 12, rect.left + rect.width / 2 - width / 2),
              ),
              top: rect.bottom + 60 > window.innerHeight ? rect.top - 56 : rect.bottom + 6,
              width,
            }}
            className="pointer-events-none fixed z-[2100] rounded-lg bg-ink px-3 py-2 text-center text-xs text-white shadow-lg"
          >
            {label}
          </span>,
          document.body,
        )}
    </>
  );
}
export function SelectControl(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <span className="relative inline-flex w-full min-w-0 items-center">
      <select {...props} className={`field appearance-none pr-10 ${props.className || ''}`} />
      <ChevronDown
        className="pointer-events-none absolute right-3 text-muted"
        size={16}
        aria-hidden="true"
      />
    </span>
  );
}
export function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div data-ui-audit-contrast className="text-xs font-semibold text-ink/75">
        {label}
      </div>
      {children}
      {hint && <p className="text-xs leading-relaxed text-muted">{hint}</p>}
    </div>
  );
}
export function Numeric({
  label,
  value,
  onChange,
  min,
  max,
  step = 1,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  step?: number;
}) {
  const id = useId();
  return (
    <label htmlFor={id} className="flex min-w-0 flex-col gap-2 text-xs font-semibold text-ink/75">
      {label}
      <input
        id={id}
        aria-label={label}
        type="number"
        inputMode={step < 1 ? 'decimal' : 'numeric'}
        min={min}
        max={max}
        step={step}
        value={Number.isNaN(value) ? '' : value}
        onChange={(e) => onChange(e.target.value === '' ? NaN : Number(e.target.value))}
        className="field font-mono text-sm"
      />
    </label>
  );
}
export function Slider({
  label,
  value,
  onChange,
  min = -2,
  max = 2,
  step = 0.05,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
}) {
  return (
    <label className="flex flex-col gap-2 text-xs text-muted">
      <span className="flex justify-between gap-2">
        <span>{label}</span>
        <span className="font-mono font-semibold text-ink">{value.toFixed(2)}</span>
      </span>
      <input
        aria-label={label}
        className="h-7 w-full accent-olive"
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </label>
  );
}
export function Picker({
  label,
  value,
  items,
  onChange,
  disabled = false,
  labels,
  descriptions,
}: {
  label: string;
  value: string;
  items: string[];
  onChange: (v: string) => void;
  disabled?: boolean;
  labels?: Record<string, string>;
  descriptions?: Record<string, string>;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const filtered = items.filter((v) =>
    `${labels?.[v] || v} ${descriptions?.[v] || ''}`
      .toLocaleLowerCase()
      .includes(search.toLocaleLowerCase()),
  );
  return (
    <>
      <button
        type="button"
        aria-label={`${label} 선택`}
        disabled={disabled}
        onClick={() => {
          setSearch('');
          setOpen(true);
        }}
        className="field flex items-center justify-between gap-3 text-left disabled:opacity-50"
      >
        <span className="min-w-0 truncate">{labels?.[value] || value || `${label} 선택`}</span>
        <ChevronDown size={17} className="shrink-0 text-muted" />
      </button>
      <Modal title={`${label} 선택`} open={open} onClose={() => setOpen(false)}>
        <div className="flex flex-col gap-4">
          <label className="relative">
            <Search size={17} className="absolute left-3 top-3.5 text-muted" />
            <input
              autoComplete="off"
              aria-label={`${label} 검색`}
              className="field pl-10"
              placeholder="이름으로 검색"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </label>
          <div className="max-h-[45dvh] overflow-y-auto">
            {filtered.length ? (
              filtered.map((item) => (
                <button
                  aria-label={labels?.[item] || item}
                  className="flex min-h-12 w-full items-center justify-between gap-3 rounded-xl px-3 py-3 text-left text-sm hover:bg-paper"
                  key={item}
                  onClick={() => {
                    onChange(item);
                    setOpen(false);
                  }}
                >
                  <span className="min-w-0 [overflow-wrap:anywhere]">
                    <span className="block">{labels?.[item] || item}</span>
                    {descriptions?.[item] && (
                      <span className="mt-1 block text-[11px] text-muted">
                        {descriptions[item]}
                      </span>
                    )}
                  </span>
                  {value === item && <Check size={18} className="shrink-0 text-olive" />}
                </button>
              ))
            ) : (
              <p className="p-8 text-center text-sm text-muted">
                {items.length
                  ? '검색어를 바꾸면 다시 찾을 수 있어요'
                  : '서버 연결 후 설치 목록을 확인해 주세요'}
              </p>
            )}
          </div>
        </div>
      </Modal>
    </>
  );
}
export function Section({
  title,
  icon: Icon,
  children,
  action,
}: {
  title: string;
  icon: LucideIcon;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <section className="panel">
      <div className="mb-5 flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-2.5 text-sm font-bold">
          <Icon size={17} className="text-muted" />
          {title}
        </h2>
        {action}
      </div>
      {children}
    </section>
  );
}
export function Empty({
  icon: Icon,
  title,
  description,
  children,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  children?: ReactNode;
}) {
  return (
    <div className="flex min-h-64 flex-col items-center justify-center gap-4 p-6 text-center">
      <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-stone">
        <Icon size={24} className="text-muted" />
      </span>
      <h2 className="text-lg font-semibold">{title}</h2>
      <p className="max-w-72 text-sm leading-relaxed text-muted">{description}</p>
      {children}
    </div>
  );
}
export function Spinner() {
  return <LoaderCircle size={18} aria-hidden="true" className="animate-spin" />;
}
export function FieldError({
  anchor,
  message,
  id,
}: {
  anchor: RefObject<HTMLElement | null>;
  message: string;
  id: string;
}) {
  const panel = useRef<HTMLParagraphElement>(null);
  const [position, setPosition] = useState({ left: 16, top: 16 });
  useLayoutEffect(() => {
    if (!message) return;
    const sync = () => {
      const a = anchor.current?.getBoundingClientRect(),
        p = panel.current?.getBoundingClientRect();
      if (!a || !p) return;
      setPosition({
        left: Math.max(12, Math.min(innerWidth - p.width - 12, a.left)),
        top: Math.max(
          12,
          Math.min(
            innerHeight - p.height - 12,
            a.top > p.height + 20 ? a.top - p.height - 8 : a.bottom + 8,
          ),
        ),
      });
    };
    sync();
    window.addEventListener('resize', sync);
    window.addEventListener('scroll', sync, true);
    return () => {
      window.removeEventListener('resize', sync);
      window.removeEventListener('scroll', sync, true);
    };
  }, [anchor, message]);
  return message
    ? createPortal(
        <p
          ref={panel}
          id={id}
          role="alert"
          data-ui-audit-overlay
          style={position}
          className="pointer-events-none fixed z-[2200] max-h-40 w-[min(360px,calc(100vw-24px))] overflow-y-auto rounded-xl border border-red-200 bg-red-50 p-3 text-xs leading-relaxed text-red-800 shadow-lg"
        >
          {message}
        </p>,
        document.body,
      )
    : null;
}
export function Status({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-2 rounded-full bg-stone px-3 py-1.5 text-xs font-medium text-ink/80">
      {children}
    </span>
  );
}
export { X };
