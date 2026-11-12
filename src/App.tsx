import { useState, useEffect } from 'react';
import { NavLink, Navigate, Route, Routes, useLocation, Link } from 'react-router-dom';
import {
  Sparkles,
  Images,
  Bookmark,
  Settings2,
  Save,
  Plus,
  WifiOff,
  Check,
  Layers2,
  Box,
} from 'lucide-react';
import { StudioProvider, useStudio } from './studio';
import { IconButton } from './components/ui';
import { HeaderSlotProvider } from './components/HeaderActions';
import Create, { GenerateControls } from './screens/Create';
import Gallery from './screens/Gallery';
import Presets, { PresetEditor } from './screens/Presets';
import Loras from './screens/Loras';
import Models from './screens/Models';
import Settings from './screens/Settings';
import { usePwa } from './pwa';
import { SyncConflicts } from './components/SyncConflicts';
const nav = [
  { path: '/create', label: '만들기', icon: Sparkles },
  { path: '/models', label: '모델', icon: Box },
  { path: '/loras', label: 'LoRA', icon: Layers2 },
  { path: '/gallery', label: '기록', icon: Images },
  { path: '/presets', label: '프리셋', icon: Bookmark },
  { path: '/settings', label: '설정', icon: Settings2 },
];
export default function App() {
  return (
    <StudioProvider>
      <Shell />
    </StudioProvider>
  );
}
// Server status. Shown beside the sidebar brand; the header keeps it only on widths
// where the sidebar is hidden but there is still room.
function ConnectionBadge({ state, className }: { state: string; className: string }) {
  const { reconnect, notify } = useStudio();
  const label = state === 'connected' ? '연결됨' : state === 'connecting' ? '연결 중' : '다시 연결';
  const dotColor =
    state === 'connected'
      ? 'bg-olive'
      : state === 'connecting'
        ? 'bg-amber-500 animate-pulse'
        : 'bg-red-600';

  if (state === 'error') {
    return (
      <button
        type="button"
        onClick={() => {
          reconnect();
          notify('ComfyUI 서버에 다시 연결을 시도해요');
        }}
        title="클릭하여 서버에 다시 연결"
        className={`${className} shrink-0 items-center gap-1 whitespace-nowrap rounded-full border border-red-300 bg-red-50/50 px-2 py-0.5 text-2xs text-red-600 hover:bg-red-100/50`}
      >
        <span className={`h-1.5 w-1.5 rounded-full ${dotColor}`} />
        {label}
      </button>
    );
  }

  return (
    <Link
      to="/settings"
      title={label}
      className={`${className} shrink-0 items-center gap-1 whitespace-nowrap rounded-full border border-line bg-paper px-2 py-0.5 text-2xs text-muted hover:text-ink`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${dotColor}`} />
      {label}
    </Link>
  );
}
function Shell() {
  const location = useLocation();
  const page = nav.find((n) => n.path === location.pathname);
  const { connectionState, online, notice, storageError, active } = useStudio();
  const [saveOpen, setSaveOpen] = useState(false);
  const pwa = usePwa();
  const [keyboardOpen, setKeyboardOpen] = useState(false);
  const [headerSlot, setHeaderSlot] = useState<HTMLDivElement | null>(null);
  useEffect(() => {
    const viewport = window.visualViewport;
    const sync = () => {
      if (viewport && viewport.scale === 1) {
        document.documentElement.style.setProperty('--app-height', `${viewport.height}px`);
        setKeyboardOpen(window.innerHeight - viewport.height > 140);
      }
    };
    sync();
    viewport?.addEventListener('resize', sync);
    return () => {
      viewport?.removeEventListener('resize', sync);
      document.documentElement.style.removeProperty('--app-height');
    };
  }, []);
  return (
    <div className="flex h-[var(--app-height,100dvh)] min-h-0 bg-paper text-ink">
      <a
        href="#main"
        className="sr-only z-[2000] rounded-lg bg-ink p-3 text-white focus:not-sr-only focus:fixed focus:left-4 focus:top-4"
      >
        본문으로 이동
      </a>
      <aside className="hidden w-[224px] shrink-0 flex-col border-r border-line bg-white px-3 py-4 md:flex xl:w-[232px]">
        <div className="mb-5 flex items-center justify-between gap-1.5 pl-2.5">
          <Link to="/create" className="flex min-w-0 items-center gap-1.5" aria-label="ComfyMUI 홈">
            <img src="/icon.svg" className="h-7 w-7 shrink-0" alt="" />
            <span className="font-display text-base font-extrabold tracking-tight">
              Comfy<span className="font-medium">MUI</span>
            </span>
          </Link>
          <ConnectionBadge state={connectionState} className="flex" />
        </div>
        <nav aria-label="주요 메뉴" className="flex flex-col gap-1">
          {nav.map((n) => (
            <NavLink
              key={n.path}
              to={n.path}
              className={({ isActive }) =>
                `flex min-h-9 items-center gap-2.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${isActive ? 'bg-ink text-lime' : 'text-muted hover:bg-paper'}`
              }
            >
              <n.icon size={16} />
              {n.label}
            </NavLink>
          ))}
        </nav>
      </aside>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <header className="z-20 flex h-14 shrink-0 items-center justify-between gap-2.5 border-b border-line bg-paper px-4 pt-[env(safe-area-inset-top)] sm:px-5 lg:px-6">
          <div className="flex min-w-0 items-center gap-2.5">
            <Link to="/create" aria-label="ComfyMUI 홈" className="md:hidden">
              <img src="/icon.svg" alt="" className="h-7 w-7" />
            </Link>
            <h1
              data-ui-audit-context-title
              data-ui-audit-contrast
              className="text-base font-bold tracking-tight"
            >
              {page?.label || '만들기'}
            </h1>
            {active && location.pathname !== '/create' && (
              <Link to="/create" className="chip text-olive">
                생성 {active.progress}%
              </Link>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <ConnectionBadge state={connectionState} className="hidden sm:flex md:hidden" />
            {location.pathname === '/create' && (
              <>
                <IconButton
                  icon={Save}
                  label="현재 설정을 프리셋으로 저장"
                  onClick={() => setSaveOpen(true)}
                />
                <GenerateControls />
              </>
            )}
            {location.pathname === '/presets' && (
              <IconButton
                icon={Plus}
                label="현재 설정으로 프리셋 추가"
                onClick={() => setSaveOpen(true)}
              />
            )}
            <div
              ref={setHeaderSlot}
              data-header-actions
              className="flex items-center gap-1.5 empty:hidden"
            />
          </div>
        </header>
        <SyncConflicts />
        {(!online || storageError) && (
          <div
            role="status"
            className="flex flex-wrap items-center justify-center gap-2 bg-[#ece4c9] px-4 py-1.5 text-xs text-[#69521e]"
          >
            {!online ? (
              <>
                <WifiOff size={14} />
                오프라인 | 저장한 설정과 프리셋을 사용할 수 있어요
              </>
            ) : (
              '기기 저장 공간을 확인해 주세요. 변경 사항은 현재 화면에 유지됩니다'
            )}
          </div>
        )}
        <main
          id="main"
          tabIndex={-1}
          className={`min-h-0 flex-1 outline-none ${['/gallery', '/presets', '/loras', '/models'].includes(location.pathname) ? 'overflow-hidden' : 'overflow-y-auto'}`}
          data-ui-audit-scroll-root={
            !['/gallery', '/presets', '/loras', '/models'].includes(location.pathname)
              ? ''
              : undefined
          }
        >
          <HeaderSlotProvider value={headerSlot}>
            <Routes>
              <Route path="/create" element={<Create />} />
              <Route path="/models" element={<Models />} />
              <Route path="/loras" element={<Loras />} />
              <Route path="/gallery" element={<Gallery />} />
              <Route path="/presets" element={<Presets />} />
              <Route path="/settings" element={<Settings />} />
              <Route path="*" element={<Navigate to="/create" replace />} />
            </Routes>
          </HeaderSlotProvider>
        </main>
        <nav
          aria-label="모바일 메뉴"
          className={`${keyboardOpen ? 'hidden' : 'flex'} shrink-0 items-stretch justify-around border-t border-line bg-white px-1.5 pb-[max(4px,env(safe-area-inset-bottom))] pt-1 md:hidden`}
        >
          {nav.map((n) => (
            <NavLink
              key={n.path}
              to={n.path}
              className={({ isActive }) =>
                `flex min-h-11 min-w-0 flex-1 flex-col items-center justify-center gap-1 whitespace-nowrap rounded-lg px-1 py-1 text-2xs font-semibold ${isActive ? 'text-olive' : 'text-muted'}`
              }
            >
              <n.icon size={17} />
              {n.label}
            </NavLink>
          ))}
        </nav>
      </div>
      {notice && (
        <div
          data-ui-audit-overlay
          role="status"
          className="fixed left-1/2 top-[68px] z-[2000] flex w-max max-w-[calc(100%-32px)] -translate-x-1/2 items-start gap-2 rounded-xl bg-ink px-4 py-2.5 text-xs leading-relaxed text-white shadow-xl"
        >
          <Check size={14} className="mt-0.5 shrink-0" />
          <span className="whitespace-pre-wrap [overflow-wrap:anywhere]">{notice}</span>
        </div>
      )}
      {saveOpen && <PresetEditor open onClose={() => setSaveOpen(false)} />}
    </div>
  );
}
