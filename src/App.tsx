import { useState, useEffect } from 'react';
import { NavLink, Navigate, Route, Routes, useLocation, Link } from 'react-router-dom';
import {
  Sparkles,
  Images,
  Bookmark,
  Settings2,
  Save,
  Plus,
  ArrowUpRight,
  WifiOff,
  Check,
  Workflow,
  Layers2,
} from 'lucide-react';
import { StudioProvider, useStudio } from './studio';
import { IconButton } from './components/ui';
import Create, { GenerateBar } from './screens/Create';
import Gallery from './screens/Gallery';
import Presets, { PresetEditor } from './screens/Presets';
import Loras from './screens/Loras';
import Settings from './screens/Settings';
import { usePwa } from './pwa';
const nav = [
  { path: '/create', label: '만들기', icon: Sparkles },
  { path: '/loras', label: 'LoRA', icon: Layers2 },
  { path: '/gallery', label: '기록', icon: Images },
  { path: '/presets', label: '프리셋', icon: Bookmark },
  { path: '/settings', label: '연결 설정', icon: Settings2 },
];
export default function App() {
  return (
    <StudioProvider>
      <Shell />
    </StudioProvider>
  );
}
function Shell() {
  const location = useLocation();
  const page = nav.find((n) => n.path === location.pathname);
  const { connectionState, online, notice, storageError, active } = useStudio();
  const [saveOpen, setSaveOpen] = useState(false);
  const pwa = usePwa();
  const [keyboardOpen, setKeyboardOpen] = useState(false);
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
      <aside className="hidden w-[216px] shrink-0 flex-col border-r border-line bg-white px-4 py-7 md:flex xl:w-[236px]">
        <Link
          to="/create"
          className="mb-11 flex items-center gap-2.5 px-3"
          aria-label="ComfyMUI 홈"
        >
          <img src="/icon.svg" className="h-9 w-9" alt="" />
          <span className="font-display text-xl font-extrabold tracking-[-1px]">
            Comfy<span className="font-medium">MUI</span>
          </span>
        </Link>
        <nav aria-label="주요 메뉴" className="flex flex-col gap-2">
          {nav.map((n) => (
            <NavLink
              key={n.path}
              to={n.path}
              className={({ isActive }) =>
                `flex min-h-12 items-center gap-3 rounded-xl px-4 text-sm font-medium transition-colors ${isActive ? 'bg-ink text-lime' : 'text-muted hover:bg-paper'}`
              }
            >
              <n.icon size={18} />
              {n.label}
            </NavLink>
          ))}
        </nav>
        <div className="mt-auto border-t border-line pt-5">
          <Link to="/settings" className="flex items-start gap-3 rounded-xl p-3 hover:bg-paper">
            <span
              className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${connectionState === 'connected' ? 'bg-olive' : 'bg-amber-600'}`}
            />
            <div>
              <p className="text-xs font-semibold">
                {connectionState === 'connected'
                  ? 'ComfyUI 연결됨'
                  : connectionState === 'preview'
                    ? '미리보기 모드'
                    : '서버 연결 확인'}
              </p>
              <p className="mt-1.5 flex items-center gap-1 text-[11px] text-muted">
                연결 관리
                <ArrowUpRight size={11} />
              </p>
            </div>
          </Link>
          <p className="mt-4 px-3 text-[10px] text-muted">상상을 위한, 가벼운 작업실</p>
        </div>
      </aside>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <header className="z-20 flex h-[76px] shrink-0 items-center justify-between gap-3 border-b border-line bg-paper px-4 pt-[env(safe-area-inset-top)] sm:px-7 lg:px-9">
          <div className="flex min-w-0 items-center gap-3">
            <Link to="/create" aria-label="ComfyMUI 홈" className="md:hidden">
              <img src="/icon.svg" alt="" className="h-8 w-8" />
            </Link>
            <h1
              data-ui-audit-context-title
              data-ui-audit-contrast
              className="text-xl font-bold tracking-tight"
            >
              {page?.label || '만들기'}
            </h1>
            {active && location.pathname !== '/create' && (
              <Link to="/create" className="chip text-olive">
                생성 {active.progress}%
              </Link>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Link
              to="/settings"
              className="hidden items-center gap-2 rounded-full border border-line bg-white px-3 py-2 text-[11px] text-muted sm:flex"
            >
              <span
                className={`h-1.5 w-1.5 rounded-full ${connectionState === 'connected' ? 'bg-olive' : 'bg-amber-600'}`}
              />
              {connectionState === 'connected'
                ? '연결됨'
                : connectionState === 'preview'
                  ? '미리보기 모드'
                  : '연결 확인'}
            </Link>
            {location.pathname === '/create' && (
              <IconButton
                icon={Save}
                label="현재 설정을 프리셋으로 저장"
                onClick={() => setSaveOpen(true)}
              />
            )}{' '}
            {location.pathname === '/presets' && (
              <IconButton
                icon={Plus}
                label="현재 설정으로 프리셋 추가"
                onClick={() => setSaveOpen(true)}
              />
            )}
          </div>
        </header>
        {(!online || storageError) && (
          <div
            role="status"
            className="flex flex-wrap items-center justify-center gap-2 bg-[#ece4c9] px-4 py-2 text-xs text-[#69521e]"
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
          className={`min-h-0 flex-1 outline-none ${['/gallery', '/presets', '/loras'].includes(location.pathname) ? 'overflow-hidden' : 'overflow-y-auto'}`}
          data-ui-audit-scroll-root={
            !['/gallery', '/presets', '/loras'].includes(location.pathname) ? '' : undefined
          }
        >
          <Routes>
            <Route path="/create" element={<Create />} />
            <Route path="/loras" element={<Loras />} />
            <Route path="/gallery" element={<Gallery />} />
            <Route path="/presets" element={<Presets />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="*" element={<Navigate to="/create" replace />} />
          </Routes>
        </main>
        {location.pathname === '/create' && <GenerateBar />}
        <nav
          aria-label="모바일 메뉴"
          className={`${keyboardOpen ? 'hidden' : 'flex'} shrink-0 items-stretch justify-around border-t border-line bg-white px-2 pb-[max(6px,env(safe-area-inset-bottom))] pt-1 md:hidden`}
        >
          {nav.map((n) => (
            <NavLink
              key={n.path}
              to={n.path}
              className={({ isActive }) =>
                `flex min-h-14 min-w-14 flex-col items-center justify-center gap-1.5 rounded-xl px-3 text-[10px] font-semibold ${isActive ? 'text-olive' : 'text-muted'}`
              }
            >
              <n.icon size={19} />
              {n.label}
            </NavLink>
          ))}
        </nav>
      </div>
      {notice && (
        <div
          data-ui-audit-overlay
          role="status"
          className="fixed left-1/2 top-[90px] z-[2000] flex w-max max-w-[calc(100%-32px)] -translate-x-1/2 items-start gap-2 rounded-2xl bg-ink px-5 py-3.5 text-xs leading-relaxed text-white shadow-xl"
        >
          <Check size={15} className="mt-0.5 shrink-0" />
          <span className="whitespace-pre-wrap [overflow-wrap:anywhere]">{notice}</span>
        </div>
      )}
      {saveOpen && <PresetEditor open onClose={() => setSaveOpen(false)} />}
    </div>
  );
}
