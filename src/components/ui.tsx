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
import {
  ChevronDown,
  CircleHelp,
  RotateCcw,
  Search,
  Check,
  LoaderCircle,
  GripVertical,
  X,
  type LucideIcon,
} from 'lucide-react';
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Modal as SharedModal } from './Modal/Modal.jsx';
export function Modal({
  title,
  open,
  onClose,
  children,
  footer,
  size = 'md',
}: {
  title: string;
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  size?: 'md' | 'lg' | 'xl';
}) {
  return (
    <SharedModal
      isOpen={open}
      onClose={onClose}
      title={title}
      footer={footer}
      size={size}
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
  pressed,
  className = '',
}: {
  icon: LucideIcon;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
  // Set for toggle buttons; exposes the on/off state to assistive tech.
  pressed?: boolean;
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
        aria-pressed={pressed}
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
        className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-colors disabled:opacity-40 ${pressed ? 'bg-ink text-lime hover:bg-ink/90' : danger ? 'text-red-700 hover:bg-red-50' : 'text-ink/70 hover:bg-black/5'} ${className}`}
      >
        <Icon size={16} aria-hidden="true" />
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
              top: rect.bottom + 52 > window.innerHeight ? rect.top - 48 : rect.bottom + 6,
              width,
            }}
            className="pointer-events-none fixed z-[2100] rounded-lg bg-ink px-2.5 py-1.5 text-center text-2xs text-white shadow-lg"
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
      <select {...props} className={`field appearance-none pr-8 ${props.className || ''}`} />
      <ChevronDown
        className="pointer-events-none absolute right-2.5 text-muted"
        size={15}
        aria-hidden="true"
      />
    </span>
  );
}
export type MultiSelectOption = { value: string; label: string; count?: number };
// Field-styled trigger with a portal popover: search, checkable options and an optional footer.
export function MultiSelect({
  label,
  placeholder,
  options,
  value,
  onChange,
  footer,
}: {
  label: string;
  placeholder: string;
  options: MultiSelectOption[];
  value: string[];
  onChange: (next: string[]) => void;
  footer?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const [menuStyle, setMenuStyle] = useState({ left: 16, top: 16, width: 240, maxHeight: 320 });
  const q = query.trim().toLocaleLowerCase();
  const shown = q ? options.filter((o) => o.label.toLocaleLowerCase().includes(q)) : options;
  const selectedLabels = value.map((v) => options.find((o) => o.value === v)?.label || v);

  useLayoutEffect(() => {
    if (!open) return;
    const sync = () => {
      const rect = triggerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const width = Math.min(Math.max(rect.width, 260), window.innerWidth - 24);
      const left = Math.max(12, Math.min(window.innerWidth - width - 12, rect.left));
      const below = window.innerHeight - rect.bottom - 18;
      const above = rect.top - 18;
      const flip = below < 240 && above > below;
      const maxHeight = Math.min(360, flip ? above : below);
      const top = flip ? rect.top - 6 - maxHeight : rect.bottom + 6;
      setMenuStyle({ left, top, width, maxHeight });
    };
    sync();
    window.addEventListener('resize', sync);
    window.addEventListener('scroll', sync, true);
    return () => {
      window.removeEventListener('resize', sync);
      window.removeEventListener('scroll', sync, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    searchRef.current?.focus();
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node | null;
      if (triggerRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setOpen(false);
      triggerRef.current?.focus();
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  function toggle(v: string) {
    onChange(value.includes(v) ? value.filter((x) => x !== v) : [...value, v]);
  }

  return (
    <div className="relative w-full min-w-0">
      <button
        ref={triggerRef}
        type="button"
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => {
          setQuery('');
          setOpen((v) => !v);
        }}
        className="field flex items-center gap-2 pr-8 text-left"
      >
        <span className={`min-w-0 flex-1 truncate ${value.length ? 'text-ink' : ''}`}>
          {value.length ? selectedLabels.join(', ') : placeholder}
        </span>
        {value.length > 0 && (
          <span className="shrink-0 rounded-full bg-olive/15 px-1.5 text-2xs font-bold text-olive">
            {value.length}
          </span>
        )}
      </button>
      <ChevronDown
        className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-muted"
        size={15}
        aria-hidden="true"
      />
      {open &&
        createPortal(
          <div
            ref={menuRef}
            data-ui-audit-overlay
            style={menuStyle}
            className="fixed z-[2100] flex flex-col overflow-hidden rounded-lg border border-line bg-white shadow-xl"
          >
            <label className="relative border-b border-line p-1.5">
              <Search
                size={14}
                className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-muted"
              />
              <input
                ref={searchRef}
                type="search"
                autoComplete="off"
                aria-label={`${label} 검색`}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="검색"
                className="field min-h-8 border-transparent bg-paper pl-8 focus:bg-white"
              />
            </label>
            <div
              role="listbox"
              aria-multiselectable="true"
              aria-label={`${label} 목록`}
              className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto p-1"
            >
              {shown.length ? (
                shown.map((o) => {
                  const active = value.includes(o.value);
                  return (
                    <button
                      key={o.value}
                      type="button"
                      role="option"
                      aria-selected={active}
                      onClick={() => toggle(o.value)}
                      className={`flex min-h-8 w-full shrink-0 items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-xs transition ${
                        active ? 'bg-lime/25 font-semibold text-olive' : 'text-ink hover:bg-paper'
                      }`}
                    >
                      <span
                        className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                          active ? 'border-olive bg-olive text-white' : 'border-line bg-white'
                        }`}
                      >
                        {active && <Check size={11} aria-hidden="true" />}
                      </span>
                      <span className="min-w-0 flex-1 truncate">{o.label}</span>
                      {o.count !== undefined && (
                        <span className="shrink-0 font-mono text-2xs text-muted">{o.count}</span>
                      )}
                    </button>
                  );
                })
              ) : (
                <p className="p-4 text-center text-xs text-muted">
                  {options.length ? '검색어를 바꾸면 다시 찾을 수 있어요' : '선택할 항목이 없어요'}
                </p>
              )}
            </div>
            {footer && <div className="border-t border-line p-1.5">{footer}</div>}
          </div>,
          document.body,
        )}
    </div>
  );
}
// Help icon with an HTML tooltip: hover or focus previews it, click pins it until outside click.
export function HelpTip({ label, children }: { label: string; children: ReactNode }) {
  const [hover, setHover] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [style, setStyle] = useState({ left: 12, top: 12, width: 260 });
  const buttonRef = useRef<HTMLButtonElement>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const id = useId();
  const open = hover || pinned;
  useLayoutEffect(() => {
    if (!open) return;
    const sync = () => {
      const rect = buttonRef.current?.getBoundingClientRect();
      if (!rect) return;
      const width = Math.min(280, window.innerWidth - 24);
      const height = tipRef.current?.offsetHeight || 80;
      const left = Math.max(
        12,
        Math.min(window.innerWidth - width - 12, rect.left + rect.width / 2 - width / 2),
      );
      const top =
        rect.bottom + height + 12 > window.innerHeight && rect.top > height + 12
          ? rect.top - height - 6
          : rect.bottom + 6;
      setStyle({ left, top, width });
    };
    sync();
    window.addEventListener('resize', sync);
    window.addEventListener('scroll', sync, true);
    return () => {
      window.removeEventListener('resize', sync);
      window.removeEventListener('scroll', sync, true);
    };
  }, [open]);
  useEffect(() => {
    if (!pinned) return;
    const onPointerDown = (e: PointerEvent) => {
      if (buttonRef.current?.contains(e.target as Node)) return;
      setPinned(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPinned(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [pinned]);
  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        aria-label={`${label} 도움말`}
        aria-expanded={open}
        aria-describedby={open ? id : undefined}
        onPointerEnter={(e) => {
          if (e.pointerType === 'mouse') setHover(true);
        }}
        onPointerLeave={() => setHover(false)}
        onFocus={() => setHover(true)}
        onBlur={() => setHover(false)}
        onClick={(e) => {
          e.preventDefault();
          setPinned((v) => !v);
        }}
        className="-my-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted transition-colors hover:bg-black/5 hover:text-ink"
      >
        <CircleHelp size={13} aria-hidden="true" />
      </button>
      {open &&
        createPortal(
          <div
            ref={tipRef}
            id={id}
            role="tooltip"
            data-ui-audit-overlay
            style={style}
            className="pointer-events-none fixed z-[2100] rounded-lg bg-ink px-3 py-2.5 text-left text-2xs font-normal leading-relaxed text-white shadow-lg [&_b]:font-semibold [&_b]:text-lime"
          >
            {children}
          </div>,
          document.body,
        )}
    </>
  );
}
// Shows the recommended value next to a control and lets the user restore it.
export type Recommend = { modified: boolean; onReset: () => void; value: string };
function ResetButton({ label, recommend }: { label: string; recommend: Recommend }) {
  return (
    <IconButton
      icon={RotateCcw}
      label={`${label} 권장값(${recommend.value})으로 되돌리기`}
      disabled={!recommend.modified}
      onClick={recommend.onReset}
      className="h-9 w-9"
    />
  );
}
export const modifiedField = 'border-amber-300 bg-amber-50';
export function Field({
  label,
  children,
  hint,
  help,
  recommend,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
  help?: ReactNode;
  recommend?: Recommend;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <div
        data-ui-audit-contrast
        className="flex min-h-4 items-center gap-1 text-xs font-semibold text-ink/80"
      >
        {label}
        {help && <HelpTip label={label}>{help}</HelpTip>}
      </div>
      {recommend ? (
        <div className="flex min-w-0 items-center gap-1">
          <div className="min-w-0 flex-1">{children}</div>
          <ResetButton label={label} recommend={recommend} />
        </div>
      ) : (
        children
      )}
      {hint && <p className="text-2xs leading-relaxed text-muted">{hint}</p>}
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
  help,
  recommend,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  step?: number;
  help?: ReactNode;
  recommend?: Recommend;
}) {
  const id = useId();
  return (
    <div className="flex min-w-0 flex-col gap-1.5 text-xs font-semibold text-ink/80">
      <div className="flex min-h-4 items-center gap-1">
        <label htmlFor={id}>{label}</label>
        {help && <HelpTip label={label}>{help}</HelpTip>}
      </div>
      <div className="flex min-w-0 items-center gap-1">
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
          className={`field flex-1 font-mono text-xs ${recommend?.modified ? modifiedField : ''}`}
        />
        {recommend && <ResetButton label={label} recommend={recommend} />}
      </div>
    </div>
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
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing]);

  function commit() {
    setEditing(false);
    const parsed = Number(draft.trim());
    if (Number.isFinite(parsed)) {
      const clamped = Math.min(max, Math.max(min, Math.round(parsed * 100) / 100));
      onChange(clamped);
    }
  }

  return (
    <div className="flex flex-col gap-1.5 text-xs text-muted">
      <div className="flex items-center justify-between gap-2">
        <span>{label}</span>
        {editing ? (
          <input
            ref={inputRef}
            type="number"
            inputMode="decimal"
            aria-label={`${label} 수치 입력`}
            min={min}
            max={max}
            step={step}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                commit();
              } else if (e.key === 'Escape') {
                e.preventDefault();
                setEditing(false);
              }
            }}
            className="h-6 w-20 rounded-md border border-olive bg-white px-2 text-right font-mono text-xs font-semibold text-ink focus:outline-none focus:ring-2 focus:ring-olive/20"
          />
        ) : (
          <button
            type="button"
            aria-label={`${label} 값 직접 입력 (${value.toFixed(2)})`}
            onClick={() => {
              setDraft(value.toFixed(2));
              setEditing(true);
            }}
            className="rounded-md px-1.5 py-0.5 font-mono font-semibold text-ink transition hover:bg-stone"
          >
            {value.toFixed(2)}
          </button>
        )}
      </div>
      <input
        aria-label={label}
        className="h-6 w-full accent-olive"
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </div>
  );
}
function SortablePickerRow({
  item,
  labelText,
  descriptionText,
  selected,
  onSelect,
}: {
  item: string;
  labelText: string;
  descriptionText?: string;
  selected: boolean;
  onSelect: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: item,
  });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    touchAction: 'none' as const,
  };
  return (
    <div
      ref={setNodeRef}
      style={style}
      onPointerDown={(e) => listeners?.onPointerDown?.(e)}
      onTouchStart={(e) => listeners?.onTouchStart?.(e)}
      data-testid={`picker-item-${item}`}
      className={`flex touch-none select-none items-center gap-1 rounded-lg transition-colors ${
        isDragging ? 'z-10 bg-stone/80 opacity-50 ring-2 ring-olive/40' : 'hover:bg-paper'
      }`}
    >
      <button
        type="button"
        {...attributes}
        onKeyDown={(e) => listeners?.onKeyDown?.(e)}
        aria-label={`${labelText} 순서 변경`}
        style={{ touchAction: 'none' }}
        className="flex h-9 w-8 shrink-0 touch-none cursor-grab items-center justify-center rounded-md text-muted hover:text-ink active:cursor-grabbing"
        onClick={(e) => e.stopPropagation()}
      >
        <GripVertical size={15} aria-hidden="true" />
      </button>
      <button
        type="button"
        aria-label={labelText}
        style={{ touchAction: 'none' }}
        className="flex min-h-9 min-w-0 flex-1 touch-none items-center justify-between gap-2.5 rounded-lg py-1.5 pr-2.5 text-left text-xs"
        onClick={onSelect}
      >
        <span className="min-w-0 [overflow-wrap:anywhere]">
          <span className="block">{labelText}</span>
          {descriptionText && (
            <span className="mt-0.5 block text-2xs text-muted">{descriptionText}</span>
          )}
        </span>
        {selected && <Check size={16} className="shrink-0 text-olive" />}
      </button>
    </div>
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
  onReorder,
}: {
  label: string;
  value: string;
  items: string[];
  onChange: (v: string) => void;
  disabled?: boolean;
  labels?: Record<string, string>;
  descriptions?: Record<string, string>;
  onReorder?: (nextItems: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [activeDragId, setActiveDragId] = useState<string | null>(null);
  const justDraggedRef = useRef(false);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const filtered = items.filter((v) =>
    `${labels?.[v] || v} ${descriptions?.[v] || ''}`
      .toLocaleLowerCase()
      .includes(search.toLocaleLowerCase()),
  );
  function handleDragStart(event: DragStartEvent) {
    justDraggedRef.current = true;
    setActiveDragId(String(event.active.id));
  }
  function handleDragEnd(event: DragEndEvent) {
    setActiveDragId(null);
    window.setTimeout(() => {
      justDraggedRef.current = false;
    }, 100);
    if (!onReorder) return;
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = filtered.indexOf(String(active.id));
    const newIndex = filtered.indexOf(String(over.id));
    if (oldIndex === -1 || newIndex === -1) return;
    const reorderedFiltered = arrayMove(filtered, oldIndex, newIndex);
    if (filtered.length === items.length) {
      onReorder(reorderedFiltered);
    } else {
      const filteredSet = new Set(filtered);
      let ptr = 0;
      onReorder(items.map((it) => (filteredSet.has(it) ? reorderedFiltered[ptr++] : it)));
    }
  }
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
        className="field flex items-center justify-between gap-2 text-left disabled:opacity-50"
      >
        <span className="min-w-0 truncate">{labels?.[value] || value || `${label} 선택`}</span>
        <ChevronDown size={15} className="shrink-0 text-muted" />
      </button>
      <Modal title={`${label} 선택`} open={open} onClose={() => setOpen(false)}>
        <div className="flex flex-col gap-3">
          <label className="relative">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
            <input
              autoComplete="off"
              aria-label={`${label} 검색`}
              className="field pl-9"
              placeholder="이름으로 검색"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </label>
          <div className="max-h-[45dvh] overflow-y-auto">
            {filtered.length ? (
              onReorder ? (
                <DndContext
                  sensors={sensors}
                  collisionDetection={closestCenter}
                  onDragStart={handleDragStart}
                  onDragEnd={handleDragEnd}
                  onDragCancel={() => {
                    setActiveDragId(null);
                    window.setTimeout(() => {
                      justDraggedRef.current = false;
                    }, 100);
                  }}
                >
                  <SortableContext items={filtered} strategy={verticalListSortingStrategy}>
                    <div className="flex flex-col gap-1">
                      {filtered.map((item) => (
                        <SortablePickerRow
                          key={item}
                          item={item}
                          labelText={labels?.[item] || item}
                          descriptionText={descriptions?.[item]}
                          selected={value === item}
                          onSelect={() => {
                            if (justDraggedRef.current) return;
                            onChange(item);
                            setOpen(false);
                          }}
                        />
                      ))}
                    </div>
                  </SortableContext>
                  {createPortal(
                    <DragOverlay dropAnimation={null} style={{ zIndex: 2000 }}>
                      {activeDragId ? (
                        <div className="flex items-center gap-1 rounded-lg border border-olive bg-white px-2 py-1.5 text-xs shadow-xl">
                          <span className="flex h-7 w-7 shrink-0 items-center justify-center text-olive">
                            <GripVertical size={15} aria-hidden="true" />
                          </span>
                          <span className="min-w-0 flex-1 truncate font-medium text-ink">
                            {labels?.[activeDragId] || activeDragId}
                          </span>
                        </div>
                      ) : null}
                    </DragOverlay>,
                    document.body,
                  )}
                </DndContext>
              ) : (
                filtered.map((item) => (
                  <button
                    aria-label={labels?.[item] || item}
                    className="flex min-h-9 w-full items-center justify-between gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-xs hover:bg-paper"
                    key={item}
                    onClick={() => {
                      onChange(item);
                      setOpen(false);
                    }}
                  >
                    <span className="min-w-0 [overflow-wrap:anywhere]">
                      <span className="block">{labels?.[item] || item}</span>
                      {descriptions?.[item] && (
                        <span className="mt-0.5 block text-2xs text-muted">
                          {descriptions[item]}
                        </span>
                      )}
                    </span>
                    {value === item && <Check size={16} className="shrink-0 text-olive" />}
                  </button>
                ))
              )
            ) : (
              <p className="p-4 text-center text-xs text-muted">
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
function SortableListItem({
  id,
  label,
  children,
}: {
  id: string;
  label: string;
  children: (handle: ReactNode) => ReactNode;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
  });
  const handle = (
    <button
      type="button"
      {...attributes}
      {...listeners}
      aria-label={`${label} 순서 변경`}
      className="flex h-9 w-8 shrink-0 cursor-grab touch-none items-center justify-center rounded-md text-muted hover:text-ink active:cursor-grabbing"
    >
      <GripVertical size={15} aria-hidden="true" />
    </button>
  );
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={
        isDragging ? 'relative z-10 rounded-xl opacity-90 shadow-lg ring-2 ring-olive/40' : ''
      }
    >
      {children(handle)}
    </li>
  );
}
// Vertical list reordered by a drag handle (pointer, touch and keyboard).
export function SortableList({
  label,
  items,
  getItemLabel,
  onReorder,
  renderItem,
  className = '',
}: {
  label: string;
  items: string[];
  getItemLabel: (id: string) => string;
  onReorder: (next: string[]) => void;
  renderItem: (id: string, handle: ReactNode) => ReactNode;
  className?: string;
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={({ active, over }) => {
        if (!over || active.id === over.id) return;
        const from = items.indexOf(String(active.id));
        const to = items.indexOf(String(over.id));
        if (from < 0 || to < 0) return;
        onReorder(arrayMove(items, from, to));
      }}
    >
      <SortableContext items={items} strategy={verticalListSortingStrategy}>
        <ul aria-label={label} className={className}>
          {items.map((id) => (
            <SortableListItem key={id} id={id} label={getItemLabel(id)}>
              {(handle) => renderItem(id, handle)}
            </SortableListItem>
          ))}
        </ul>
      </SortableContext>
    </DndContext>
  );
}
export function Section({
  title,
  icon: Icon,
  children,
  action,
  help,
}: {
  title: string;
  icon: LucideIcon;
  children: ReactNode;
  action?: ReactNode;
  help?: ReactNode;
}) {
  return (
    <section className="panel">
      <div className="mb-3 flex items-center justify-between gap-2.5">
        <div className="flex min-w-0 items-center gap-1">
          <h2 className="flex items-center gap-2 text-sm font-bold">
            <Icon size={15} className="text-muted" />
            {title}
          </h2>
          {help}
        </div>
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
    <div className="flex min-h-48 flex-col items-center justify-center gap-3 p-5 text-center">
      <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-stone">
        <Icon size={20} className="text-muted" />
      </span>
      <h2 className="text-sm font-semibold">{title}</h2>
      <p className="max-w-72 text-xs leading-relaxed text-muted">{description}</p>
      {children}
    </div>
  );
}
export function Spinner() {
  return <LoaderCircle size={15} aria-hidden="true" className="animate-spin" />;
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
          className="pointer-events-none fixed z-[2200] max-h-40 w-[min(360px,calc(100vw-24px))] overflow-y-auto rounded-lg border border-red-200 bg-red-50 p-2.5 text-xs leading-relaxed text-red-800 shadow-lg"
        >
          {message}
        </p>,
        document.body,
      )
    : null;
}
export function Status({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-stone px-2.5 py-1 text-xs font-medium text-ink/80">
      {children}
    </span>
  );
}
export { X };
