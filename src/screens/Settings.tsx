import { useState, useRef } from 'react';
import { Link2, Check, Wifi, Info, Smartphone, ShieldCheck, ArrowUpRight, Bell } from 'lucide-react';
import { useStudio } from '../studio';
import { usePwa } from '../pwa';
import { Section, Spinner, Status, FieldError } from '../components/ui';
export default function Settings() {
  const {
    connection,
    connect,
    connectionState,
    connectionError,
    preview,
    info,
    notify,
    socketState,
    online,
    presets,
    jobs,
    notificationsEnabled,
    toggleNotifications,
  } = useStudio();
  const [base, setBase] = useState(connection.base);
  const [localError, setLocalError] = useState('');
  const [installing, setInstalling] = useState(false);
  const pwa = usePwa();
  const busy = connectionState === 'connecting';
  const addressInput = useRef<HTMLInputElement>(null);
  const errorMessage = localError || (connectionState === 'error' ? connectionError : '');
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-4 py-6 sm:px-7 lg:px-9">
      <Section
        title="ComfyUI 연결"
        icon={Link2}
        action={
          <div className="-my-1 flex items-center">
            <Status>
              <span
                className={`h-1.5 w-1.5 rounded-full ${connectionState === 'connected' ? 'bg-olive' : connectionState === 'preview' ? 'bg-amber-600' : 'bg-red-600'}`}
              />
              {connectionState === 'connected'
                ? '연결됨'
                : connectionState === 'preview'
                  ? '미리보기'
                  : busy
                    ? '연결 확인 중'
                    : '연결 확인 필요'}
            </Status>
          </div>
        }
      >
        <div className="flex flex-col gap-4">
          <p className="text-sm leading-relaxed text-muted">
            이미지를 생성할 ComfyUI 서버에 연결해 주세요
          </p>
          <label className="flex flex-col gap-2 text-xs font-semibold">
            서버 주소
            <input
              ref={addressInput}
              aria-invalid={Boolean(errorMessage)}
              aria-describedby={errorMessage ? 'connection-error' : undefined}
              type="text"
              inputMode="url"
              aria-label="ComfyUI 서버 주소"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              className="field font-mono text-sm"
              value={base}
              onChange={(e) => setBase(e.target.value)}
              placeholder="/comfy 또는 https://example.com"
            />
          </label>
          <div data-ui-audit-row className="flex flex-wrap gap-2">
            <button
              disabled={busy}
              onClick={() => {
                try {
                  connect(base);
                  setLocalError('');
                } catch (e) {
                  setLocalError((e as Error).message);
                }
              }}
              className="btn-primary"
            >
              {busy ? <Spinner /> : <Wifi size={16} />}저장하고 연결 확인
            </button>
            <button
              disabled={busy}
              className="btn-secondary"
              onClick={() => {
                preview();
                setLocalError('');
                notify('미리보기 모드로 전환했어요');
              }}
            >
              미리보기 모드
            </button>
          </div>
          <FieldError anchor={addressInput} message={errorMessage} id="connection-error" />
          {connectionState === 'connected' && (
            <div
              role="status"
              className="flex flex-col gap-2 rounded-xl bg-lime/20 p-4 text-xs text-olive"
            >
              <p className="flex items-center gap-2 font-semibold">
                <Check size={16} />
                서버에 연결했어요
              </p>
              <p>
                {Object.keys(info || {}).length}개 노드 | {socketState}
              </p>
            </div>
          )}
          <div className="flex items-start gap-3 rounded-xl bg-paper p-4">
            <Info size={17} className="mt-0.5 shrink-0 text-muted" />
            <p className="text-xs leading-relaxed text-muted">
              <strong className="text-ink">같은 서버 연결</strong>에는 기본값 <code>/comfy</code>를
              사용하세요
              <br />
              앱 서버가 ComfyUI로 요청을 전달해요
              <br />
              <br />
              직접 주소를 쓸 때는 같은 네트워크와 CORS 허용이 필요해요
              <br />
              HTTPS 앱에는 HTTPS 서버 주소를 사용하세요
            </p>
          </div>
        </div>
      </Section>
      <Section title="앱 설치와 업데이트" icon={Smartphone}>
        <div className="flex flex-col gap-4">
          <p className="text-sm leading-relaxed text-muted">
            홈 화면에 작업실을 두고, 앱처럼 가볍게 열어 보세요
          </p>
          <div data-ui-audit-row className="flex flex-wrap gap-2">
            <button
              disabled={installing || busy}
              className="btn-secondary"
              onClick={async () => {
                setInstalling(true);
                try {
                  if (!(await pwa.install()))
                    notify(
                      pwa.installed
                        ? '이미 앱으로 실행 중이에요'
                        : '브라우저 메뉴의 앱 설치 또는 홈 화면에 추가를 사용해 주세요. HTTPS 연결이 필요해요',
                    );
                } finally {
                  setInstalling(false);
                }
              }}
            >
              {installing ? <Spinner /> : <Smartphone size={16} />}
              {pwa.installed ? '설치된 앱' : '홈 화면에 추가'}
            </button>
            {pwa.waiting && (
              <button className="btn-primary" onClick={pwa.update}>
                새 버전 적용
              </button>
            )}
          </div>
          <p className="text-xs leading-relaxed text-muted">
            iPhone은 Safari 공유 메뉴에서 ‘홈 화면에 추가’를 선택하세요
            <br />
            저장한 입력과 프리셋은 오프라인에서도 열 수 있어요
          </p>
        </div>
      </Section>
      <Section title="화면 유지와 완료 알림" icon={Bell}>
        <div className="flex flex-col gap-4">
          <p className="text-sm leading-relaxed text-muted">
            생성 중에는 화면이 꺼지지 않도록 유지하고, 앱이 백그라운드일 때 생성이 끝나면 알림과 진동으로 알려드려요.
          </p>
          <div data-ui-audit-row className="flex flex-wrap items-center gap-2">
            <button
              className={notificationsEnabled ? 'btn-primary' : 'btn-secondary'}
              onClick={() => toggleNotifications()}
            >
              <Bell size={16} />
              {notificationsEnabled ? '완료 알림 켜짐' : '완료 알림 켜기'}
            </button>
            <Status>
              {'wakeLock' in navigator ? '화면 유지 지원됨' : '화면 유지 미지원'}
            </Status>
          </div>
          <p className="text-xs leading-relaxed text-muted">
            알림 권한을 허용하면 다른 탭이나 앱을 보는 동안 생성이 끝나도 바로 알 수 있어요. 설치된 PWA에서는 읽지 않은 완료 개수도 배지로 표시돼요.
          </p>
        </div>
      </Section>
      <Section title="이 기기의 데이터" icon={ShieldCheck}>
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap gap-2">
            <Status>프리셋 {presets.length}개</Status>
            <Status>생성 기록 {jobs.length}개</Status>
            <Status>{online ? '온라인' : '오프라인'}</Status>
          </div>
          <p className="text-xs leading-relaxed text-muted">
            프롬프트, 설정과 최근 100개 기록을 이 브라우저에 보관해요
            <br />
            이미지 원본은 ComfyUI 서버에서 불러옵니다
            <br />
            <br />
            브라우저 데이터 삭제에 대비해 중요한 프리셋은 JSON으로 내보내 주세요
            <br />
            공유 기기에서는 프롬프트와 서버 주소가 남는 점을 확인해 주세요
          </p>
        </div>
      </Section>
      <a
        className="flex items-center justify-center gap-2 py-4 text-xs text-muted hover:text-ink"
        href="https://docs.comfy.org/development/comfyui-server/comms_routes"
        target="_blank"
        rel="noreferrer"
      >
        ComfyUI 연결 문서
        <ArrowUpRight size={13} />
      </a>
    </div>
  );
}
