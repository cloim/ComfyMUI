import { useState, useEffect, useRef } from 'react';
import {
  Images,
  Search,
  Trash2,
  Star,
  CheckSquare,
  Square,
  ArrowLeftRight,
  Download,
  Filter,
  X,
} from 'lucide-react';
import { Link, useSearchParams } from 'react-router-dom';
import { useStudio } from '../studio';
import { type Job } from '../domain';
import { imageUrl, thumbnailUrl } from '../api';
import { Modal, Empty, IconButton } from '../components/ui';
import { Result } from '../components/Result';
import { CompareViewer } from '../components/CompareViewer';

export default function Gallery() {
  const { jobs, setJobs, notify, clearBadge, toggleFavorite, deleteJobs } = useStudio();
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const [favoriteOnly, setFavoriteOnly] = useState(false);
  const [familyFilter, setFamilyFilter] = useState('all');
  const [loraFilter, setLoraFilter] = useState('all');

  const [isSelecting, setIsSelecting] = useState(false);
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

  const shown = jobs.filter((j) => {
    const matchSearch = `${j.settings.positive} ${j.settings.model}`
      .toLowerCase()
      .includes(search.toLowerCase());
    if (!matchSearch) return false;

    if (filter === 'real' && j.preview) return false;
    if (filter === 'complete' && j.status !== 'complete') return false;
    if (filter === 'error' && j.status !== 'error') return false;

    if (favoriteOnly && !j.favorite) return false;
    if (familyFilter !== 'all' && j.settings.architecture !== familyFilter) return false;
    if (loraFilter === 'with_lora' && (!j.settings.loras || j.settings.loras.length === 0))
      return false;
    if (loraFilter === 'without_lora' && j.settings.loras && j.settings.loras.length > 0)
      return false;

    return true;
  });

  const detail = jobs.find((j) => j.id === selected);

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
      setIsSelecting(true);
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

  const executeBatchDelete = () => {
    deleteJobs(Array.from(selectedIds));
    setSelectedIds(new Set());
    setIsSelecting(false);
    setBatchRemoveConfirm(false);
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Top Filter and Controls */}
      <div className="flex flex-none flex-col gap-3 px-4 py-4 sm:px-7 lg:px-9">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-xs text-muted">
            기록 {shown.length}개 {jobs.length !== shown.length ? `(전체 ${jobs.length}개)` : ''}
          </span>
          <div className="flex items-center gap-2">
            {isSelecting ? (
              <>
                <button
                  onClick={handleSelectAll}
                  className="rounded-lg border border-border bg-white px-3 py-1.5 text-xs font-semibold text-ink hover:bg-stone"
                >
                  {selectedIds.size === shown.length ? '선택 해제' : '전체 선택'}
                </button>
                <button
                  onClick={() => {
                    setIsSelecting(false);
                    setSelectedIds(new Set());
                  }}
                  className="rounded-lg border border-border bg-white px-3 py-1.5 text-xs font-semibold text-muted hover:bg-stone"
                >
                  취소
                </button>
              </>
            ) : (
              <button
                onClick={() => setIsSelecting(true)}
                className="rounded-lg border border-border bg-white px-3 py-1.5 text-xs font-semibold text-ink hover:bg-stone"
              >
                다중 선택
              </button>
            )}
          </div>
        </div>

        {/* Search Input */}
        <label className="relative w-full sm:max-w-96">
          <Search size={17} className="absolute left-3 top-3.5 text-muted" />
          <input
            className="field pl-10"
            aria-label="기록 검색"
            placeholder="프롬프트와 모델로 검색"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>

        {/* Tab Filters (All, Favorites, Status) */}
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => setFavoriteOnly((v) => !v)}
            aria-pressed={favoriteOnly}
            className={`flex items-center gap-1.5 rounded-full px-4 py-2 text-xs font-medium transition ${
              favoriteOnly
                ? 'bg-amber-500 text-white shadow-sm'
                : 'bg-white text-muted hover:bg-stone border border-border'
            }`}
          >
            <Star size={13} className={favoriteOnly ? 'fill-white' : ''} />
            즐겨찾기
          </button>

          {[
            ['all', '전체 상태'],
            ['real', '실제 생성'],
            ['complete', '완료'],
            ['error', '오류'],
          ].map(([v, l]) => (
            <button
              key={v}
              onClick={() => setFilter(v)}
              aria-pressed={filter === v}
              className={`rounded-full px-3.5 py-2 text-xs font-medium transition ${
                filter === v ? 'bg-ink text-white' : 'bg-white text-muted hover:bg-stone border border-border'
              }`}
            >
              {l}
            </button>
          ))}
        </div>

        {/* Architecture & LoRA Filters */}
        <div className="flex flex-wrap items-center gap-2 pt-1 text-xs">
          <div className="flex items-center gap-1.5">
            <span className="text-muted">모델:</span>
            <select
              value={familyFilter}
              onChange={(e) => setFamilyFilter(e.target.value)}
              className="rounded-lg border border-border bg-white px-2 py-1.5 text-xs font-medium text-ink"
            >
              <option value="all">전체 모델 계열</option>
              <option value="flux">Flux 계열</option>
              <option value="krea2">Krea2 계열</option>
              <option value="moss">MOSS 계열</option>
              <option value="qwen21">Qwen2.5 계열</option>
            </select>
          </div>

          <div className="flex items-center gap-1.5">
            <span className="text-muted">LoRA:</span>
            <select
              value={loraFilter}
              onChange={(e) => setLoraFilter(e.target.value)}
              className="rounded-lg border border-border bg-white px-2 py-1.5 text-xs font-medium text-ink"
            >
              <option value="all">전체</option>
              <option value="with_lora">LoRA 적용됨</option>
              <option value="without_lora">LoRA 없음</option>
            </select>
          </div>
        </div>
      </div>

      {/* Grid Content */}
      <div
        data-ui-audit-scroll-root
        className="min-h-0 flex-1 overflow-y-auto px-4 pb-20 sm:px-7 lg:px-9"
      >
        {shown.length ? (
          <div
            data-ui-audit-card-group
            className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4"
          >
            {shown.map((j) => {
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
                  {/* Select Checkbox (when in selection mode) */}
                  {isSelecting && (
                    <button
                      type="button"
                      onClick={() => toggleSelectJob(j.id)}
                      className="absolute left-2.5 top-2.5 z-10 flex h-7 w-7 items-center justify-center rounded-lg bg-black/60 text-white backdrop-blur-sm"
                    >
                      {isChecked ? (
                        <CheckSquare size={17} className="text-olive fill-olive" />
                      ) : (
                        <Square size={17} />
                      )}
                    </button>
                  )}

                  {/* Favorite Badge / Star button */}
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleFavorite(j.id);
                    }}
                    aria-label={j.favorite ? '즐겨찾기 해제' : '즐겨찾기 등록'}
                    className={`absolute right-2.5 top-2.5 z-10 flex h-7 w-7 items-center justify-center rounded-lg backdrop-blur-sm transition ${
                      j.favorite
                        ? 'bg-amber-500/90 text-white'
                        : 'bg-black/40 text-white/70 hover:bg-black/60 hover:text-white'
                    }`}
                  >
                    <Star size={14} className={j.favorite ? 'fill-white' : ''} />
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
                        className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
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
                      <span className="absolute left-2 top-2 rounded-full bg-white/90 px-2.5 py-1 text-[10px] font-medium">
                        미리보기
                      </span>
                    )}
                  </button>

                  <div data-ui-audit-row className="flex items-center justify-between gap-1 p-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <p className="text-xs font-semibold">{labels[j.status]}</p>
                        {j.settings.loras && j.settings.loras.length > 0 && (
                          <span className="rounded bg-sand px-1.5 py-0.5 text-[9px] font-medium text-ink">
                            LoRA {j.settings.loras.length}
                          </span>
                        )}
                      </div>
                      <p className="mt-1 truncate text-[10px] text-muted">
                        {new Date(j.createdAt).toLocaleDateString('ko-KR')} ·{' '}
                        {j.settings.architecture}
                      </p>
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
        ) : (
          <Empty
            icon={Images}
            title={jobs.length ? '조건에 맞는 기록을 찾아보세요' : '첫 번째 장면을 만들어 보세요'}
            description={
              jobs.length
                ? '검색어 또는 상태·모델 필터를 바꾸면 다른 기록을 볼 수 있어요'
                : '생성한 이미지와 설정을 이곳에서 다시 만날 수 있어요'
            }
          >
            <Link className="btn-primary" to="/create">
              이미지 만들기
            </Link>
          </Empty>
        )}
      </div>

      {/* Floating Bottom Action Bar for Multi-Selection */}
      {isSelecting && selectedIds.size > 0 && (
        <div className="fixed bottom-4 inset-x-4 max-w-md mx-auto z-40 flex items-center justify-between gap-2 rounded-2xl border border-border bg-white/95 p-3 shadow-xl backdrop-blur-md">
          <span className="text-xs font-bold text-ink pl-1">
            {selectedIds.size}개 선택됨
          </span>

          <div className="flex items-center gap-2">
            {selectedIds.size === 2 && (
              <button
                type="button"
                onClick={handleCompareSelected}
                className="inline-flex items-center gap-1.5 rounded-xl bg-olive px-3 py-2 text-xs font-bold text-white shadow-sm hover:opacity-90"
              >
                <ArrowLeftRight size={14} />
                비교하기
              </button>
            )}
            <button
              type="button"
              onClick={handleBatchDownload}
              className="inline-flex items-center gap-1 rounded-xl border border-border bg-stone px-3 py-2 text-xs font-semibold text-ink hover:bg-sand"
            >
              <Download size={14} />
              저장
            </button>
            <button
              type="button"
              onClick={() => setBatchRemoveConfirm(true)}
              className="inline-flex items-center gap-1 rounded-xl bg-red-600 px-3 py-2 text-xs font-bold text-white hover:bg-red-700"
            >
              <Trash2 size={14} />
              삭제
            </button>
          </div>
        </div>
      )}

      {/* Single Item Detail Modal */}
      <Modal title="생성 기록" open={Boolean(detail)} onClose={() => setSelected(null)}>
        {detail && <Result key={detail.id} job={detail} />}
      </Modal>

      {/* Single Delete Confirm Modal */}
      <Modal
        title="기록을 삭제할까요?"
        open={Boolean(remove)}
        onClose={() => setRemove(null)}
        footer={
          <>
            <button className="btn-secondary" onClick={() => setRemove(null)}>
              유지하기
            </button>
            <button
              className="btn-danger"
              onClick={() => {
                if (remove) {
                  deleteJobs([remove.id]);
                  setRemove(null);
                }
              }}
            >
              기록 삭제
            </button>
          </>
        }
      >
        <p className="text-sm leading-relaxed text-muted">
          이 기기의 기록과 설정 스냅샷을 삭제합니다
          <br />
          ComfyUI 서버에 저장된 이미지는 유지돼요
        </p>
      </Modal>

      {/* Batch Delete Confirm Modal */}
      <Modal
        title={`선택한 ${selectedIds.size}개 기록을 삭제할까요?`}
        open={batchRemoveConfirm}
        onClose={() => setBatchRemoveConfirm(false)}
        footer={
          <>
            <button className="btn-secondary" onClick={() => setBatchRemoveConfirm(false)}>
              취소
            </button>
            <button className="btn-danger" onClick={executeBatchDelete}>
              {selectedIds.size}개 일괄 삭제
            </button>
          </>
        }
      >
        <p className="text-sm leading-relaxed text-muted">
          선택된 항목들의 기록과 스냅샷을 기기에서 모두 삭제합니다.
          <br />
          즐겨찾기 항목도 선택된 경우 함께 삭제됩니다.
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
