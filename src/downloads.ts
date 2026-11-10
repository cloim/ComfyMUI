import { useEffect, useRef, useState } from 'react';
import { cancelLoraDownload, downloadCivitaiLora, fetchLoraList } from './lora-manager';
import { fetchModelList } from './model-manager';

// LoRA Manager downloads on the ComfyUI server. The app only starts a download and
// follows it by id, so closing or minimizing the app does not stop the transfer.
export type DownloadKind = 'model' | 'lora';
export type TrackedDownload = {
  id: string;
  kind: DownloadKind;
  base: string;
  name: string;
  versionId: number;
  modelId?: number;
  startedAt: number;
  progress: number;
  bytesPerSecond?: number;
};
export type DownloadPayload = Parameters<typeof downloadCivitaiLora>[1];
export type DownloadOutcome = 'completed' | 'failed' | 'cancelled' | 'unknown';

type ProgressPoll =
  | { state: 'ok'; progress: number; bytes: number; bytesPerSecond?: number }
  | { state: 'missing' }
  | { state: 'error' };

const STORAGE_KEY = 'cm-downloads';
const POLL_MS = 1500;
// Give up following a detached download that shows no change for this long.
const STALL_MS = 5 * 60_000;
// After the transfer reaches 100%, wait this long for the library to list the file.
const INDEX_WAIT_MS = 2 * 60_000;

function loadDownloads(): TrackedDownload[] {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

function saveDownloads(list: TrackedDownload[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  } catch {
    /* Tracking still works for this session */
  }
}

// LoRA Manager answers { success, progress: number, bytes_downloaded, ... }.
export async function pollDownloadProgress(base: string, id: string): Promise<ProgressPoll> {
  try {
    const response = await fetch(`${base}/api/lm/download-progress/${encodeURIComponent(id)}`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(10000),
    });
    if (response.status === 404) return { state: 'missing' };
    if (!response.ok) return { state: 'error' };
    const body = await response.json();
    const source = body && typeof body.progress === 'object' ? body.progress : body;
    return {
      state: 'ok',
      progress: Math.max(0, Math.min(100, Number(source?.progress) || 0)),
      bytes: Number(source?.bytes_downloaded) || 0,
      bytesPerSecond: Number(source?.bytes_per_second) || undefined,
    };
  } catch {
    return { state: 'error' };
  }
}

async function isInLibrary(download: TrackedDownload) {
  try {
    const params = { page: 1, pageSize: 100, sortBy: 'date:desc' as const };
    const result =
      download.kind === 'model'
        ? await fetchModelList(download.base, params)
        : await fetchLoraList(download.base, params);
    return (result.items || []).some((item) => item.civitai?.id === download.versionId);
  } catch {
    return false;
  }
}

export function useDownloadTracker({
  notify,
  onFinished,
}: {
  notify: (message: string) => void;
  onFinished: (download: TrackedDownload, outcome: DownloadOutcome) => void;
}) {
  const [downloads, setDownloads] = useState<TrackedDownload[]>(loadDownloads);
  const listRef = useRef(downloads);
  listRef.current = downloads;
  const callbacks = useRef({ notify, onFinished });
  callbacks.current = { notify, onFinished };
  // Requests still open in this page. Others are followed through progress and the library.
  const inflight = useRef(new Set<string>());
  const finished = useRef(new Set<string>());
  const watch = useRef(
    new Map<string, { progress: number; bytes: number; at: number; doneAt?: number }>(),
  );
  const polling = useRef(false);

  function update(fn: (prev: TrackedDownload[]) => TrackedDownload[]) {
    setDownloads((prev) => {
      const next = fn(prev);
      saveDownloads(next);
      return next;
    });
  }

  function finish(id: string, outcome: DownloadOutcome, message?: string) {
    if (finished.current.has(id)) return;
    const download = listRef.current.find((d) => d.id === id);
    finished.current.add(id);
    inflight.current.delete(id);
    watch.current.delete(id);
    update((prev) => prev.filter((d) => d.id !== id));
    if (!download) return;
    const { notify: say, onFinished: done } = callbacks.current;
    if (outcome === 'completed') say(`${download.name} 다운로드를 완료했어요`);
    else if (outcome === 'cancelled') say(`${download.name} 다운로드를 취소했어요`);
    else if (outcome === 'failed') say(message || `${download.name} 다운로드에 실패했어요`);
    else
      say(
        `${download.name} 다운로드 상태를 확인할 수 없어요\n로컬 스캔으로 라이브러리를 확인해 주세요`,
      );
    done(download, outcome);
  }

  function start(entry: Omit<TrackedDownload, 'progress' | 'startedAt'>, payload: DownloadPayload) {
    const download: TrackedDownload = { ...entry, progress: 0, startedAt: Date.now() };
    finished.current.delete(download.id);
    update((prev) => [...prev.filter((d) => d.id !== download.id), download]);
    inflight.current.add(download.id);
    downloadCivitaiLora(download.base, { ...payload, download_id: download.id })
      .then((result) => {
        const cancelled = Boolean((result as { cancelled?: boolean }).cancelled);
        finish(download.id, cancelled ? 'cancelled' : 'completed');
      })
      .catch((error: Error & { status?: number }) => {
        inflight.current.delete(download.id);
        // A server answer is final. A dropped connection is not: the server keeps going.
        if (error.status && ![502, 503, 504].includes(error.status)) {
          finish(download.id, 'failed', error.message);
        }
      });
  }

  async function cancel(id: string) {
    const download = listRef.current.find((d) => d.id === id);
    if (!download) return;
    try {
      await cancelLoraDownload(download.base, id);
    } catch {
      /* The download may already be gone on the server */
    }
    finish(id, 'cancelled');
  }

  async function poll() {
    if (polling.current || document.visibilityState !== 'visible') return;
    polling.current = true;
    try {
      for (const download of listRef.current) {
        const result = await pollDownloadProgress(download.base, download.id);
        const now = Date.now();
        const seen = watch.current.get(download.id) || { progress: -1, bytes: -1, at: now };
        if (result.state === 'ok') {
          if (result.progress !== seen.progress || result.bytes !== seen.bytes) {
            watch.current.set(download.id, {
              ...seen,
              progress: result.progress,
              bytes: result.bytes,
              at: now,
            });
          }
          update((prev) =>
            prev.map((d) =>
              d.id === download.id
                ? { ...d, progress: result.progress, bytesPerSecond: result.bytesPerSecond }
                : d,
            ),
          );
        }
        if (inflight.current.has(download.id)) continue;

        // Detached: the open request was lost (app minimized, reloaded or offline).
        const done =
          result.state === 'missing' || (result.state === 'ok' && result.progress >= 100);
        if (done) {
          if (await isInLibrary(download)) {
            finish(download.id, 'completed');
            continue;
          }
          const state = watch.current.get(download.id) || { progress: 100, bytes: 0, at: now };
          const doneAt = state.doneAt ?? now;
          watch.current.set(download.id, { ...state, doneAt });
          if (now - doneAt > INDEX_WAIT_MS) finish(download.id, 'unknown');
        } else if (result.state === 'ok') {
          const state = watch.current.get(download.id);
          if (state && now - state.at > STALL_MS) finish(download.id, 'unknown');
        }
      }
    } finally {
      polling.current = false;
    }
  }

  const active = downloads.length > 0;
  useEffect(() => {
    if (!active) return;
    void poll();
    const timer = setInterval(() => void poll(), POLL_MS);
    const onVisible = () => {
      if (document.visibilityState === 'visible') void poll();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [active]);

  return { downloads, startDownload: start, cancelDownload: cancel };
}
