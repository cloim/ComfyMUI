import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
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
  normalizeBase,
  request,
  submit,
  websocketUrl,
  imageUrl,
  ApiError,
  type Queue,
  type HistoryItem,
} from './api';
import { startConnection } from './connection';
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
import { backgroundKeepAlive } from './keep-alive';
import { reusableSettings } from './creation-tools';
import {
  deferredWriter,
  defaultPower,
  previewInterval,
  type PowerPreferences,
} from './performance';
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
    debounceMs?: number;
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
  const edited = useRef(false);
  const writer = useRef<ReturnType<typeof deferredWriter<T>> | null>(null);
  if (!writer.current)
    writer.current = deferredWriter((next: T) => {
      // Blob URLs belong to this page and must never be restored after a reload.
      const saved =
        key === 'cm-jobs' && Array.isArray(next)
          ? next.map(({ livePreview: _preview, ...job }) => job)
          : next;
      try {
        localStorage.setItem(key, JSON.stringify(saved));
        setFailed(false);
      } catch {
        setFailed(true);
      }
      if (options?.useIDB) {
        void idbSet(key, saved).catch(() => setFailed(true));
      }
    }, options?.debounceMs || 0);
  const store = (next: T, prev?: T) => {
    edited.current = true;
    const statusChanged =
      key === 'cm-jobs' &&
      Array.isArray(next) &&
      Array.isArray(prev) &&
      (next.length !== prev.length ||
        next.some((job, i) => job.id !== prev[i]?.id || job.status !== prev[i]?.status));
    writer.current!.schedule(next, !options?.debounceMs || statusChanged);
  };
  useEffect(() => {
    const flush = () => writer.current?.flush();
    const onHidden = () => {
      if (document.visibilityState === 'hidden') flush();
    };
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', onHidden);
    return () => {
      flush();
      window.removeEventListener('pagehide', flush);
      document.removeEventListener('visibilitychange', onHidden);
    };
  }, []);

  // Saves on this device only; used for automatic corrections that every device repeats.
  const setSilentValue = (updater: T | ((prev: T) => T)) => {
    setRawValue((prev) => {
      const next = typeof updater === 'function' ? (updater as (p: T) => T)(prev) : updater;
      if (JSON.stringify(next) === JSON.stringify(prev)) return prev;
      store(next, prev);
      return next;
    });
  };

  const setValue = (updater: T | ((prev: T) => T)) => {
    setRawValue((prev) => {
      const next = typeof updater === 'function' ? (updater as (p: T) => T)(prev) : updater;
      if (Object.is(next, prev)) return prev;
      store(next, prev);
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
        if (stored === undefined || edited.current) return;
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
    debounceMs: 1000,
    migrate: (list) =>
      list.map((job) =>
        job.status === 'submitting'
          ? {
              ...job,
              status: 'error',
              submissionUncertain: true,
              error: '전송 중 화면이 다시 열렸습니다. 서버 큐를 확인한 후 다시 생성해 주세요',
            }
          : job,
      ),
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
  const connectionRef = useRef(connection);
  connectionRef.current = connection;
  const [reconnectSeq, setReconnectSeq] = useState(0);
  const forceInfoRefresh = useRef(false);
  const reconnect = useCallback(() => {
    setReconnectSeq((s) => s + 1);
  }, []);
  const refreshModels = useCallback(() => {
    forceInfoRefresh.current = true;
    reconnect();
  }, [reconnect]);
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
  const [power, setPower] = usePersisted<PowerPreferences>('cm-power', defaultPower);
  const powerRef = useRef(power);
  powerRef.current = power;
  const lastPreviewAt = useRef(0);
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
    const onResume = () => {
      void pull();
      if (!connectionRef.current.preview) {
        reconnect();
      }
    };
    const onVisibility = () => {
      if (document.visibilityState === 'visible') onResume();
      else void flushServerWrites(true);
    };
    const onPageHide = () => void flushServerWrites(true);
    const onState = (event: Event) => {
      const { key, value } = (event as CustomEvent<{ key: string; value: unknown }>).detail;
      sharedRegistry.get(key)?.applyServer(value);
    };
    window.addEventListener('comfymui:state', onState);
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('focus', onResume);
    window.addEventListener('online', onResume);
    window.addEventListener('pagehide', onPageHide);
    return () => {
      active = false;
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('focus', onResume);
      window.removeEventListener('online', onResume);
      window.removeEventListener('pagehide', onPageHide);
      window.removeEventListener('comfymui:state', onState);
      backgroundKeepAlive.stop();
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
    if (connection.preview) {
      setInfo(demoInfo);
      setConnectionState('preview');
      return;
    }
    setInfo(null);
    setConnectionState('connecting');
    setConnectionError('');
    const refresh = forceInfoRefresh.current;
    forceInfoRefresh.current = false;
    return startConnection(
      connection.base,
      {
        ready: (data) => {
          setInfo(data);
          setConnectionState('connected');
          setConnectionError('');
        },
        error: (error) => {
          setConnectionState('error');
          setConnectionError(error.message);
        },
      },
      refresh,
    );
  }, [connection.base, connection.preview, online, reconnectSeq]);
  useEffect(() => {
    if (connection.preview || !online || connectionState !== 'error') return;
    const timer = setInterval(() => {
      if (document.visibilityState !== 'hidden') {
        reconnect();
      }
    }, 5000);
    return () => clearInterval(timer);
  }, [connection.preview, online, connectionState, reconnect]);
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
              submissionUncertain: true,
              error: '전송 중 화면이 다시 열렸습니다. 서버 큐를 확인한 후 다시 생성해 주세요',
            }
          : j,
      ),
    );
  }, []);
  function updateJob(id: string, patch: Partial<Job>) {
    setJobs((all) => {
      const next = all.map((j) => {
        if (j.id !== id) return j;
        if (Object.entries(patch).every(([key, value]) => Object.is(j[key as keyof Job], value)))
          return j;
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
      });
      return next.every((job, i) => job === all[i]) ? all : next;
    });
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
            const network = (
              navigator as Navigator & {
                connection?: { saveData?: boolean; effectiveType?: string };
              }
            ).connection;
            const slow = Boolean(
              network?.saveData || /(^|-)2g$/.test(network?.effectiveType || ''),
            );
            const now = Date.now();
            if (
              now - lastPreviewAt.current <
              previewInterval(powerRef.current.saving, document.hidden, slow)
            )
              return;
            const parsed = parseBinaryPreview(event.data);
            if (parsed) {
              const runningJob = jobRef.current.find((j) => !j.preview && j.status === 'running');
              if (runningJob) {
                lastPreviewAt.current = now;
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
          let j = data?.prompt_id
            ? jobRef.current.find(
                (j) => j.id === data.prompt_id && j.base === connection.base && !j.preview,
              )
            : undefined;

          // Some ComfyUI versions send executing { node: null } or status without prompt_id when done
          if (!j && data && (data.node === null || type === 'executing')) {
            j = jobRef.current.find((item) => !item.preview && item.status === 'running');
          }

          if (!j || ['complete', 'error', 'cancelled'].includes(j.status)) return;
          if (type === 'progress')
            updateJob(j.id, {
              status: 'running',
              stage: 'sampling',
              progress: Math.min(99, Math.round((data.value / Math.max(1, data.max)) * 100)),
            });
          if (type === 'execution_start')
            updateJob(j.id, { status: 'running', stage: 'preparing' });
          if (type === 'executing' && data.node !== null) {
            const graph = buildWorkflow(j.settings);
            const node = graph[String(data.node)]?.class_type || '';
            updateJob(j.id, {
              stage: /SaveImage|VAEDecode|ImageScale|ImageUpscale/i.test(node)
                ? 'saving'
                : /sampler/i.test(node)
                  ? 'sampling'
                  : 'preparing',
            });
          }
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
  }, [connection.base, connection.preview, clientId, online]);
  useEffect(() => {
    let stopped = false,
      polling = false,
      pollTimer: ReturnType<typeof setTimeout>;
    async function poll() {
      if (polling || !navigator.onLine) return;
      polling = true;
      try {
        const queues = new Map<string, Queue>();
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
              let q = queues.get(j.base);
              if (!q) {
                q = await request<Queue>(j.base, '/queue');
                queues.set(j.base, q);
              }
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
      const hasPendingJob = jobRef.current.some(
        (j) => !j.preview && ['queued', 'running'].includes(j.status),
      );
      const delay =
        document.hidden && powerRef.current.saving
          ? 30000
          : isWsConnectedRef.current
            ? 15000
            : hasPendingJob
              ? 2500
              : 10000;
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
      // Find the currently running or earliest queued preview job to run one by one
      const activePreview =
        jobRef.current.find((j) => j.preview && j.status === 'running') ||
        jobRef.current
          .filter((j) => j.preview && j.status === 'queued')
          .sort((a, b) => a.createdAt - b.createdAt)[0];

      if (!activePreview) return;

      setJobs((all) =>
        all.map((j) => {
          if (j.id !== activePreview.id) return j;
          const startedAt = j.startedAt || Date.now();
          const progress = Math.min(100, Math.round((Date.now() - startedAt) / 45));
          const isDone = progress === 100;
          return {
            ...j,
            progress,
            status: isDone ? 'complete' : 'running',
            startedAt,
            completedAt: isDone ? j.completedAt || Date.now() : undefined,
            images: isDone ? [{ filename: 'sample.svg', subfolder: '', type: 'output' }] : [],
          };
        }),
      );
    }, 300);
    return () => clearInterval(timer);
  }, [setJobs]);

  async function submitSingleJob(input: Generation, isBatch = false): Promise<boolean> {
    if (!online && !connection.preview) {
      notify('네트워크 연결 후 다시 생성해 주세요');
      return false;
    }
    if (!connection.preview && connectionState !== 'connected') {
      notify('연결 설정에서 서버를 확인해 주세요');
      return false;
    }
    const snapshot = structuredClone(input);
    const usesModel = !snapshot.upscale || snapshot.upscale.refine > 0;
    if (!connection.preview && usesModel) {
      try {
        validateSelection(snapshot, info!, familyAssignments);
      } catch (e) {
        notify((e as Error).message);
        return false;
      }
    }
    if (snapshot.random && !snapshot.workflow) snapshot.seed = randomSeed();
    const workflow = buildWorkflow(snapshot);
    if (!connection.preview) {
      try {
        validateAgainstServer(workflow, info!);
      } catch (e) {
        notify((e as Error).message);
        return false;
      }
    }
    if (!snapshot.upscale && !snapshot.draftTarget && !isBatch)
      setSettings(reusableSettings(snapshot));
    const tempId = newId();
    const job: Job = {
      id: tempId,
      createdAt: Date.now(),
      settings: snapshot,
      base: connection.base,
      preview: connection.preview,
      status: connection.preview ? 'queued' : 'submitting',
      startedAt: connection.preview ? Date.now() : undefined,
      progress: 0,
      images: [],
      requestToken: tempId,
    };
    setJobs((all) => trimJobsPreservingFavorites([job, ...all], 500));

    if (!connection.preview) {
      try {
        const response = await submit(
          connection.base,
          workflow,
          clientId,
          {
            comfymui: { ...snapshot, workflow: null },
            comfymui_request_id: tempId,
          },
          tempId,
        );
        if (!response.prompt_id) throw new Error('서버의 작업 번호를 확인할 수 없습니다');
        updateJob(tempId, { id: response.prompt_id, status: 'queued' });
        return true;
      } catch (e) {
        const message = (e as Error).message;
        updateJob(tempId, {
          status: 'error',
          error: message + '\n서버 큐를 확인한 뒤 재시도해 주세요',
          submissionUncertain: !(e instanceof ApiError) || e.status === 0 || e.status >= 500,
        });
        notify(message);
        return false;
      }
    }
    return true;
  }

  async function generate(input = settings) {
    if (submitLock.current) return;
    submitLock.current = true;
    setBusy(true);
    try {
      const ok = await submitSingleJob(input);
      if (ok) {
        notify(connection.preview ? '미리보기 체험을 시작했어요' : '생성 요청을 서버에 보냈어요');
      }
    } finally {
      submitLock.current = false;
      setBusy(false);
    }
  }

  function removeFromQueue(id: string) {
    const target = jobRef.current.find((j) => j.id === id);
    if (target) {
      void cancel(target);
    }
  }

  function moveQueueItem() {
    notify('서버 대기열은 등록된 순서대로 실행돼요');
  }

  async function clearQueue() {
    const pendingJobs = jobRef.current.filter((j) => j.status === 'queued');
    if (pendingJobs.length === 0) {
      notify('대기 중인 작업이 없어요');
      return;
    }
    const realServerJobs = pendingJobs.filter((j) => !j.preview);
    const idsToDelete = realServerJobs.map((j) => j.id);

    if (idsToDelete.length > 0) {
      try {
        await request(connection.base, '/queue', {
          method: 'POST',
          body: JSON.stringify({ delete: idsToDelete }),
        });
      } catch (e) {
        notify((e as Error).message);
        return;
      }
    }

    setJobs((all) =>
      all.map((j) => (pendingJobs.some((p) => p.id === j.id) ? { ...j, status: 'cancelled' } : j)),
    );
    notify(`대기열의 ${pendingJobs.length}개 작업을 모두 취소했어요`);
  }

  async function enqueueBatch(count: number, base = settings) {
    if (submitLock.current) return;
    submitLock.current = true;
    setBusy(true);
    const validCount = Math.min(20, Math.max(1, Math.round(count)));
    let successCount = 0;
    try {
      for (let i = 0; i < validCount; i++) {
        const snap = structuredClone(base);
        if (snap.random && !snap.workflow) snap.seed = randomSeed();
        else if (!snap.workflow && i > 0) snap.seed = randomSeed();
        const ok = await submitSingleJob(snap, i > 0);
        if (ok) {
          successCount++;
        } else {
          break;
        }
      }
      if (successCount > 0) {
        notify(
          connection.preview
            ? `${successCount}회 연속 생성을 시작했어요`
            : `ComfyUI 서버 대기열에 ${successCount}건을 일괄 등록했어요`,
        );
      }
    } finally {
      submitLock.current = false;
      setBusy(false);
    }
  }

  async function enqueueExperiment(inputs: Generation[]) {
    if (submitLock.current) return;
    if (inputs.length < 2 || inputs.length > 6) {
      notify('실험은 2~6개 조건으로 실행해 주세요');
      return;
    }
    submitLock.current = true;
    setBusy(true);
    let sent = 0;
    try {
      for (const input of inputs) {
        if (!(await submitSingleJob(input, true))) break;
        sent++;
      }
      notify(
        `실험 ${sent}/${inputs.length}개 조건을 ${connection.preview ? '미리보기' : '서버 대기열'}에 등록했어요`,
      );
    } finally {
      submitLock.current = false;
      setBusy(false);
    }
  }

  async function checkSubmission(job: Job): Promise<boolean> {
    if (job.preview || !job.submissionUncertain) return false;
    try {
      const queue = await request<Queue>(job.base, '/queue');
      const match = [...queue.queue_running, ...queue.queue_pending].find((row) => {
        const extra = row[3] as { comfymui_request_id?: string } | undefined;
        return extra?.comfymui_request_id === (job.requestToken || job.id);
      });
      if (match) {
        // Replace the uncertain record in place; normal terminal-state guards do not apply.
        setJobs((all) =>
          all.map((j) =>
            j.id === job.id
              ? {
                  ...j,
                  id: match[1],
                  status: queue.queue_running.some((r) => r[1] === match[1]) ? 'running' : 'queued',
                  submissionUncertain: false,
                  error: undefined,
                }
              : j,
          ),
        );
        notify('서버에서 기존 요청을 찾았어요. 새 요청 없이 추적을 이어가요');
        return true;
      }
      if (job.base === GALLERY_BASE) {
        const index = await fetchGallery(true);
        if (index?.available) {
          setGallery(index);
          const files = index.files.filter(
            (file) => file.requestToken === (job.requestToken || job.id),
          );
          if (files.length) {
            setJobs((all) =>
              all.map((j) =>
                j.id === job.id
                  ? {
                      ...j,
                      status: 'complete',
                      submissionUncertain: false,
                      error: undefined,
                      progress: 100,
                      completedAt: Math.max(...files.map((file) => file.mtime)),
                      images: files.map((file) => ({
                        filename: file.filename,
                        subfolder: file.subfolder,
                        type: file.type,
                        v: file.mtime,
                      })),
                    }
                  : j,
              ),
            );
            notify('이미 저장된 결과를 찾았어요. 새 요청 없이 결과를 복원했어요');
            return true;
          }
        }
      }
      notify('대기열에서 요청을 찾지 못했어요. 이미 완료됐을 수 있으니 기록을 확인해 주세요');
      return false;
    } catch (error) {
      notify((error as Error).message);
      throw error;
    }
  }

  function pinSeed(seed: number) {
    setSettings((s) => ({ ...s, seed, random: false }));
    notify(`Seed ${seed}번으로 고정했어요`);
  }

  function generateVariation(baseJob: Job) {
    const next = baseSettings(structuredClone(baseJob.settings));
    delete next.experiment;
    delete next.draftTarget;
    next.seed = randomSeed();
    next.random = true;
    void generate(next);
  }

  function generateUpscale(baseJob: Job, model: string, scale: number, refine: number) {
    const source = baseJob.images[0];
    if (!source) return;
    const next = upscaleSettings(structuredClone(baseJob.settings), source, model, scale, refine);
    delete next.experiment;
    delete next.draftTarget;
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

  async function refreshGallery(force = false) {
    if (connection.preview) {
      setGallery(null);
      return;
    }
    const next = await fetchGallery(force);
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
  const hasActiveJob = jobs.some((j) => ['submitting', 'queued', 'running'].includes(j.status));
  const isRunning = jobs.some((j) => ['submitting', 'running'].includes(j.status));
  // Server jobs continue without keeping an audio pipeline or phone screen awake.
  useEffect(() => {
    if (hasActiveJob && power.backgroundAudio && !power.saving) {
      backgroundKeepAlive.start();
    } else {
      backgroundKeepAlive.stop();
    }

    let disposed = false;
    if (isRunning && power.keepScreen && !power.saving) {
      if ('wakeLock' in navigator && !wakeLockRef.current) {
        navigator.wakeLock
          .request('screen')
          .then((wl) => {
            if (disposed) {
              void wl.release();
              return;
            }
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
      if (!isRunning && activePreviewBlobRef.current) {
        URL.revokeObjectURL(activePreviewBlobRef.current);
        activePreviewBlobRef.current = null;
        setLivePreviewUrl('');
      }
    }

    return () => {
      disposed = true;
    };
  }, [hasActiveJob, isRunning, power]);
  useEffect(
    () => () => {
      backgroundKeepAlive.stop();
      void wakeLockRef.current?.release();
      if (activePreviewBlobRef.current) URL.revokeObjectURL(activePreviewBlobRef.current);
    },
    [],
  );

  useEffect(() => {
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
          if (notificationsEnabled && 'vibrate' in navigator) {
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
        if (
          running &&
          powerRef.current.keepScreen &&
          !powerRef.current.saving &&
          'wakeLock' in navigator &&
          !wakeLockRef.current
        ) {
          navigator.wakeLock
            .request('screen')
            .then((wl) => {
              if (!powerRef.current.keepScreen || powerRef.current.saving) {
                void wl.release();
                return;
              }
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
    void refreshGallery(true);
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
    reconnect();
  }
  const runningJob = jobs.find((j) => ['submitting', 'running'].includes(j.status));
  const queuedJob = jobs
    .filter((j) => j.status === 'queued')
    .sort((a, b) => a.createdAt - b.createdAt)[0];
  const active = runningJob || queuedJob || null;
  const serverQueue = jobs.filter((j) => j.status === 'queued');
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
    reconnect,
    refreshModels,
    connect,
    preview: () => setConnection({ ...connection, preview: true }),
    notice,
    notify,
    online,
    socketState,
    generate,
    enqueueExperiment,
    checkSubmission,
    busy,
    active,
    cancel,
    clientQueue: serverQueue,
    serverQueue,
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
    power,
    setPower,
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
type StudioStore = { get: () => Studio; subscribe: (listener: () => void) => () => void };
const Context = createContext<StudioStore | null>(null);
export function StudioProvider({ children }: { children: ReactNode }) {
  const state = useStudioState();
  const live = useRef(state);
  live.current = state;
  const store = useRef<{
    snapshot: Studio;
    listeners: Set<() => void>;
    actions: Partial<Studio>;
    api: StudioStore;
  } | null>(null);
  if (!store.current) {
    const actions = Object.fromEntries(
      Object.entries(state)
        .filter(([, value]) => typeof value === 'function')
        .map(([key]) => [
          key,
          (...args: unknown[]) => (live.current[key as keyof Studio] as Function)(...args),
        ]),
    ) as Partial<Studio>;
    const listeners = new Set<() => void>();
    const entry = {
      snapshot: { ...state, ...actions },
      listeners,
      actions,
      api: null as unknown as StudioStore,
    };
    entry.api = {
      get: () => entry.snapshot,
      subscribe: (listener) => {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
    };
    store.current = entry;
  }
  useLayoutEffect(() => {
    store.current!.snapshot = { ...state, ...store.current!.actions };
    store.current!.listeners.forEach((listener) => listener());
  });
  return <Context.Provider value={store.current.api}>{children}</Context.Provider>;
}
function sameSelection<T>(a: T, b: T) {
  if (Object.is(a, b)) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
  const keys = Object.keys(a);
  return (
    keys.length === Object.keys(b).length &&
    keys.every((key) =>
      Object.is((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]),
    )
  );
}
export function useStudioSelector<T>(selector: (state: Studio) => T): T {
  const store = useContext(Context)!;
  const cached = useRef<{ value: T } | null>(null);
  return useSyncExternalStore(store.subscribe, () => {
    const next = selector(store.get());
    if (!cached.current || !sameSelection(cached.current.value, next))
      cached.current = { value: next };
    return cached.current.value;
  });
}
export function useStudio() {
  return useStudioSelector((state) => state);
}
