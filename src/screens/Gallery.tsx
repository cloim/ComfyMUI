import { useState } from 'react';
import { Images, Search, Trash2 } from 'lucide-react';
import { Link, useSearchParams } from 'react-router-dom';
import { useStudio } from '../studio';
import { type Job } from '../domain';
import { imageUrl, thumbnailUrl } from '../api';
import { Modal, Empty, IconButton } from '../components/ui';
import { Result } from '../components/Result';
export default function Gallery() {
  const { jobs, setJobs, notify } = useStudio();
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const [params] = useSearchParams();
  const [selected, setSelected] = useState<string | null>(() => params.get('job'));
  const [remove, setRemove] = useState<Job | null>(null);
  const shown = jobs.filter(
    (j) =>
      (filter === 'all' ||
        (filter === 'real'
          ? !j.preview
          : filter === 'complete'
            ? j.status === 'complete'
            : j.status === 'error')) &&
      `${j.settings.positive} ${j.settings.model}`
        .toLocaleLowerCase()
        .includes(search.toLocaleLowerCase()),
  );
  const detail = jobs.find((j) => j.id === selected);
  const labels = {
    submitting: '전송 중',
    queued: '대기 중',
    running: '생성 중',
    complete: '완료',
    error: '오류',
    cancelled: '취소',
  };
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-none flex-col gap-4 px-4 py-5 sm:px-7 lg:px-9">
        <span className="text-xs text-muted">최근 {jobs.length}개 기록</span>
        <label className="relative sm:max-w-96">
          <Search size={17} className="absolute left-3 top-3.5 text-muted" />
          <input
            className="field pl-10"
            aria-label="기록 검색"
            placeholder="프롬프트와 모델로 검색"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
        <div className="flex flex-wrap gap-2">
          {[
            ['all', '전체'],
            ['real', '실제 생성'],
            ['complete', '완료'],
            ['error', '오류'],
          ].map(([v, l]) => (
            <button
              key={v}
              onClick={() => setFilter(v)}
              aria-pressed={filter === v}
              className={`rounded-full px-4 py-2.5 text-xs font-medium ${filter === v ? 'bg-ink text-white' : 'bg-white text-muted hover:bg-stone'}`}
            >
              {l}
            </button>
          ))}
        </div>
      </div>
      <div
        data-ui-audit-scroll-root
        className="min-h-0 flex-1 overflow-y-auto px-4 pb-6 sm:px-7 lg:px-9"
      >
        {shown.length ? (
          <div
            data-ui-audit-card-group
            className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4"
          >
            {shown.map((j) => (
              <article
                key={j.id}
                data-ui-audit-card
                data-ui-audit-card-type="gallery-item"
                className="flex h-full min-w-0 flex-col overflow-hidden rounded-2xl border border-line bg-white"
              >
                <button
                  className="relative block aspect-[3/4] w-full overflow-hidden bg-stone"
                  onClick={() => setSelected(j.id)}
                  aria-label={`${labels[j.status]} 이미지 상세 보기`}
                >
                  {j.status === 'complete' && j.images[0] ? (
                    <img
                      loading="lazy"
                      className="h-full w-full object-cover"
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
                  <div className="min-w-0">
                    <p className="text-xs font-semibold">{labels[j.status]}</p>
                    <p className="mt-1 text-[10px] text-muted">
                      {new Date(j.createdAt).toLocaleDateString('ko-KR')}
                    </p>
                  </div>
                  <IconButton
                    icon={Trash2}
                    danger
                    className="-mr-1"
                    label="기록 삭제"
                    disabled={['submitting', 'running', 'queued'].includes(j.status)}
                    onClick={() => setRemove(j)}
                  />
                </div>
              </article>
            ))}
          </div>
        ) : (
          <Empty
            icon={Images}
            title={jobs.length ? '조건에 맞는 기록을 찾아보세요' : '첫 번째 장면을 만들어 보세요'}
            description={
              jobs.length
                ? '검색어 또는 상태 필터를 바꾸면 다른 기록을 볼 수 있어요'
                : '생성한 이미지와 설정을 이곳에서 다시 만날 수 있어요'
            }
          >
            <Link className="btn-primary" to="/create">
              이미지 만들기
            </Link>
          </Empty>
        )}
      </div>
      <Modal title="생성 기록" open={Boolean(detail)} onClose={() => setSelected(null)}>
        {detail && <Result key={detail.id} job={detail} />}
      </Modal>
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
                setJobs((all) => all.filter((j) => j.id !== remove?.id));
                setRemove(null);
                notify('기기에서 기록을 삭제했어요');
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
    </div>
  );
}
