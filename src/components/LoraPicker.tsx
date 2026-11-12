import { useEffect, useState } from 'react';
import { Layers2, Search } from 'lucide-react';
import { useStudioSelector } from '../studio';
import { compatibleAssets } from '../models';
import { options } from '../domain';
import {
  fetchLoraList,
  isVideoPreview,
  loraPreviewUrl,
  resolveComfyLoraName,
  type LoraItem,
} from '../lora-manager';
import { Modal } from './ui';

export function LoraPicker({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { connection, settings, setSettings, info, familyAssignments, notify } = useStudioSelector(
    (s) => ({
      connection: s.connection,
      settings: s.settings,
      setSettings: s.setSettings,
      info: s.info,
      familyAssignments: s.familyAssignments,
      notify: s.notify,
    }),
  );
  const [items, setItems] = useState<LoraItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [search, setSearch] = useState('');
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setSearch('');
    setItems([]);
    setError(false);
    setLoading(true);
    async function load() {
      try {
        const loaded: LoraItem[] = [];
        let page = 1;
        let totalPages = 1;
        do {
          const result = await fetchLoraList(connection.base, { page, pageSize: 100 });
          if (cancelled) return;
          loaded.push(...result.items);
          totalPages = result.total_pages;
          page++;
        } while (page <= totalPages);
        if (!cancelled) setItems(loaded);
      } catch {
        if (!cancelled) setError(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [open, connection.base, retry]);

  const names = compatibleAssets(info, 'lora', settings.architecture, familyAssignments);
  const allNames = options(info, 'LoraLoaderModelOnly', 'lora_name').concat(
    options(info, 'LoraLoader', 'lora_name'),
  );
  const metadata = new Map(items.map((item) => [resolveComfyLoraName(item, allNames), item]));
  const available = names.filter((name) => !settings.loras.some((lora) => lora.name === name));
  const query = search.trim().toLowerCase();
  const visible = available.filter((name) => {
    const item = metadata.get(name);
    return `${name} ${item?.model_name || ''} ${(item?.tags || []).join(' ')}`
      .toLowerCase()
      .includes(query);
  });

  function choose(name: string) {
    if (settings.loras.length >= 20) {
      notify('LoRA는 최대 20개까지 추가할 수 있어요');
      return;
    }
    setSettings((prev) => {
      if (prev.loras.length >= 20 || prev.loras.some((lora) => lora.name === name)) return prev;
      return {
        ...prev,
        loras: [...prev.loras, { name, model: 0.8, clip: prev.architecture === 'flux' ? 0.8 : 0 }],
      };
    });
    onClose();
  }

  return (
    <Modal title="LoRA 추가" open={open} onClose={onClose} size="lg">
      <div className="flex min-h-0 flex-col gap-3 break-keep">
        <div className="sticky -top-4 z-10 -mx-4 -mt-4 border-b border-line bg-white p-4">
          <p className="mb-3 text-xs text-muted">
            대표 이미지를 눌러 모델과 같은 계열의 LoRA를 추가해요
          </p>
          <div className="relative">
            <Search
              size={15}
              aria-hidden="true"
              className="absolute left-3 top-1/2 -translate-y-1/2 text-muted"
            />
            <input
              type="search"
              aria-label="추가할 LoRA 검색"
              placeholder="이름, 파일명, 태그 검색"
              className="field pl-9"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>
        </div>
        {error && (
          <div
            role="status"
            className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-paper p-3 text-xs"
          >
            <span>대표 이미지를 불러오려면 다시 시도해 주세요 | 파일명으로도 선택할 수 있어요</span>
            <button
              type="button"
              className="btn-secondary"
              onClick={() => setRetry((value) => value + 1)}
            >
              다시 시도
            </button>
          </div>
        )}
        {loading ? (
          <div
            role="status"
            aria-label="LoRA 대표 이미지 불러오는 중"
            className="grid grid-cols-2 gap-3 sm:grid-cols-3"
          >
            {[0, 1, 2, 3, 4, 5].map((key) => (
              <div
                key={key}
                aria-hidden="true"
                className="animate-pulse overflow-hidden rounded-xl border border-line"
              >
                <div className="aspect-[4/3] bg-stone" />
                <div className="m-3 h-4 rounded bg-stone" />
              </div>
            ))}
          </div>
        ) : visible.length ? (
          <div data-ui-audit-card-group className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {visible.map((name) => (
              <LoraCard
                key={name}
                name={name}
                item={metadata.get(name)}
                base={connection.base}
                onChoose={() => choose(name)}
              />
            ))}
          </div>
        ) : (
          <div
            role="status"
            className="flex min-h-40 flex-col items-center justify-center gap-2 text-center text-xs text-muted"
          >
            <Layers2 size={24} aria-hidden="true" />
            <p>
              {query
                ? '검색어에 맞는 LoRA를 찾아보세요'
                : names.length
                  ? '현재 계열의 LoRA를 모두 추가했어요'
                  : '현재 계열의 LoRA를 설치한 뒤 목록을 새로고침해 주세요'}
            </p>
            {query && (
              <button type="button" className="btn-secondary" onClick={() => setSearch('')}>
                검색 초기화
              </button>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}

function LoraCard({
  name,
  item,
  base,
  onChoose,
}: {
  name: string;
  item?: LoraItem;
  base: string;
  onChoose: () => void;
}) {
  const src = loraPreviewUrl(base, item?.preview_url);
  const [failedSrc, setFailedSrc] = useState('');
  const blurred = (item?.preview_nsfw_level || 0) >= 4;
  const title = item?.model_name || name.replaceAll('\\', '/').split('/').pop() || name;
  return (
    <button
      type="button"
      data-ui-audit-card
      aria-label={name}
      onClick={onChoose}
      className="group flex min-w-0 flex-col overflow-hidden rounded-xl border border-line bg-white text-left transition hover:border-olive hover:shadow-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-olive"
    >
      <span className="relative block aspect-[4/3] w-full overflow-hidden bg-stone">
        {src && failedSrc !== src ? (
          isVideoPreview(src) ? (
            <video
              src={src}
              muted
              playsInline
              preload="metadata"
              onError={() => setFailedSrc(src)}
              className={`h-full w-full object-contain ${blurred ? 'blur-xl' : ''}`}
            />
          ) : (
            <img
              src={src}
              alt={`${title} 대표 이미지`}
              loading="lazy"
              onError={() => setFailedSrc(src)}
              className={`h-full w-full object-contain ${blurred ? 'blur-xl' : ''}`}
            />
          )
        ) : (
          <span className="flex h-full flex-col items-center justify-center gap-2 text-muted">
            <Layers2 size={24} aria-hidden="true" />
            <span className="text-xs">파일명으로 선택</span>
          </span>
        )}
        {blurred && (
          <span className="absolute inset-0 flex items-center justify-center text-xs font-semibold text-ink">
            민감한 이미지
          </span>
        )}
        <span
          aria-hidden="true"
          className="absolute bottom-2 right-2 flex h-7 w-7 items-center justify-center rounded-full bg-white text-olive shadow-sm transition group-hover:bg-olive group-hover:text-white"
        >
          +
        </span>
      </span>
      <span className="flex w-full min-w-0 flex-1 flex-col gap-1 p-3">
        <span className="line-clamp-2 text-xs font-bold [overflow-wrap:anywhere]">{title}</span>
        <span className="mt-auto truncate font-mono text-2xs text-muted">{name}</span>
      </span>
    </button>
  );
}
