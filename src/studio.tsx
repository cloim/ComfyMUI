import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  defaults,
  DEFAULT_PROMPTS,
  DEFAULT_PROMPT_ASSEMBLE,
  demoInfo,
  readStored,
  newId,
  randomSeed,
  buildWorkflow,
  validateAgainstServer,
  options,
  isLegacyDefaultPrompt,
  migrateGenerationSettings,
  baseSettings,
  upscaleSettings,
  type DefaultPrompts,
  type PromptAssembleElement,
  type Generation,
  type Preset,
  type Job,
  type QueueItem,
  reorderQueue,
  trimJobsPreservingFavorites,
  type ObjectInfo,
} from './domain';
import {
  fetchInfo,
  normalizeBase,
  request,
  submit,
  websocketUrl,
  imageUrl,
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
import { parseBinaryPreview } from './preview';
import { useDownloadTracker } from './downloads';
import { deleteOutputFiles, outputKey } from './outputs';
import {
  fetchGallery,
  galleryJob,
  galleryKey,
  GALLERY_BASE,
  isGalleryJob,
  type GalleryIndex,
} from './gallery';
import {
  idbGet,
  idbSet,
  migrateLocalStorageToIDB,
  fetchServerState,
  flushServerWrites,
  queueServerWrite,
  unsentKeys,
} from './storage';

// Shared keys are stored in the app server's database and mirrored in localStorage.
type SharedHandler = {
  applyServer: (value: unknown) => void;
  localValue: () => { value: unknown; changed: boolean };
};
const sharedRegistry = new Map<string, SharedHandler>();

function usePersisted<T>(
  key: string,
  initial: T,
  options?: {
    migrate?: (v: T) => T;
    // Large device-only data (history, queue) also goes to IndexedDB.
    useIDB?: boolean;
    // Shared across devices through the server database.
    shared?: boolean;
  },
) {
  const initialRef = useRef(initial);
  const [value, setRawValue] = useState<T>(() => {
    const raw = readStored(key, initial);
    const migrated = options?.migrate ? options.migrate(raw) : raw;
    try {
      if (localStorage.getItem(key) === null) {
        localStorage.setItem(key, JSON.stringify(migrated));
      }
    } catch {
      /* ignore */
    }
    return migrated;
  });
  const [failed, setFailed] = useState(false);

  const store = (next: T) => {
    try {
      localStorage.setItem(key, JSON.stringify(next));
      setFailed(false);
    } catch {
      setFailed(true);
    }
    if (options?.useIDB) {
      void idbSet(key, next).catch(() => setFailed(true));
    }
  };

  // Saves on this device only; used for automatic corrections that every device repeats.
  const setSilentValue = (updater: T | ((prev: T) => T)) => {
    setRawValue((prev) => {
      const next = typeof updater === 'function' ? (updater as (p: T) => T)(prev) : updater;
      if (JSON.stringify(next) === JSON.stringify(prev)) return prev;
      store(next);
      return next;
    });
  };

  const setValue = (updater: T | ((prev: T) => T)) => {
    setRawValue((prev) => {
      const next = typeof updater === 'function' ? (updater as (p: T) => T)(prev) : updater;
      store(next);
      if (options?.shared) queueServerWrite(key, next);
      return next;
    });
  };

  useEffect(() => {
    if (!options?.shared) return;
    sharedRegistry.set(key, {
      applyServer: (raw: unknown) => {
        const next = options?.migrate ? options.migrate(raw as T) : (raw as T);
        setRawValue((prev) => (JSON.stringify(prev) === JSON.stringify(next) ? prev : next));
        try {
          localStorage.setItem(key, JSON.stringify(next));
        } catch {
          /* ignore */
        }
      },
      localValue: () => {
        let raw: string | null = null;
        try {
          raw = localStorage.getItem(key);
        } catch {
          /* ignore */
        }
        return {
          value: readStored(key, initialRef.current),
          changed: raw !== null && raw !== JSON.stringify(initialRef.current),
        };
      },
    });
    return () => {
      sharedRegistry.delete(key);
    };
  }, [key, options?.shared]);

  // IndexedDB holds the full copy when localStorage runs out of room.
  useEffect(() => {
    if (!options?.useIDB) return;
    void migrateLocalStorageToIDB().then(async () => {
      try {
        const stored = await idbGet<T>(key);
        if (stored === undefined) return;
        const next = options?.migrate ? options.migrate(stored) : stored;
        setRawValue((prev) => (JSON.stringify(prev) === JSON.stringify(next) ? prev : next));
      } catch {
        /* ignore initial idb read error */
      }
    });
  }, [key]);

  return [value, setValue, failed, setSilentValue] as const;
}

function useStudioState() {
  const [defaultPrompts, setDefaultPrompts, defaultPromptError] = usePersisted<DefaultPrompts>(
    'cm-default-prompts',
    DEFAULT_PROMPTS,
    { shared: true },
  );
  const [promptAssemble, setPromptAssemble, assembleError] = usePersisted<PromptAssembleElement[]>(
    'cm-prompt-assemble',
    DEFAULT_PROMPT_ASSEMBLE,
    { shared: true },
  );
  const [selectedAssembleId, setSelectedAssembleId] = usePersisted<string>(
    'cm-prompt-assemble-selected',
    DEFAULT_PROMPT_ASSEMBLE[0]?.id || '',
    { shared: true },
  );
  const [modelOrder, setModelOrder, modelOrderError] = usePersisted<string[]>(
    'cm-model-order',
    [],
    { shared: true },
  );
  const [settings, setSettings, saveError, setSilentSettings] = usePersisted<Generation>(
    'cm-settings',
    {
      ...defaults,
      positive: defaultPrompts.positive,
      negative: defaultPrompts.negative,
    },
    { migrate: migrateGenerationSettings, shared: true },
  );
  const [presets, setPresets, presetError] = usePersisted<Preset[]>('cm-presets', [], {
    shared: true,
  });
  const [familyAssignments, setFamilyAssignments, familySaveError] =
    usePersisted<FamilyAssignments>('cm-asset-families', {}, { shared: true });
  // Which CivitAI example became each model's card preview, keyed by hash or path.
  // LoRA Manager keeps only the file, so this record is synced across devices.
  const [exampleDefaults, setExampleDefaults] = usePersisted<Record<string, string>>(
    'cm-example-defaults',
    {},
    { shared: true },
  );
  const [jobs, setJobs, historyError, setSilentJobs] = usePersisted<Job[]>('cm-jobs', [], {
    useIDB: true,
  });
  const [clientQueue, setClientQueue, queueError] = usePersisted<QueueItem[]>(
    'cm-client-queue',
    [],
    { useIDB: true },
  );
  const [connection, setConnection] = usePersisted(
    'cm-connection',
    {
      base: '/comfy',
      preview: true,
    },
    { shared: true },
  );
  const [remoteHydrated, setRemoteHydrated] = useState(false);
  // The ComfyUI output folder is the history. null means it is not available
  // (preview mode or a direct ComfyUI address) and local records are shown instead.
  const [gallery, setGallery] = useState<GalleryIndex | null>(null);
  // Bumped when a model or LoRA download lands so library screens reload.
  const [libraryRevision, setLibraryRevision] = useState(0);
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
  const [livePreviewUrl, setLivePreviewUrl] = useState('');
  const activePreviewBlobRef = useRef<string | null>(null);
  const [notificationsEnabled, setNotificationsEnabled] = useState<boolean>(() => {
    try {
      return localStorage.getItem('cm-notifications') === 'true';
    } catch {
      return false;
    }
  });
  const wakeLockRef = useRef<WakeLockSentinel | null>(null);
  const unreadBadgesRef = useRef<number>(0);
  const previousRunningJobsRef = useRef<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const submitLock = useRef(false);
  const [clientId] = useState(newId);
  const jobRef = useRef(jobs);
  jobRef.current = jobs;
  const queueRef = useRef(clientQueue);
  queueRef.current = clientQueue;
  function notify(message: string) {
    setNotice(message);
  }
  // The server database is the source of truth. On load and whenever the app comes back
  // into view, its values replace the local copy, except keys this device has not sent yet.
  useEffect(() => {
    let active = true;
    async function pull() {
      const server = await fetchServerState();
      if (!active) return;
      if (server) {
        const unsent = unsentKeys();
        for (const [key, handler] of sharedRegistry.entries()) {
          if (!unsent.has(key) && key in server) {
            handler.applyServer(server[key]);
            continue;
          }
          const local = handler.localValue();
          if (unsent.has(key) || local.changed) queueServerWrite(key, local.value);
        }
        void flushServerWrites();
      }
      setRemoteHydrated(true);
    }
    void pull();
    const onVisibility = () => {
      if (document.visibilityState === 'visible') void pull();
      else void flushServerWrites(true);
    };
    const onFocus = () => void pull();
    const onPageHide = () => void flushServerWrites(true);
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('focus', onFocus);
    window.addEventListener('online', onFocus);
    window.addEventListener('pagehide', onPageHide);
    return () => {
      active = false;
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('online', onFocus);
      window.removeEventListener('pagehide', onPageHide);
    };
  }, []);
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
      setSilentSettings(next);
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
    setInfo((prev) => (prev === demoInfo ? null : prev));
    const cacheKey = 'cm-info-cache:' + connection.base;
    let hasStale = false;
    void idbGet<ObjectInfo>(cacheKey).then((cached) => {
      if (!active) return;
      if (cached && Object.keys(cached).length && Object.values(cached).some((n) => n.input)) {
        hasStale = true;
        setInfo(cached);
      }
    });
    setConnectionState('connecting');
    fetchInfo(connection.base)
      .then((data) => {
        if (!active) return;
        if (!data || !Object.keys(data).length || !Object.values(data).some((n) => n.input))
          throw new Error('ComfyUI 노드 정보를 확인해 주세요');
        setInfo((prev) => {
          if (prev && JSON.stringify(prev) === JSON.stringify(data)) return prev;
          return data;
        });
        setConnectionState('connected');
        setConnectionError('');
        void idbSet(cacheKey, data);
      })
      .catch((e) => {
        if (active) {
          setConnectionState('error');
          setConnectionError(e.message);
          if (!hasStale) setInfo(null);
        }
      });
    return () => {
      active = false;
    };
  }, [connection, online]);
  useEffect(() => {
    if (!info || !remoteHydrated) return;
    if (!connection.preview && info === demoInfo) return;
    setSilentSettings((s) => {
      if (s.workflow) return s;
      const list = catalog(info, familyAssignments, modelOrder);
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
  }, [
    info,
    connection.preview,
    familyAssignments,
    modelOrder,
    settings.architecture,
    remoteHydrated,
  ]);
  useEffect(() => {
    // A reload during HTTP submission cannot safely resubmit the same job.
    setSilentJobs((all) =>
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
  }, []);
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
        const now = Date.now();
        const nextStartedAt =
          patch.status === 'running' && !j.startedAt ? now : (patch.startedAt ?? j.startedAt);
        const nextCompletedAt =
          patch.status === 'complete' && !j.completedAt
            ? now
            : (patch.completedAt ?? j.completedAt);
        return {
          ...j,
          ...patch,
          startedAt: nextStartedAt,
          completedAt: nextCompletedAt,
        };
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
          const finishedAt = Date.now();
          const images = Object.values(item.outputs || {})
            .flatMap((n) => n.images || [])
            .map((image) => ({ ...image, v: finishedAt }));
          if (item.status?.completed || images.length) {
            updateJob(
              promptId,
              images.length
                ? { status: 'complete', progress: 100, images }
                : {
                    status: 'error',
                    error: '생성은 끝났지만 이미지 출력이 없습니다. SaveImage 출력을 확인해 주세요',
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
      socket.binaryType = 'arraybuffer';
      socket.onopen = () => {
        attempts = 0;
        isWsConnectedRef.current = true;
        setSocketState('실시간 연결');
      };
      socket.onmessage = (event) => {
        if (event.data instanceof ArrayBuffer) {
          try {
            const parsed = parseBinaryPreview(event.data);
            if (parsed) {
              const runningJob = jobRef.current.find((j) => !j.preview && j.status === 'running');
              if (runningJob) {
                const url = URL.createObjectURL(parsed.blob);
                if (activePreviewBlobRef.current) URL.revokeObjectURL(activePreviewBlobRef.current);
                activePreviewBlobRef.current = url;
                setLivePreviewUrl(url);
                updateJob(runningJob.id, { livePreview: url });
              }
            }
          } catch {
            /* Binary decode error ignored */
          }
          return;
        }
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
          /* Unrelated events have no state effect. */
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
              const finishedAt = Date.now();
              const images = Object.values(item.outputs || {})
                .flatMap((n) => n.images || [])
                .map((image) => ({ ...image, v: finishedAt }));
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
          const isDone = progress === 100;
          return {
            ...j,
            progress,
            status: isDone ? 'complete' : 'running',
            startedAt: j.startedAt || j.createdAt,
            completedAt: isDone ? j.completedAt || Date.now() : undefined,
            images: isDone ? [{ filename: 'sample.svg', subfolder: '', type: 'output' }] : [],
          };
        }),
      );
    }, 300);
    return () => clearInterval(timer);
  }, [setJobs]);
  async function executeJob(input: Generation) {
    if (submitLock.current) return;
    submitLock.current = true;
    setBusy(true);
    let tempId = '';
    try {
      if (!online && !connection.preview) throw new Error('네트워크 연결 후 다시 생성해 주세요');
      if (!connection.preview && connectionState !== 'connected')
        throw new Error('연결 설정에서 서버를 확인해 주세요');
      const snapshot = structuredClone(input);
      // A plain upscale only reads the image, so the original model may be gone.
      const usesModel = !snapshot.upscale || snapshot.upscale.refine > 0;
      if (!connection.preview && usesModel) validateSelection(snapshot, info!, familyAssignments);
      if (snapshot.random && !snapshot.workflow) snapshot.seed = randomSeed();
      const workflow = buildWorkflow(snapshot);
      if (!connection.preview) validateAgainstServer(workflow, info!);
      // An upscale is a one-off job and leaves the create form as it is.
      if (!snapshot.upscale) setSettings(snapshot);
      tempId = newId();
      const job: Job = {
        id: tempId,
        createdAt: Date.now(),
        settings: snapshot,
        base: connection.base,
        preview: connection.preview,
        status: connection.preview ? 'running' : 'submitting',
        startedAt: connection.preview ? Date.now() : undefined,
        progress: 0,
        images: [],
      };
      setJobs((all) => trimJobsPreservingFavorites([job, ...all], 500));
      if (!connection.preview) {
        const response = await submit(connection.base, workflow, clientId, {
          comfymui: { ...snapshot, workflow: null },
        });
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

  async function generate(input = settings) {
    const hasActive = jobRef.current.some((j) =>
      ['submitting', 'queued', 'running'].includes(j.status),
    );
    if (hasActive || submitLock.current) {
      const snapshot = structuredClone(input);
      if (snapshot.random && !snapshot.workflow) snapshot.seed = randomSeed();
      const item: QueueItem = {
        id: newId(),
        createdAt: Date.now(),
        settings: snapshot,
      };
      setClientQueue((q) => [...q, item]);
      notify('기기 내 대기열에 추가했어요');
      return;
    }
    await executeJob(input);
  }

  // Auto-process client queue when no active job is running
  useEffect(() => {
    const hasActive = jobs.some((j) => ['submitting', 'queued', 'running'].includes(j.status));
    if (hasActive || submitLock.current || clientQueue.length === 0) return;
    if (!online && !connection.preview) return;
    if (!connection.preview && connectionState !== 'connected') return;

    const nextItem = clientQueue[0];
    setClientQueue((q) => q.slice(1));
    void executeJob(nextItem.settings);
  }, [jobs, clientQueue, online, connection.preview, connectionState]);

  function removeFromQueue(id: string) {
    setClientQueue((q) => q.filter((item) => item.id !== id));
    notify('대기열 항목을 삭제했어요');
  }

  function moveQueueItem(fromIndex: number, toIndex: number) {
    setClientQueue((q) => reorderQueue(q, fromIndex, toIndex));
  }

  function clearQueue() {
    setClientQueue([]);
    notify('대기열을 모두 비웠어요');
  }

  function enqueueBatch(count: number, base = settings) {
    const validCount = Math.min(20, Math.max(1, Math.round(count)));
    const items: QueueItem[] = [];
    for (let i = 0; i < validCount; i++) {
      const snap = structuredClone(base);
      if (snap.random && !snap.workflow) snap.seed = randomSeed();
      else if (!snap.workflow && i > 0) snap.seed = randomSeed();
      items.push({ id: newId(), createdAt: Date.now() + i, settings: snap });
    }
    const hasActive = jobRef.current.some((j) =>
      ['submitting', 'queued', 'running'].includes(j.status),
    );
    if (!hasActive && items.length > 0) {
      const [first, ...rest] = items;
      setClientQueue((q) => [...q, ...rest]);
      void executeJob(first.settings);
    } else {
      setClientQueue((q) => [...q, ...items]);
    }
    notify(`Seed를 변경하여 ${validCount}회 연속 생성을 등록했어요`);
  }

  function pinSeed(seed: number) {
    setSettings((s) => ({ ...s, seed, random: false }));
    notify(`Seed ${seed}번으로 고정했어요`);
  }

  function generateVariation(baseJob: Job) {
    const next = baseSettings(structuredClone(baseJob.settings));
    next.seed = randomSeed();
    next.random = true;
    void generate(next);
  }

  function generateUpscale(baseJob: Job, model: string, scale: number, refine: number) {
    const source = baseJob.images[0];
    if (!source) return;
    const next = upscaleSettings(structuredClone(baseJob.settings), source, model, scale, refine);
    void generate(next);
    notify(`${next.width} × ${next.height}로 업스케일을 등록했어요`);
  }

  async function shareImage(job: Job) {
    if (!job.images[0]) return;
    const url = job.preview ? '/sample.svg' : imageUrl(job.base, job.images[0]);
    try {
      const res = await fetch(url);
      const blob = await res.blob();
      const filename = job.images[0].filename || 'image.png';
      const file = new File([blob], filename, { type: blob.type || 'image/png' });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({
          files: [file],
          title: 'ComfyMUI 생성 이미지',
          text: job.settings.positive,
        });
        return;
      }
    } catch (e: any) {
      if (e.name === 'AbortError') return;
    }
    const a = document.createElement('a');
    a.href = url;
    a.download = job.images[0].filename || 'image.png';
    a.target = '_blank';
    a.click();
  }

  function toggleFavorite(id: string) {
    setJobs((all) =>
      all.map((j) => {
        if (j.id !== id) return j;
        const nextFav = !j.favorite;
        notify(nextFav ? '즐겨찾기에 등록했어요' : '즐겨찾기에서 해제했어요');
        return { ...j, favorite: nextFav };
      }),
    );
  }

  const { downloads, startDownload, cancelDownload } = useDownloadTracker({
    notify,
    onFinished: (_download, outcome) => {
      if (outcome === 'completed' || outcome === 'unknown') {
        setConnection((c) => ({ ...c }));
        setLibraryRevision((n) => n + 1);
      }
    },
  });

  async function refreshGallery() {
    if (connection.preview) {
      setGallery(null);
      return;
    }
    const next = await fetchGallery();
    if (next) setGallery(next.available ? next : null);
  }

  // Gallery items are files: deleting one deletes the file. Local records (preview mode,
  // direct connections, failed jobs) are only removed from this device.
  async function deleteJobs(ids: string[]): Promise<boolean> {
    if (ids.length === 0) return true;
    const fileIds = new Set(ids.filter((id) => id.startsWith('file:')));
    const localIds = new Set(ids.filter((id) => !id.startsWith('file:')));
    let failed = 0;
    let deletedFiles = 0;
    if (fileIds.size > 0) {
      const files = (gallery?.files || []).filter((f) => fileIds.has(galleryJob(f, '').id));
      try {
        const result = await deleteOutputFiles(
          files.map((f) => ({ filename: f.filename, subfolder: f.subfolder, type: 'output' })),
        );
        failed = result.failed.length;
        const removed = new Set([...result.deleted, ...result.missing]);
        deletedFiles = result.deleted.length;
        setGallery((prev) =>
          prev ? { ...prev, files: prev.files.filter((f) => !removed.has(galleryKey(f))) } : prev,
        );
        // Forget local records of those files so the create screen stops showing them.
        setJobs((all) =>
          all.filter(
            (j) =>
              j.preview ||
              j.base !== GALLERY_BASE ||
              !j.images.some((image) => removed.has(outputKey(image))),
          ),
        );
      } catch (e) {
        notify((e as Error).message);
        return false;
      }
    }
    if (localIds.size > 0) setJobs((all) => all.filter((j) => !localIds.has(j.id)));
    const done = ids.length - failed;
    notify(
      failed > 0
        ? `${done}개를 삭제했어요\n${failed}개 파일은 지우지 못했어요`
        : deletedFiles > 0
          ? `이미지 ${done}개를 삭제했어요`
          : `${done}개 기록을 삭제했어요`,
    );
    return failed === 0;
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
  // Wake Lock, live preview cleanup, background notification and badging
  useEffect(() => {
    const hasActiveJob = jobs.some((j) => ['submitting', 'running'].includes(j.status));
    if (hasActiveJob) {
      if ('wakeLock' in navigator && !wakeLockRef.current) {
        navigator.wakeLock
          .request('screen')
          .then((wl) => {
            wakeLockRef.current = wl;
            wl.addEventListener('release', () => {
              wakeLockRef.current = null;
            });
          })
          .catch(() => {});
      }
    } else {
      if (wakeLockRef.current) {
        wakeLockRef.current.release().catch(() => {});
        wakeLockRef.current = null;
      }
      if (activePreviewBlobRef.current) {
        URL.revokeObjectURL(activePreviewBlobRef.current);
        activePreviewBlobRef.current = null;
        setLivePreviewUrl('');
      }
    }

    for (const j of jobs) {
      if (previousRunningJobsRef.current.has(j.id) && j.status === 'complete') {
        if (document.visibilityState === 'hidden') {
          if (
            notificationsEnabled &&
            'Notification' in window &&
            Notification.permission === 'granted'
          ) {
            try {
              new Notification('ComfyMUI 생성 완료', {
                body: `${j.settings.positive.slice(0, 50) || '새 이미지'} 생성이 끝났습니다`,
                icon: '/icon-192.png',
              });
            } catch {}
          }
          if ('vibrate' in navigator) {
            try {
              navigator.vibrate([200, 100, 200]);
            } catch {}
          }
          unreadBadgesRef.current++;
          if ('setAppBadge' in navigator) {
            navigator.setAppBadge(unreadBadgesRef.current).catch(() => {});
          }
        }
      }
    }

    previousRunningJobsRef.current = new Set(
      jobs.filter((j) => ['submitting', 'queued', 'running'].includes(j.status)).map((j) => j.id),
    );
  }, [jobs, notificationsEnabled]);

  useEffect(() => {
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        const running = jobRef.current.some((j) => ['submitting', 'running'].includes(j.status));
        if (running && 'wakeLock' in navigator && !wakeLockRef.current) {
          navigator.wakeLock
            .request('screen')
            .then((wl) => {
              wakeLockRef.current = wl;
            })
            .catch(() => {});
        }
      }
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => document.removeEventListener('visibilitychange', onVisibilityChange);
  }, []);

  const completedJobCount = jobs.filter((j) => j.status === 'complete').length;
  useEffect(() => {
    void refreshGallery();
  }, [connection.preview, connection.base, completedJobCount]);
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') void refreshGallery();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [connection.preview]);

  async function toggleNotifications(enable?: boolean) {
    const next = enable !== undefined ? enable : !notificationsEnabled;
    if (next) {
      if (!('Notification' in window)) {
        notify('이 브라우저는 알림을 지원하지 않아요');
        return;
      }
      try {
        const perm = await Notification.requestPermission();
        if (perm === 'granted') {
          setNotificationsEnabled(true);
          try {
            localStorage.setItem('cm-notifications', 'true');
          } catch {}
          notify('생성 완료 알림을 켰어요');
        } else {
          setNotificationsEnabled(false);
          try {
            localStorage.setItem('cm-notifications', 'false');
          } catch {}
          notify('브라우저 알림 권한이 허용되지 않았어요');
        }
      } catch {
        setNotificationsEnabled(false);
      }
    } else {
      setNotificationsEnabled(false);
      try {
        localStorage.setItem('cm-notifications', 'false');
      } catch {}
      notify('완료 알림을 껐어요');
    }
  }

  function clearBadge() {
    unreadBadgesRef.current = 0;
    if ('clearAppBadge' in navigator) {
      navigator.clearAppBadge().catch(() => {});
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
    defaultPrompts,
    setDefaultPrompts,
    promptAssemble,
    setPromptAssemble,
    selectedAssembleId,
    setSelectedAssembleId,
    modelOrder,
    setModelOrder,
    exampleDefaults,
    setExampleDefaults,
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
    clientQueue,
    removeFromQueue,
    moveQueueItem,
    clearQueue,
    enqueueBatch,
    pinSeed,
    generateVariation,
    generateUpscale,
    shareImage,
    toggleFavorite,
    deleteJobs,
    gallery,
    refreshGallery,
    galleryJob,
    isGalleryJob,
    downloads,
    startDownload,
    cancelDownload,
    libraryRevision,
    livePreviewUrl,
    notificationsEnabled,
    toggleNotifications,
    clearBadge,
    storageError:
      saveError ||
      presetError ||
      historyError ||
      familySaveError ||
      queueError ||
      defaultPromptError ||
      assembleError ||
      modelOrderError,
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
