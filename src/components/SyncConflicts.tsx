import { useState, useSyncExternalStore } from 'react';
import { AlertTriangle, ArchiveRestore } from 'lucide-react';
import { Modal, Spinner } from './ui';
import {
  getSyncConflicts,
  getSyncArchive,
  subscribeSyncConflicts,
  resolveSyncConflict,
  restoreSyncDraft,
} from '../storage';

const names: Record<string, string> = {
  'cm-settings': '생성 설정',
  'cm-presets': '프리셋',
  'cm-default-prompts': '기본 프롬프트',
  'cm-prompt-assemble': '프롬프트 조합',
  'cm-connection': '서버 연결',
  'cm-asset-families': '모델 분류',
  'cm-prompt-assemble-selected': '선택한 프롬프트 조합',
  'cm-model-order': '모델 정렬',
  'cm-example-defaults': '모델 대표 이미지',
};

function VersionPreview({ value }: { value: unknown }) {
  if (Array.isArray(value)) {
    return (
      <p className="mt-2 whitespace-pre-wrap text-xs leading-relaxed text-muted [overflow-wrap:anywhere]">
        {value.length
          ? value
              .map((item) =>
                typeof item === 'object' && item ? item.name || item.id || '항목' : String(item),
              )
              .join(' · ')
          : '저장된 항목 없음'}
      </p>
    );
  }
  if (value && typeof value === 'object') {
    const settings = value as Record<string, unknown>;
    return (
      <div className="mt-2 flex flex-col gap-1 text-xs leading-relaxed text-muted">
        {typeof settings.positive === 'string' && (
          <p className="whitespace-pre-wrap [overflow-wrap:anywhere]">
            {settings.positive || '프롬프트 없음'}
          </p>
        )}
        {typeof settings.model === 'string' && (
          <p className="break-all">{settings.model.split(/[\\/]/).pop()}</p>
        )}
        {typeof settings.width === 'number' && (
          <p>
            {String(settings.width)} × {String(settings.height)} · {String(settings.steps)} steps
          </p>
        )}
        {typeof settings.base === 'string' && <p className="break-all">{settings.base}</p>}
      </div>
    );
  }
  return <p className="mt-2 text-xs text-muted">{String(value ?? '저장된 값 없음')}</p>;
}

export function SyncConflicts({ recovery = false }: { recovery?: boolean }) {
  const conflicts = useSyncExternalStore(subscribeSyncConflicts, getSyncConflicts);
  const archive = useSyncExternalStore(subscribeSyncConflicts, getSyncArchive);
  const [open, setOpen] = useState(false);
  const [working, setWorking] = useState<string | null>(null);
  const [error, setError] = useState('');
  async function act(key: string, task: () => Promise<void>) {
    setWorking(key);
    setError('');
    try {
      await task();
    } catch {
      setError('처리하지 못했어요. 연결을 확인하고 다시 시도해 주세요');
    } finally {
      setWorking(null);
    }
  }
  if (!recovery && !conflicts.length && !open) return null;
  return (
    <>
      {recovery ? (
        <button className="btn-secondary" onClick={() => setOpen(true)}>
          <ArchiveRestore size={14} /> 동기화와 보관 초안
        </button>
      ) : conflicts.length > 0 ? (
        <div
          role="status"
          className="flex shrink-0 flex-wrap items-center justify-center gap-2 border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-950"
        >
          <AlertTriangle size={14} />
          <span>다른 기기와 겹친 변경 {conflicts.length}건을 보관했어요</span>
          <button
            className="rounded-md border border-amber-400 px-2 py-1 font-semibold"
            onClick={() => setOpen(true)}
          >
            변경 비교
          </button>
        </div>
      ) : null}
      <Modal open={open} onClose={() => setOpen(false)} title="동기화와 보관 초안" size="lg">
        <div className="flex flex-col gap-4 break-keep">
          <p className="text-xs leading-relaxed text-muted">
            양쪽 변경을 보관했어요. 이전 버전은 아래 보관 목록에서 다시 복원할 수 있어요
          </p>
          {error && (
            <p role="alert" className="text-xs text-red-700">
              {error}
            </p>
          )}
          {!conflicts.length && (
            <p className="py-5 text-center text-sm text-muted">해결할 동기화 충돌이 없어요</p>
          )}
          {conflicts.map((item) => (
            <section
              key={item.key}
              className="flex flex-col gap-3 rounded-xl border border-line p-3"
            >
              <p className="text-sm font-semibold">{names[item.key] || item.key}</p>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {[
                  { label: '이 기기 초안', value: item.local },
                  { label: '서버 설정', value: item.server },
                ].map((version) => (
                  <div key={version.label} className="min-w-0 rounded-lg bg-stone p-2 text-xs">
                    <p className="font-semibold">{version.label}</p>
                    <VersionPreview value={version.value} />
                    <details className="mt-2">
                      <summary className="cursor-pointer text-muted">전체 설정 보기</summary>
                      <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-all font-mono text-2xs">
                        {JSON.stringify(version.value, null, 2)}
                      </pre>
                    </details>
                  </div>
                ))}
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  className="btn-primary"
                  disabled={working !== null}
                  onClick={() => void act(item.key, () => resolveSyncConflict(item.key, 'local'))}
                >
                  {working === item.key && <Spinner />} 이 기기 초안 사용
                </button>
                <button
                  className="btn-secondary"
                  disabled={working !== null}
                  onClick={() => void act(item.key, () => resolveSyncConflict(item.key, 'server'))}
                >
                  {working === item.key && <Spinner />} 서버 설정 사용
                </button>
              </div>
            </section>
          ))}
          <div className="border-t border-line pt-3">
            <p className="mb-2 text-xs font-semibold">보관한 버전 · 최근 20건</p>
            {!archive.length && (
              <p className="py-5 text-center text-xs text-muted">보관한 초안이 없어요</p>
            )}
            {archive.map((item, index) => (
              <div
                key={`${item.key}-${item.detectedAt}-${index}`}
                className="flex flex-col gap-2 border-b border-line py-2 text-xs sm:flex-row sm:items-center sm:justify-between"
              >
                <span className="min-w-0">
                  {names[item.key] || item.key}
                  <span className="ml-2 text-muted">
                    {new Date(item.detectedAt).toLocaleString('ko-KR')}
                  </span>
                </span>
                <div className="flex flex-wrap gap-1">
                  <button
                    className="btn-secondary shrink-0"
                    disabled={working !== null || conflicts.some((c) => c.key === item.key)}
                    onClick={() => void act(`archive-${index}`, () => restoreSyncDraft(item))}
                  >
                    {working === `archive-${index}` ? <Spinner /> : <ArchiveRestore size={14} />}{' '}
                    복원
                  </button>
                  <button
                    className="btn-secondary"
                    disabled={working !== null || conflicts.some((c) => c.key === item.key)}
                    onClick={() =>
                      void act(`server-${index}`, () => restoreSyncDraft(item, 'server'))
                    }
                  >
                    {working === `server-${index}` ? <Spinner /> : <ArchiveRestore size={14} />}{' '}
                    서버 버전 복원
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </Modal>
    </>
  );
}
