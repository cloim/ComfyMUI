import { useState, useEffect, useLayoutEffect, useRef, useMemo } from 'react';
import {
  Images,
  Search,
  Trash2,
  Check,
  X,
  ArrowLeftRight,
  Download,
  RefreshCw,
} from 'lucide-react';
import { Link, useSearchParams } from 'react-router-dom';
import { useStudio } from '../studio';
import { type Job } from '../domain';
import { imageUrl, thumbnailUrl } from '../api';
import { Modal, Empty, IconButton, SelectControl, Spinner } from '../components/ui';
import { HistoryDetail } from '../components/HistoryDetail';
import { Result } from '../components/Result';
import { CompareViewer } from '../components/CompareViewer';
import { HeaderActions, HeaderActionButton } from '../components/HeaderActions';
import {
  galleryWindow,
  galleryRowHeight,
  readGalleryView,
  GALLERY_VIEW_KEY,
} from '../gallery-window';

const modelName = (path: string) =>
  path
    .split(/[\\/]/)
    .pop()
    ?.replace(/\.(safetensors|gguf|ckpt|pt|pth|bin)$/i, '') || '';

export default function Gallery() {
  const {
    jobs: localJobs,
    notify,
    clearBadge,
    deleteJobs,
    gallery,
    refreshGallery,
    galleryJob,
    defaultPrompts,
  } = useStudio();
  const fileJobs = useMemo(
    () => gallery?.files.map((f) => galleryJob(f, defaultPrompts.negative)) || [],
    [gallery, galleryJob, defaultPrompts.negative],
  );
  const writtenTimes = useMemo(() => {
    const times = new Map<string, number>();
    for (const file of gallery?.files || []) {
      const key = JSON.stringify([file.settings?.seed, file.settings?.positive]);
      times.set(key, Math.max(times.get(key) || 0, file.mtime));
    }
    return times;
  }, [gallery]);
  // History is the ComfyUI output folder. Generations still running are shown first.
  // Without the folder (preview mode, direct ComfyUI address) the local records are used.
  const jobs = useMemo(() => {
    if (!gallery) return localJobs;
    // A running job whose image is already in the folder is shown only once, as the file.
    const written = (j: Job) =>
      (writtenTimes.get(JSON.stringify([j.settings.seed, j.settings.positive])) || 0) >=
      j.createdAt - 60_000;
    const active = localJobs.filter(
      (j) => ['submitting', 'queued', 'running'].includes(j.status) && !written(j),
    );
    return [...active, ...fileJobs];
  }, [gallery, localJobs, fileJobs, writtenTimes]);
  const [deleting, setDeleting] = useState(false);
  const [savedView] = useState(readGalleryView);
  const [search, setSearch] = useState(savedView.search);
  const [familyFilter, setFamilyFilter] = useState(savedView.family);
  const [loraFilter, setLoraFilter] = useState(savedView.lora);
  const [experimentFilter, setExperimentFilter] = useState(savedView.experiment);
  const [refreshing, setRefreshing] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const restorePending = useRef(true);
  const [viewport, setViewport] = useState({ width: 0, height: 0, columns: 2 });
  const previousViewport = useRef<typeof viewport | null>(null);
  const pendingResizeTop = useRef<number | null>(null);
  const [scrollTop, setScrollTop] = useState(savedView.scrollTop);
  const viewRef = useRef(savedView);
  viewRef.current = {
    search,
    family: familyFilter,
    lora: loraFilter,
    experiment: experimentFilter,
    scrollTop: viewRef.current.scrollTop,
  };
  const persistView = () => {
    try {
      sessionStorage.setItem(GALLERY_VIEW_KEY, JSON.stringify(viewRef.current));
    } catch {
      /* Private browsing can restrict session storage. */
    }
  };
  const resetScroll = () => {
    restorePending.current = false;
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
    viewRef.current.scrollTop = 0;
    setScrollTop(0);
  };
  useLayoutEffect(() => {
    const root = scrollRef.current;
    if (!root) return;
    const measure = () => {
      const styles = getComputedStyle(root);
      const next = {
        width: root.clientWidth - parseFloat(styles.paddingLeft) - parseFloat(styles.paddingRight),
        height: root.clientHeight,
        columns: window.innerWidth >= 1280 ? 4 : window.innerWidth >= 768 ? 3 : 2,
      };
      const previous = previousViewport.current;
      if (
        previous &&
        !restorePending.current &&
        (previous.width !== next.width || previous.columns !== next.columns)
      ) {
        const atEnd = root.scrollHeight - root.clientHeight - root.scrollTop < 2;
        const anchor =
          Math.floor(root.scrollTop / galleryRowHeight(previous.width, previous.columns)) *
          previous.columns;
        pendingResizeTop.current = atEnd
          ? Number.MAX_SAFE_INTEGER
          : Math.floor(anchor / next.columns) * galleryRowHeight(next.width, next.columns);
      }
      previousViewport.current = next;
      setViewport(next);
    };
    const observer = new ResizeObserver(measure);
    observer.observe(root);
    window.addEventListener('resize', measure);
    window.addEventListener('pagehide', persistView);
    measure();
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', measure);
      window.removeEventListener('pagehide', persistView);
      persistView();
    };
  }, []);
  useEffect(() => {
    persistView();
  }, [search, familyFilter, loraFilter, experimentFilter]);

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [comparingPair, setComparingPair] = useState<[Job, Job] | null>(null);
  const [batchRemoveConfirm, setBatchRemoveConfirm] = useState(false);

  const [params] = useSearchParams();
  const [selected, setSelected] = useState<string | null>(() => params.get('job'));
  const [remove, setRemove] = useState<Job | null>(null);

  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    clearBadge();
  }, [clearBadge]);

  useEffect(() => {
    void refreshGallery();
  }, []);

  const experiments = useMemo(() => {
    const result = new Map<string, string>();
    for (const job of jobs)
      if (job.settings.experiment)
        result.set(job.settings.experiment.id, job.settings.experiment.label);
    return [...result];
  }, [jobs]);
  const shown = useMemo(
    () =>
      jobs.filter((j) => {
        const matchSearch = `${j.settings.positive} ${j.settings.model}`
          .toLowerCase()
          .includes(search.toLowerCase());
        if (!matchSearch) return false;

        if (familyFilter !== 'all' && j.settings.architecture !== familyFilter) return false;
        if (loraFilter === 'with_lora' && (!j.settings.loras || j.settings.loras.length === 0))
          return false;
        if (loraFilter === 'without_lora' && j.settings.loras && j.settings.loras.length > 0)
          return false;
        if (experimentFilter !== 'all' && j.settings.experiment?.id !== experimentFilter)
          return false;

        return true;
      }),
    [jobs, search, familyFilter, loraFilter, experimentFilter],
  );
  const rowHeight = galleryRowHeight(viewport.width, viewport.columns);
  const windowed = galleryWindow(
    shown.length,
    viewport.columns,
    rowHeight,
    scrollTop,
    viewport.height,
  );
  useLayoutEffect(() => {
    if (pendingResizeTop.current === null || !scrollRef.current) return;
    scrollRef.current.scrollTop = pendingResizeTop.current;
    viewRef.current.scrollTop = scrollRef.current.scrollTop;
    setScrollTop(scrollRef.current.scrollTop);
    pendingResizeTop.current = null;
  }, [viewport.width, viewport.columns]);
  useLayoutEffect(() => {
    if (!restorePending.current || !shown.length || !scrollRef.current || !viewport.width) return;
    scrollRef.current.scrollTop = savedView.scrollTop;
    setScrollTop(scrollRef.current.scrollTop);
    restorePending.current = false;
  }, [shown.length, viewport.width, savedView.scrollTop]);

  const detail = jobs.find((j) => j.id === selected);
  const imageJobs = shown.filter((j) => j.status === 'complete' && j.images.length > 0);
  const imageIndex = imageJobs.findIndex((j) => j.id === selected);
  const isSelecting = selectedIds.size > 0;

  const labels = {
    submitting: '전송 중',
    queued: '대기 중',
    running: '생성 중',
    complete: '완료',
    error: '오류',
    cancelled: '취소',
  };

  const toggleSelectJob = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleSelectAll = () => {
    if (selectedIds.size === shown.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(shown.map((j) => j.id)));
    }
  };

  const handleTouchStart = (jobId: string) => {
    longPressTimerRef.current = setTimeout(() => {
      toggleSelectJob(jobId);
    }, 500);
  };

  const handleTouchEnd = () => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  };

  const handleBatchDownload = async () => {
    const targets = jobs.filter((j) => selectedIds.has(j.id) && j.images[0]);
    if (targets.length === 0) return;
    notify(`${targets.length}개 이미지 다운로드를 시작했어요`);
    for (const j of targets) {
      const url = j.preview ? '/sample.svg' : imageUrl(j.base, j.images[0]);
      const a = document.createElement('a');
      a.href = url;
      a.download = j.images[0].filename || 'image.png';
      a.target = '_blank';
      a.click();
      await new Promise((r) => setTimeout(r, 200));
    }
  };

  const handleCompareSelected = () => {
    const selectedJobs = jobs.filter((j) => selectedIds.has(j.id));
    if (selectedJobs.length === 2) {
      setComparingPair([selectedJobs[0], selectedJobs[1]]);
    }
  };

  const executeBatchDelete = async () => {
    setDeleting(true);
    const ok = await deleteJobs(Array.from(selectedIds));
    setDeleting(false);
    if (!ok) return;
    setSelectedIds(new Set());
    setBatchRemoveConfirm(false);
  };

  const executeSingleDelete = async () => {
    if (!remove) return;
    setDeleting(true);
    const ok = await deleteJobs([remove.id]);
    setDeleting(false);
    if (ok) setRemove(null);
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <HeaderActions>
        <HeaderActionButton
          icon={RefreshCw}
          label="기록 새로고침"
          busy={refreshing}
          onClick={async () => {
            setRefreshing(true);
            try {
              await refreshGallery(true);
            } finally {
              setRefreshing(false);
            }
          }}
        />
      </HeaderActions>
      {/* Search and filters, with the count at the end of the row */}
      <div className="flex flex-none flex-wrap items-center gap-2 px-4 py-4 sm:px-5 lg:px-6">
        <div
          data-ui-audit-row
          className="flex w-full min-w-0 items-center gap-2 sm:w-auto sm:flex-1"
        >
          <label className="relative min-w-0 flex-1 sm:max-w-96">
            <Search
              size={15}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted"
            />
            <input
              className="field pl-10"
              aria-label="기록 검색"
              placeholder="검색"
              value={search}
              onChange={(e) => {
                resetScroll();
                setSearch(e.target.value);
              }}
            />
          </label>
          <div className="w-28 shrink-0 sm:w-40">
            <SelectControl
              aria-label="모델 계열 필터"
              value={familyFilter}
              onChange={(e) => {
                resetScroll();
                setFamilyFilter(e.target.value);
              }}
            >
              <option value="all">전체 계열</option>
              <option value="flux">Flux 계열</option>
              <option value="krea2">Krea2 계열</option>
              <option value="moss">MOSS 계열</option>
              <option value="qwen21">Qwen2.5 계열</option>
            </SelectControl>
          </div>
          <div className="w-28 shrink-0 sm:w-36">
            <SelectControl
              aria-label="LoRA 필터"
              value={loraFilter}
              onChange={(e) => {
                resetScroll();
                setLoraFilter(e.target.value);
              }}
            >
              <option value="all">LoRA 전체</option>
              <option value="with_lora">LoRA 적용</option>
              <option value="without_lora">LoRA 없음</option>
            </SelectControl>
          </div>
        </div>
        {(experiments.length > 0 || experimentFilter !== 'all') && (
          <div className="w-40 max-w-full">
            <SelectControl
              aria-label="실험 묶음 필터"
              value={experimentFilter}
              onChange={(e) => {
                resetScroll();
                setExperimentFilter(e.target.value);
              }}
            >
              <option value="all">실험 전체</option>
              {experiments.map(([id], i) => (
                <option key={id} value={id}>
                  실험 {experiments.length - i} · {id.slice(-5)}
                </option>
              ))}
              {experimentFilter !== 'all' &&
                !experiments.some(([id]) => id === experimentFilter) && (
                  <option value={experimentFilter}>이전 실험</option>
                )}
            </SelectControl>
          </div>
        )}
        <span className="ml-auto shrink-0 font-mono text-2xs text-muted">
          표시 {shown.length} / {jobs.length}개
        </span>
      </div>

      {/* Grid Content */}
      <div
        ref={scrollRef}
        tabIndex={0}
        aria-label="기록 목록"
        data-ui-audit-scroll-root
        className="min-h-0 flex-1 overflow-y-auto px-4 pb-20 sm:px-5 lg:px-6"
        onScroll={(event) => {
          const top = event.currentTarget.scrollTop;
          viewRef.current.scrollTop = top;
          if (Math.floor(top / rowHeight) !== Math.floor(scrollTop / rowHeight)) setScrollTop(top);
        }}
        onTouchMove={handleTouchEnd}
        onTouchCancel={handleTouchEnd}
      >
        {shown.length ? (
          <>
            {windowed.top > 0 && <div aria-hidden="true" style={{ height: windowed.top }} />}
            <div
              data-ui-audit-card-group
              className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4"
              style={{ gridAutoRows: rowHeight - 12 }}
            >
              {shown.slice(windowed.start, windowed.end).map((j) => {
                const isChecked = selectedIds.has(j.id);
                return (
                  <article
                    key={j.id}
                    data-ui-audit-card
                    data-ui-audit-card-type="gallery-item"
                    className={`group relative flex h-full min-w-0 flex-col overflow-hidden rounded-2xl border bg-white transition ${
                      isChecked ? 'border-olive ring-2 ring-olive/50' : 'border-line'
                    }`}
                    onTouchStart={() => handleTouchStart(j.id)}
                    onTouchEnd={handleTouchEnd}
                  >
                    <button
                      type="button"
                      role="checkbox"
                      aria-checked={isChecked}
                      aria-label="이미지 선택"
                      onClick={() => toggleSelectJob(j.id)}
                      className="absolute left-1.5 top-1.5 z-10 flex h-9 w-9 items-center justify-center"
                    >
                      <span
                        className={`flex h-[22px] w-[22px] items-center justify-center rounded-md border-2 shadow-sm transition ${
                          isChecked
                            ? 'border-olive bg-olive text-white'
                            : 'border-white bg-black/25 text-transparent hover:bg-black/40'
                        }`}
                      >
                        <Check size={14} strokeWidth={3} aria-hidden="true" />
                      </span>
                    </button>

                    <button
                      className="relative block aspect-[3/4] w-full overflow-hidden bg-stone"
                      onClick={() => {
                        if (isSelecting) {
                          toggleSelectJob(j.id);
                        } else {
                          setSelected(j.id);
                        }
                      }}
                      aria-label={`${labels[j.status]} 이미지 상세 보기`}
                    >
                      {j.status === 'complete' && j.images[0] ? (
                        <img
                          loading="lazy"
                          className="h-full w-full object-contain"
                          src={j.preview ? '/sample.svg' : thumbnailUrl(j.base, j.images[0])}
                          alt={j.preview ? '미리보기 샘플' : j.settings.positive.slice(0, 100)}
                          onError={(e) => {
                            const original = imageUrl(j.base, j.images[0]);
                            if (e.currentTarget.src !== original) {
                              e.currentTarget.src = original;
                            } else {
                              e.currentTarget.style.visibility = 'hidden';
                            }
                          }}
                        />
                      ) : (
                        <div className="flex h-full flex-col items-center justify-center gap-3 p-3 text-center text-xs text-muted">
                          <Images size={28} />
                          <span>{labels[j.status]}</span>
                          {['running', 'queued'].includes(j.status) && (
                            <span className="font-mono">{j.progress}%</span>
                          )}
                        </div>
                      )}
                      {j.preview && (
                        <span className="absolute right-2 top-2 rounded-full bg-white/90 px-2.5 py-1 text-2xs font-medium">
                          미리보기
                        </span>
                      )}
                    </button>

                    <div
                      data-ui-audit-row
                      className="flex h-[76px] shrink-0 items-center justify-between gap-1 p-3"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <p className="min-w-0 truncate text-xs font-semibold">
                            {j.status === 'complete'
                              ? modelName(j.settings.model) || labels.complete
                              : labels[j.status]}
                          </p>
                          {j.settings.loras && j.settings.loras.length > 0 && (
                            <span className="rounded bg-stone px-1.5 py-0.5 text-2xs font-medium text-ink">
                              LoRA {j.settings.loras.length}
                            </span>
                          )}
                        </div>
                        <p className="mt-1 truncate text-2xs text-muted">
                          {new Date(j.createdAt).toLocaleDateString('ko-KR')} |{' '}
                          {j.settings.architecture}
                        </p>
                        {j.settings.experiment && (
                          <button
                            className="mt-0.5 block max-w-full truncate text-2xs font-semibold text-olive"
                            onClick={() => {
                              resetScroll();
                              setExperimentFilter(j.settings.experiment!.id);
                            }}
                            aria-label={`실험 묶음 보기: ${j.settings.experiment.label}`}
                          >
                            {j.settings.experiment.label}
                          </button>
                        )}
                      </div>
                      {!isSelecting && (
                        <IconButton
                          icon={Trash2}
                          danger
                          className="-mr-1"
                          label="기록 삭제"
                          disabled={['submitting', 'running', 'queued'].includes(j.status)}
                          onClick={() => setRemove(j)}
                        />
                      )}
                    </div>
                  </article>
                );
              })}
            </div>
            {windowed.bottom > 0 && <div aria-hidden="true" style={{ height: windowed.bottom }} />}
          </>
        ) : (
          <Empty
            icon={Images}
            title={jobs.length ? '조건에 맞는 기록을 찾아보세요' : '첫 번째 장면을 만들어 보세요'}
            description={
              jobs.length
                ? '검색어나 모델과 LoRA 필터를 바꾸면 다른 이미지를 볼 수 있어요'
                : '생성한 이미지와 설정을 이곳에서 다시 만날 수 있어요'
            }
          >
            {(search ||
              familyFilter !== 'all' ||
              loraFilter !== 'all' ||
              experimentFilter !== 'all') && (
              <button
                className="btn-secondary"
                onClick={() => {
                  resetScroll();
                  setSearch('');
                  setFamilyFilter('all');
                  setLoraFilter('all');
                  setExperimentFilter('all');
                }}
              >
                필터 초기화
              </button>
            )}
            <Link className="btn-primary" to="/create">
              이미지 만들기
            </Link>
          </Empty>
        )}
      </div>

      {/* Floating Bottom Action Bar for Multi-Selection */}
      {isSelecting && (
        <div className="fixed inset-x-4 bottom-20 z-40 mx-auto flex max-w-md items-center justify-between gap-2 rounded-2xl border border-line bg-white/95 py-2 pl-1.5 pr-2 shadow-xl backdrop-blur-md md:bottom-4">
          <div className="flex min-w-0 items-center gap-1">
            <IconButton icon={X} label="선택 해제" onClick={() => setSelectedIds(new Set())} />
            <span className="whitespace-nowrap text-xs font-bold text-ink">
              {selectedIds.size}개 선택
            </span>
            {selectedIds.size < shown.length && (
              <button
                type="button"
                onClick={handleSelectAll}
                className="whitespace-nowrap rounded-lg px-2 py-1.5 text-xs font-semibold text-olive hover:bg-paper"
              >
                전체 선택
              </button>
            )}
          </div>

          <div className="flex items-center gap-1.5">
            {selectedIds.size === 2 && (
              <button
                type="button"
                onClick={handleCompareSelected}
                className="inline-flex min-h-9 items-center gap-1.5 whitespace-nowrap rounded-xl bg-olive px-3 text-xs font-bold text-white shadow-sm hover:opacity-90"
              >
                <ArrowLeftRight size={14} aria-hidden="true" />
                비교
              </button>
            )}
            <button
              type="button"
              onClick={handleBatchDownload}
              aria-label="선택 이미지 저장"
              className="inline-flex min-h-9 min-w-9 items-center justify-center gap-1 rounded-xl border border-line bg-stone px-2.5 text-xs font-semibold text-ink hover:bg-stone sm:px-3"
            >
              <Download size={14} aria-hidden="true" />
              <span className="hidden sm:inline">저장</span>
            </button>
            <button
              type="button"
              onClick={() => setBatchRemoveConfirm(true)}
              aria-label="선택 이미지 삭제"
              className="inline-flex min-h-9 min-w-9 items-center justify-center gap-1 rounded-xl bg-red-600 px-2.5 text-xs font-bold text-white hover:bg-red-700 sm:px-3"
            >
              <Trash2 size={14} aria-hidden="true" />
              <span className="hidden sm:inline">삭제</span>
            </button>
          </div>
        </div>
      )}

      {/* Single Item Detail Modal */}
      <Modal title="생성 기록" open={Boolean(detail)} onClose={() => setSelected(null)}>
        {detail &&
          (imageIndex >= 0 ? (
            <HistoryDetail
              job={detail}
              index={imageIndex}
              count={imageJobs.length}
              onNavigate={(direction) => {
                const next = imageJobs[imageIndex + direction];
                if (imageIndex >= 0 && next) setSelected(next.id);
              }}
            />
          ) : (
            <Result key={detail.id} job={detail} />
          ))}
      </Modal>

      {/* Single Delete Confirm Modal */}
      <Modal
        title={gallery ? '이미지를 삭제할까요?' : '기록을 삭제할까요?'}
        open={Boolean(remove)}
        onClose={() => {
          if (!deleting) setRemove(null);
        }}
        footer={
          <>
            <button className="btn-secondary" disabled={deleting} onClick={() => setRemove(null)}>
              유지하기
            </button>
            <button
              className="btn-danger disabled:cursor-wait disabled:opacity-60"
              disabled={deleting}
              onClick={() => void executeSingleDelete()}
            >
              {deleting ? <Spinner /> : <Trash2 size={14} aria-hidden="true" />}
              {gallery ? '파일 삭제' : '기록 삭제'}
            </button>
          </>
        }
      >
        <p className="text-xs leading-relaxed text-muted">
          {gallery ? (
            <>
              ComfyUI output 폴더의 이미지 파일을 삭제해요
              <br />
              삭제한 파일은 되돌릴 수 없어요
            </>
          ) : (
            '이 기기의 기록을 삭제해요'
          )}
        </p>
      </Modal>

      {/* Batch Delete Confirm Modal */}
      <Modal
        title={`선택한 ${selectedIds.size}개 ${gallery ? '이미지를' : '기록을'} 삭제할까요?`}
        open={batchRemoveConfirm}
        onClose={() => {
          if (!deleting) setBatchRemoveConfirm(false);
        }}
        footer={
          <>
            <button
              className="btn-secondary"
              disabled={deleting}
              onClick={() => setBatchRemoveConfirm(false)}
            >
              취소
            </button>
            <button
              className="btn-danger disabled:cursor-wait disabled:opacity-60"
              disabled={deleting}
              onClick={() => void executeBatchDelete()}
            >
              {deleting ? <Spinner /> : <Trash2 size={14} aria-hidden="true" />}
              {selectedIds.size}개 일괄 삭제
            </button>
          </>
        }
      >
        <p className="text-xs leading-relaxed text-muted">
          {gallery ? (
            <>
              선택한 이미지 파일을 ComfyUI output 폴더에서 삭제해요
              <br />
              삭제한 파일은 되돌릴 수 없어요
            </>
          ) : (
            '선택한 기록을 이 기기에서 삭제해요'
          )}
        </p>
      </Modal>

      {/* Compare Viewer Modal */}
      {comparingPair && (
        <CompareViewer
          leftJob={comparingPair[0]}
          rightJob={comparingPair[1]}
          onClose={() => setComparingPair(null)}
        />
      )}
    </div>
  );
}
