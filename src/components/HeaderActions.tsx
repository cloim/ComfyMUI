import { createContext, useContext, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { LoaderCircle, type LucideIcon } from 'lucide-react';

// The shell owns the slot element in the top bar; screens portal their actions into it.
const HeaderSlotContext = createContext<HTMLElement | null>(null);

export const HeaderSlotProvider = HeaderSlotContext.Provider;

export function HeaderActions({ children }: { children: ReactNode }) {
  const slot = useContext(HeaderSlotContext);
  return slot ? createPortal(children, slot) : null;
}

// Icon + label on wider screens, icon only on mobile. The label stays the accessible name.
export function HeaderActionButton({
  icon: Icon,
  label,
  onClick,
  busy = false,
  primary = false,
}: {
  icon: LucideIcon;
  label: string;
  onClick: () => void;
  busy?: boolean;
  primary?: boolean;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={busy}
      aria-busy={busy || undefined}
      onClick={onClick}
      className={`${primary ? 'btn-primary' : 'btn-secondary'} h-9 w-9 shrink-0 px-0 sm:w-auto sm:px-3`}
    >
      {busy ? (
        <LoaderCircle size={15} className="animate-spin" aria-hidden="true" />
      ) : (
        <Icon size={15} aria-hidden="true" />
      )}
      <span className="hidden whitespace-nowrap sm:inline">{label}</span>
    </button>
  );
}
