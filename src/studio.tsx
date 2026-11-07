import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  defaults,
  demoInfo,
  readStored,
  newId,
  randomSeed,
  buildWorkflow,
  validateAgainstServer,
  options,
  isLegacyDefaultPrompt,
  migrateGenerationSettings,
  type Generation,
  type Preset,
  type Job,
  type ObjectInfo,
} from './domain';
import {
  fetchInfo,
  normalizeBase,
  request,
  submit,
  websocketUrl,
  type Queue,
  type HistoryItem,
} from './api';
import {
  catalog,
  selectModel,
  validateSelection,
  families,
  isArtifactProneSampler,
  type FamilyAssignments,
} from './models';

function usePersisted<T>(key: string, initial: T, migrate?: (v: T) => T) {
  const [value, setValue] = useState<T>(() => {
    const raw = readStored(key, initial);
    return migrate ? migrate(raw) : raw;
  });
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, [key, value]);
  return [value, setValue, failed] as const;
}
function useStudioState() {
  const [settings, setSettings, saveError] = usePersisted<Generation>(
    'cm-settings',
    defaults,
    migrateGenerationSettings,
  );
  const [presets, setPresets, presetError] = usePersisted<Preset[]>('cm-presets', []);
  const [familyAssignments, setFamilyAssignments, familySaveError] =
    usePersisted<FamilyAssignments>('cm-asset-families', {});
  const [jobs, setJobs, historyError] = usePersisted<Job[]>('cm-jobs', []);
  const [connection, setConnection] = usePersisted('cm-connection', {
    base: '/comfy',
    preview: true,
  });
  const [info, setInfo] = useState<ObjectInfo | null>(connection.preview ? demoInfo : null);
  const [connectionState, setConnectionState] = useState<
    'preview' | 'connecting' | 'connected' | 'error'
  >(connection.preview ? 'preview' : 'connecting');
  const [connectionError, setConnectionError] = useState('');
  const [notice, setNotice] = useState('');
  const [online, setOnline] = useState(navigator.onLine);
  const [socketState, setSocketState] = useState('폴링 대기');
  const isWsConnectedRef = useRef(false);
  const pendingHistoryRef = useRef(new Set<string>());
  const [busy, setBusy] = useState(false);
  const submitLock = useRef(false);
  const [clientId] = useState(newId);
  const jobRef = useRef(jobs);
  jobRef.current = jobs;
  function notify(message: string) {
    setNotice(message);
  }
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(''), 5000);
    return () => clearTimeout(t);
  }, [notice]);
  useEffect(() => {
    let patched = false;
    let next = settings;
    if (isLegacyDefaultPrompt(next.positive)) {
      next = { ...next, positive: defaults.positive };
      patched = true;
    }
    if (isArtifactProneSampler(next.sampler)) {
      const prof = families.find((f) => f.id === next.architecture);
      next = {
        ...next,
        sampler: 'euler',
        scheduler: 'simple',
        steps: prof?.steps ?? (next.architecture === 'krea2' ? 8 : 24),
      };
      patched = true;
    }
    if (patched) {
      setSettings(next);
    }
  }, []);
  useEffect(() => {
    const on = () => setOnline(navigator.onLine);
    window.addEventListener('online', on);
    window.addEventListener('offline', on);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', on);
    };
  }, []);
  useEffect(() => {
    let active = true;
    if (connection.preview) {
      setInfo(demoInfo);
      setConnectionState('preview');
      return;
    }
    setInfo(null);
    setConnectionState('connecting');
    fetchInfo(connection.base)
      .then((data) => {
        if (!active) return;
        if (!data || !Object.keys(data).length || !Object.values(data).some((n) => n.input))
          throw new Error('ComfyUI 노드 정보를 확인해 주세요');
        setInfo(data);
        setConnectionState('connected');
        setConnectionError('');
      })
      .catch((e) => {
        if (active) {
          setConnectionState('error');
          setConnectionError(e.message);
        }
      });
    return () => {
      active = false;
    };
  }, [connection, online]);
  useEffect(() => {
    if (!info) return;
    setSettings((s) => {
      if (s.workflow) return s;
      const list = catalog(info, familyAssignments);
      const current = list.find(
        (e) =>
          e.name === s.model &&
          e.loader === (s.modelLoader || 'CheckpointLoaderSimple') &&
          e.family === s.architecture,
      );
      const entry = current || list.find((e) => e.family === s.architecture) || list[0];
      if (!entry) return s;
      const aligned = selectModel(s, entry, info, familyAssignments);
      return JSON.stringify(aligned) === JSON.stringify(s) ? s : aligned;
    });
  }, [info, setSettings, familyAssignments, settings.architecture]);
  useEffect(() => {
    // A reload during HTTP submission cannot safely resubmit the same job.
    setJobs((all) =>
      all.map((j) =>
        j.status === 'submitting'
          ? {
              ...j,
              status: 'error',
              error: '전송 중 화면이 다시 열렸습니다. 서버 큐를 확인한 후 다시 생성해 주세요',
            }
          : j,
      ),
    );
  }, [setJobs]);
  function updateJob(id: string, patch: Partial<Job>) {
    setJobs((all) =>
      all.map((j) => {
        if (j.id !== id) return j;
        // A late poll response must not revive a completed or cancelled request.
        if (
          ['complete', 'error', 'cancelled'].includes(j.status) &&
          (!patch.status || ['queued', 'running'].includes(patch.status))
        )
          return j;
        return { ...j, ...patch };
      }),
    );
  }
  useEffect(() => {
    if (connection.preview || !online) return;
    let stopped = false,
      socket: WebSocket,
      timer: ReturnType<typeof setTimeout>,
      attempts = 0;
    async function fetchHistoryOnce(promptId: string, base: string) {
      if (pendingHistoryRef.current.has(promptId)) return;
      pendingHistoryRef.current.add(promptId);
      try {
        const h = await request<Record<string, HistoryItem>>(
          base,
          `/history/${encodeURIComponent(promptId)}`,
        );
        const item = h[promptId];
        if (item) {
          if (item.status?.status_str === 'error') {
            updateJob(promptId, {
              status: 'error',
              error: JSON.stringify(item.status.messages || '서버 생성 오류'),
            });
            return;
          }
          const images = Object.values(item.outputs || {}).flatMap((n) => n.images || []);
          if (item.status?.completed || images.length) {
            updateJob(
              promptId,
              images.length
                ? { status: 'complete', progress: 100, images }
                : {
                    status: 'error',
                    error:
                      '생성은 끝났지만 이미지 출력이 없습니다. SaveImage 출력을 확인해 주세요',
                  },
            );
          }
        }
      } catch {
        /* Poll fallback will retry */
      } finally {
        pendingHistoryRef.current.delete(promptId);
      }
    }
    function open() {
      socket = new WebSocket(websocketUrl(connection.base, clientId));
      socket.onopen = () => {
        attempts = 0;
        isWsConnectedRef.current = true;
        setSocketState('실시간 연결');
      };
      socket.onmessage = (event) => {
        if (typeof event.data !== 'string') return;
        try {
          const { type, data } = JSON.parse(event.data);
          const j = jobRef.current.find(
            (j) => j.id === data.prompt_id && j.base === connection.base && !j.preview,
          );
          if (!j || ['complete', 'error', 'cancelled'].includes(j.status)) return;
          if (type === 'progress')
            updateJob(j.id, {
              status: 'running',
              progress: Math.min(99, Math.round((data.value / Math.max(1, data.max)) * 100)),
            });
          if (type === 'execution_start') updateJob(j.id, { status: 'running' });
          if ((type === 'executing' && data.node === null) || type === 'executed') {
            void fetchHistoryOnce(j.id, j.base);
          }
          if (type === 'execution_error' || type === 'execution_interrupted')
            updateJob(j.id, {
              status: 'error',
              error: String(data.exception_message || '서버에서 생성이 중단되었습니다'),
            });
        } catch {
          /* Binary previews and unrelated events have no state effect. */
        }
      };
      socket.onerror = () => socket.close();
      socket.onclose = () => {
        isWsConnectedRef.current = false;
        setSocketState('폴링으로 확인 중');
        if (!stopped) timer = setTimeout(open, Math.min(10000, 1000 * 2 ** attempts++));
      };
    }
    open();
    return () => {
      stopped = true;
      isWsConnectedRef.current = false;
      clearTimeout(timer);
      socket?.close();
    };
  }, [connection, clientId, online]);
  useEffect(() => {
    let stopped = false,
      polling = false,
      pollTimer: ReturnType<typeof setTimeout>;
    async function poll() {
      if (polling || !navigator.onLine) return;
      polling = true;
      try {
        for (const j of jobRef.current.filter(
          (j) => !j.preview && ['queued', 'running'].includes(j.status),
        )) {
          try {
            const h = await request<Record<string, HistoryItem>>(
              j.base,
              `/history/${encodeURIComponent(j.id)}`,
            );
            if (stopped) return;
            const item = h[j.id];
            if (item) {
              if (item.status?.status_str === 'error') {
                updateJob(j.id, {
                  status: 'error',
                  error: JSON.stringify(item.status.messages || '서버 생성 오류'),
                });
                continue;
              }
              const images = Object.values(item.outputs || {}).flatMap((n) => n.images || []);
              if (item.status?.completed || images.length)
                updateJob(
                  j.id,
                  images.length
                    ? { status: 'complete', progress: 100, images }
                    : {
                        status: 'error',
                        error:
                          '생성은 끝났지만 이미지 출력이 없습니다. SaveImage 출력을 확인해 주세요',
                      },
                );
            } else {
              const q = await request<Queue>(j.base, '/queue');
              if (stopped) return;
              if (q.queue_running.some((row) => row[1] === j.id))
                updateJob(j.id, { status: 'running', error: undefined });
              else if (q.queue_pending.some((row) => row[1] === j.id))
                updateJob(j.id, { status: 'queued', error: undefined });
              else if (Date.now() - j.createdAt > 60000)
                updateJob(j.id, {
                  status: 'error',
                  error:
                    '서버 큐와 기록에서 작업을 찾을 수 없습니다. 서버 상태를 확인하고 다시 생성해 주세요',
                });
            }
          } catch (e) {
            if (!stopped) updateJob(j.id, { error: (e as Error).message });
          }
        }
      } finally {
        polling = false;
      }
    }
    function schedulePoll() {
      if (stopped) return;
      const delay = isWsConnectedRef.current ? 15000 : 2500;
      pollTimer = setTimeout(async () => {
        await poll();
        schedulePoll();
      }, delay);
    }
    void poll().then(() => schedulePoll());
    return () => {
      stopped = true;
      clearTimeout(pollTimer);
    };
  }, []);
  useEffect(() => {
    const timer = setInterval(() => {
      if (!jobRef.current.some((j) => j.preview && ['running', 'queued'].includes(j.status)))
        return;
      setJobs((all) =>
        all.map((j) => {
          if (!j.preview || !['running', 'queued'].includes(j.status)) return j;
          const progress = Math.min(100, Math.round((Date.now() - j.createdAt) / 45));
          return {
            ...j,
            progress,
            status: progress === 100 ? 'complete' : 'running',
            images:
              progress === 100 ? [{ filename: 'sample.svg', subfolder: '', type: 'output' }] : [],
          };
        }),
      );
    }, 300);
    return () => clearInterval(timer);
  }, [setJobs]);
  async function generate(input = settings) {
    if (submitLock.current) return;
    if (jobRef.current.some((j) => ['submitting', 'queued', 'running'].includes(j.status))) {
      notify('현재 생성이 끝난 뒤 다음 장면을 만들어 주세요');
      return;
    }
    submitLock.current = true;
    setBusy(true);
    let tempId = '';
    try {
      if (!online && !connection.preview) throw new Error('네트워크 연결 후 다시 생성해 주세요');
      if (!connection.preview && connectionState !== 'connected')
        throw new Error('연결 설정에서 서버를 확인해 주세요');
      const snapshot = structuredClone(input);
      if (!connection.preview) validateSelection(snapshot, info!, familyAssignments);
      if (snapshot.random && !snapshot.workflow) snapshot.seed = randomSeed();
      const workflow = buildWorkflow(snapshot);
      if (!connection.preview) validateAgainstServer(workflow, info!);
      setSettings(snapshot);
      tempId = newId();
      const job: Job = {
        id: tempId,
        createdAt: Date.now(),
        settings: snapshot,
        base: connection.base,
        preview: connection.preview,
        status: connection.preview ? 'running' : 'submitting',
        progress: 0,
        images: [],
      };
      setJobs((all) => [job, ...all].slice(0, 100));
      if (!connection.preview) {
        const response = await submit(connection.base, workflow, clientId);
        if (!response.prompt_id) throw new Error('서버의 작업 번호를 확인할 수 없습니다');
        updateJob(tempId, { id: response.prompt_id, status: 'queued' });
      }
      notify(connection.preview ? '미리보기 체험을 시작했어요' : '생성 요청을 서버에 보냈어요');
    } catch (e) {
      const message = (e as Error).message;
      if (tempId)
        updateJob(tempId, {
          status: 'error',
          error: message + '\n서버 큐를 확인한 뒤 재시도해 주세요',
        });
      notify(message);
    } finally {
      submitLock.current = false;
      setBusy(false);
    }
  }
  async function cancel(j: Job) {
    if (j.preview) {
      updateJob(j.id, { status: 'cancelled' });
      return;
    }
    try {
      const q = await request<Queue>(j.base, '/queue');
      if (q.queue_running.some((row) => row[1] === j.id)) {
        notify('이미 실행 중인 작업입니다. 다른 사용자 보호를 위해 전역 중단은 사용하지 않아요');
        return;
      }
      if (!q.queue_pending.some((row) => row[1] === j.id)) {
        notify('작업 상태가 변경되었습니다. 잠시 후 기록을 확인해 주세요');
        return;
      }
      await request(j.base, '/queue', { method: 'POST', body: JSON.stringify({ delete: [j.id] }) });
      const after = await request<Queue>(j.base, '/queue');
      if (after.queue_running.some((row) => row[1] === j.id)) {
        notify('취소 직전에 실행이 시작되었습니다');
        return;
      }
      updateJob(j.id, { status: 'cancelled' });
      notify('대기 중인 요청을 취소했어요');
    } catch (e) {
      notify((e as Error).message);
    }
  }
  function connect(base: string) {
    const normalized = normalizeBase(base);
    setConnection({ base: normalized, preview: false });
  }
  const active = jobs.find((j) => ['submitting', 'queued', 'running'].includes(j.status));
  return {
    settings,
    setSettings,
    presets,
    setPresets,
    jobs,
    setJobs,
    connection,
    connectionState,
    connectionError,
    info,
    familyAssignments,
    setFamilyAssignments,
    refreshModels: () => setConnection((c) => ({ ...c })),
    connect,
    preview: () => setConnection({ ...connection, preview: true }),
    notice,
    notify,
    online,
    socketState,
    generate,
    busy,
    active,
    cancel,
    storageError: saveError || presetError || historyError || familySaveError,
  };
}
type Studio = ReturnType<typeof useStudioState>;
const Context = createContext<Studio | null>(null);
export function StudioProvider({ children }: { children: ReactNode }) {
  const state = useStudioState();
  return <Context.Provider value={state}>{children}</Context.Provider>;
}
export function useStudio() {
  return useContext(Context)!;
}
