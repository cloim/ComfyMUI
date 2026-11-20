import { useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Box, Layers2, type LucideIcon } from 'lucide-react';
import Models from './Models';
import Loras from './Loras';

type LibraryTab = 'checkpoints' | 'lora';

const TABS: { id: LibraryTab; label: string; icon: LucideIcon }[] = [
  { id: 'checkpoints', label: 'Checkpoints', icon: Box },
  { id: 'lora', label: 'LoRA', icon: Layers2 },
];

// The 모델 menu holds both libraries. The active tab lives in `?tab=` so links,
// reloads and the browser back button keep the same list.
export default function ModelLibrary() {
  const [params, setParams] = useSearchParams();
  const tab: LibraryTab = params.get('tab') === 'lora' ? 'lora' : 'checkpoints';
  // The tab list lives inside the library screen, which is replaced on a switch, so the
  // focused tab is unmounted. Focus moves to the new tab once it has rendered.
  const refocus = useRef(false);
  useEffect(() => {
    if (!refocus.current) return;
    refocus.current = false;
    document.getElementById(`model-library-tab-${tab}`)?.focus();
  }, [tab]);

  function select(next: LibraryTab) {
    if (next === tab) return;
    refocus.current = true;
    setParams(
      (prev) => {
        const out = new URLSearchParams(prev);
        if (next === 'checkpoints') out.delete('tab');
        else out.set('tab', next);
        return out;
      },
      { replace: true },
    );
  }

  // Phone widths give the tabs their own row; from `sm` they share the filter row.
  const tabList = (
    <div
      role="tablist"
      aria-label="모델 종류"
      className="flex h-9 w-full shrink-0 gap-0.5 rounded-lg border border-line bg-white p-0.5 sm:w-auto"
    >
      {TABS.map((t, i) => (
        <button
          key={t.id}
          type="button"
          role="tab"
          id={`model-library-tab-${t.id}`}
          aria-selected={tab === t.id}
          aria-controls="model-library-panel"
          tabIndex={tab === t.id ? 0 : -1}
          onClick={() => select(t.id)}
          onKeyDown={(e) => {
            const delta = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
            if (!delta && !['Home', 'End'].includes(e.key)) return;
            e.preventDefault();
            const idx =
              e.key === 'Home'
                ? 0
                : e.key === 'End'
                  ? TABS.length - 1
                  : (i + delta + TABS.length) % TABS.length;
            select(TABS[idx].id);
          }}
          className={`flex flex-auto items-center justify-center gap-1.5 whitespace-nowrap rounded-md px-3 text-xs font-semibold transition-colors ${
            tab === t.id ? 'bg-ink text-lime' : 'text-muted hover:bg-paper'
          }`}
        >
          <t.icon size={14} aria-hidden="true" className="shrink-0" />
          <span>{t.label}</span>
        </button>
      ))}
    </div>
  );

  return (
    <div
      id="model-library-panel"
      role="tabpanel"
      aria-labelledby={`model-library-tab-${tab}`}
      className="flex h-full min-h-0 flex-col"
    >
      {tab === 'lora' ? (
        <Loras key="lora" tabs={tabList} />
      ) : (
        <Models key="checkpoints" tabs={tabList} />
      )}
    </div>
  );
}
