import { useId, useState, type FormEvent } from 'react';
import { useLocation } from 'react-router-dom';
import { Download, Film, RefreshCw } from 'lucide-react';
import { imageUrl } from '../api';
import { SelectControl, Spinner } from '../components/ui';
import type { ImageRef } from '../domain';
import { jobStageLabel } from '../job-recovery';
import { REDGRAFT_NAME, ltxFrameCounts, ltxModels, ltxSizes, type LtxInput } from '../ltx';
import { useStudio } from '../studio';

export default function Video() {
  const location = useLocation();
  const [reference, setReference] = useState(
    location.state as { base: string; image: ImageRef } | null,
  );
  const [file, setFile] = useState<File>();
  const [prompt, setPrompt] = useState('');
  const [size, setSize] = useState<LtxInput['size']>(ltxSizes[0]);
  const [frames, setFrames] = useState<LtxInput['frames']>(ltxFrameCounts[0]);
  const [selectedId, setSelectedId] = useState('');
  const [checking, setChecking] = useState(false);
  const id = useId();
  const {
    busy,
    info,
    jobs,
    connection,
    connectionState,
    refreshModels,
    generateVideo,
    checkSubmission,
    cancel,
  } = useStudio();
  const videoJobs = jobs.filter((job) => job.video);
  const job = videoJobs.find((job) => job.id === selectedId) || videoJobs[0];
  const result = job?.videos?.[0];
  const { models, missing } = ltxModels(info);
  const connected = connectionState === 'connected';
  const wrongServer = Boolean(reference && reference.base !== connection.base && !file);
  const unavailable = !connected || !models || !info?.SaveVideo || wrongServer;

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || unavailable) return;
    const promptField = event.currentTarget.elements.namedItem('prompt') as HTMLTextAreaElement;
    if (!prompt.trim()) {
      promptField.setCustomValidity('장면의 움직임을 설명해 주세요');
      promptField.reportValidity();
      return;
    }
    setSelectedId('');
    await generateVideo({ prompt, size, frames }, file || reference || undefined);
  }

  return (
    <div className="mx-auto grid max-w-[1140px] items-start gap-4 p-4 sm:p-5 lg:grid-cols-2">
      <form method="post" className="panel space-y-4" onSubmit={(event) => void create(event)}>
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h2 className="text-sm font-bold">{REDGRAFT_NAME}</h2>
            <p className="mt-1.5 text-xs leading-relaxed text-muted">
              프롬프트로 영상을 만들어요. 첫 프레임으로 쓸 이미지도 선택할 수 있어요.
            </p>
          </div>
          {connected && (
            <button
              type="button"
              className="btn-secondary shrink-0"
              aria-label="영상 모델 목록 새로고침"
              title="영상 모델 목록 새로고침"
              onClick={refreshModels}
            >
              <RefreshCw size={15} aria-hidden="true" />
            </button>
          )}
        </div>
        {unavailable && (
          <div role="status" className="rounded-lg bg-paper px-3 py-2 text-xs leading-relaxed">
            {!connected ? (
              '설정에서 ComfyUI 서버에 연결해 주세요.'
            ) : missing.length ? (
              <>
                <p>ComfyUI에 필요한 파일을 추가한 뒤 목록을 새로고침해 주세요.</p>
                <ul className="mt-1 list-inside list-disc [overflow-wrap:anywhere]">
                  {missing.map((filename) => (
                    <li key={filename}>{filename}</li>
                  ))}
                </ul>
              </>
            ) : !info?.SaveVideo ? (
              'ComfyUI에서 SaveVideo 노드를 사용할 수 있는 버전으로 업데이트해 주세요.'
            ) : (
              '원본 이미지가 저장된 ComfyUI 서버에 연결하거나 다른 이미지를 선택해 주세요.'
            )}
          </div>
        )}
        <div className="space-y-1.5">
          <label htmlFor={`${id}-prompt`} className="block text-xs font-semibold">
            영상 프롬프트 (필수)
          </label>
          <textarea
            id={`${id}-prompt`}
            name="prompt"
            className="field min-h-28 resize-y"
            placeholder="A paper boat drifts downstream as the camera slowly follows."
            required
            value={prompt}
            onChange={(event) => {
              event.currentTarget.setCustomValidity('');
              setPrompt(event.currentTarget.value);
            }}
          />
        </div>
        <div className="space-y-1.5">
          <label htmlFor={`${id}-image`} className="block text-xs font-semibold">
            첫 프레임 이미지 (선택)
          </label>
          <input
            id={`${id}-image`}
            name="image"
            type="file"
            accept="image/jpeg,image/png,image/webp"
            aria-describedby={`${id}-image-help`}
            className="field w-full text-xs"
            onChange={(event) => {
              setFile(event.target.files?.[0]);
              if (event.target.files?.length) setReference(null);
            }}
          />
          <p id={`${id}-image-help`} className="text-xs text-muted">
            JPG, PNG 또는 WebP, 최대 20MB. 선택한 비율에 맞춰 가운데를 잘라요.
          </p>
          {reference && (
            <div className="flex min-w-0 items-center gap-2 text-xs">
              <span className="min-w-0 flex-1 truncate" title={reference.image.filename}>
                {reference.image.filename}
              </span>
              <button type="button" className="btn-secondary" onClick={() => setReference(null)}>
                이미지 해제
              </button>
            </div>
          )}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <label htmlFor={`${id}-size`} className="block text-xs font-semibold">
              화면 비율
            </label>
            <SelectControl
              id={`${id}-size`}
              name="size"
              value={size.label}
              onChange={(event) =>
                setSize(
                  ltxSizes.find((option) => option.label === event.target.value) || ltxSizes[0],
                )
              }
            >
              {ltxSizes.map((option) => (
                <option key={option.label} value={option.label}>
                  {option.label} {option.width}×{option.height}
                </option>
              ))}
            </SelectControl>
          </div>
          <div className="space-y-1.5">
            <label htmlFor={`${id}-duration`} className="block text-xs font-semibold">
              영상 길이
            </label>
            <SelectControl
              id={`${id}-duration`}
              name="duration"
              value={frames}
              onChange={(event) =>
                setFrames(
                  ltxFrameCounts.find((count) => count === Number(event.target.value)) || 49,
                )
              }
            >
              {ltxFrameCounts.map((count, index) => (
                <option key={count} value={count}>
                  약 {index + 2}초
                </option>
              ))}
            </SelectControl>
          </div>
        </div>
        <button type="submit" className="btn-primary" disabled={busy || unavailable}>
          {busy ? <Spinner /> : <Film size={15} aria-hidden="true" />}
          영상 생성
        </button>
      </form>
      <section className="panel min-w-0 space-y-3" aria-labelledby={`${id}-results`}>
        <h2 id={`${id}-results`} className="text-sm font-bold">
          생성 결과
        </h2>
        {!job ? (
          <p className="text-xs text-muted">영상 생성이 끝나면 여기서 재생하고 저장할 수 있어요.</p>
        ) : (
          <>
            {videoJobs.length > 1 && (
              <SelectControl
                aria-label="최근 생성 영상"
                value={job.id}
                onChange={(event) => setSelectedId(event.target.value)}
              >
                {videoJobs.map((item) => (
                  <option key={item.id} value={item.id}>
                    {new Date(item.createdAt).toLocaleString('ko-KR')} |{' '}
                    {item.settings.positive.slice(0, 60)}
                  </option>
                ))}
              </SelectControl>
            )}
            <div role="status" className="text-xs font-semibold">
              {jobStageLabel(job)}
              {job.status === 'running' && ` ${job.progress}%`}
            </div>
            {job.status === 'running' && (
              <progress
                aria-label="영상 생성 진행률"
                value={job.progress}
                max={100}
                className="block h-2 w-full accent-olive"
              />
            )}
            {job.error && (
              <p className="whitespace-pre-wrap break-words text-xs text-red-700" role="alert">
                {job.error}
              </p>
            )}
            {job.status === 'queued' && (
              <button type="button" className="btn-secondary" onClick={() => void cancel(job)}>
                대기 취소
              </button>
            )}
            {job.submissionUncertain && (
              <button
                type="button"
                className="btn-secondary"
                disabled={checking}
                onClick={async () => {
                  setChecking(true);
                  try {
                    await checkSubmission(job);
                  } catch {
                    // The studio shows the connection error.
                  } finally {
                    setChecking(false);
                  }
                }}
              >
                서버 작업 확인
              </button>
            )}
            {result && (
              <>
                <video
                  key={job.id}
                  aria-label="생성한 영상"
                  src={imageUrl(job.base, result)}
                  width={job.settings.width}
                  height={job.settings.height}
                  controls
                  playsInline
                  preload="metadata"
                  className="max-h-[480px] w-full rounded-lg bg-black object-contain"
                />
                <a
                  className="btn-secondary"
                  href={imageUrl(job.base, result)}
                  download={result.filename}
                  target="_blank"
                  rel="noreferrer"
                >
                  <Download size={15} aria-hidden="true" />
                  MP4 저장
                </a>
              </>
            )}
          </>
        )}
      </section>
    </div>
  );
}
