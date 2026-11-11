import { useEffect, useMemo, useRef, useState, type UIEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Box,
  Check,
  CloudDownload,
  ExternalLink,
  Eye,
  EyeOff,
  FolderInput,
  Heart,
  Plus,
  RefreshCw,
  ScanSearch,
  Search,
  Trash2,
  Wand2,
  X,
} from 'lucide-react';
import { useStudioSelector } from '../studio';
import { assetFamily, families, selectModel, type ModelEntry, type ModelFamily } from '../models';
import {
  DEMO_MODELS,
  addModelTags,
  deleteModelFile,
  fetchModelCivitaiMetadata,
  fetchModelCivitaiVersionById,
  fetchModelCivitaiVersions,
  fetchModelFolders,
  fetchModelList,
  fetchModelRoots,
  fetchModelTopTags,
  formatBytes,
  formatModelSubType,
  inferFamilyFromModelItem,
  isSpecializedModelPath,
  isVideoPreview,
  modelPreviewUrl,
  moveModelFile,
  civitaiAirProblem,
  parseCivitaiAir,
  refreshModelUpdates,
  relinkModelCivitai,
  renameModelFile,
  resolveComfyModelEntry,
  resolveComfyModelName,
  saveModelMetadata,
  scanModels,
  type CivitaiAir,
  type CivitaiVersion,
  type ModelManagerItem,
} from '../model-manager';
import { Empty, IconButton, Modal, MultiSelect, SelectControl, Spinner } from '../components/ui';
import { DetailExamples } from '../components/ExampleGallery';
import { HeaderActionButton, HeaderActions } from '../components/HeaderActions';
import { DownloadTray } from '../components/DownloadTray';

export default function Models() {
  const {
    connection,
    info,
    settings,
    setSettings,
    familyAssignments,
    setFamilyAssignments,
    refreshModels,
    notify,
    downloads,
    startDownload,
    cancelDownload,
    libraryRevision,
  } = useStudioSelector((s) => ({
    connection: s.connection,
    info: s.info,
    settings: s.settings,
    setSettings: s.setSettings,
    familyAssignments: s.familyAssignments,
    setFamilyAssignments: s.setFamilyAssignments,
    refreshModels: s.refreshModels,
    notify: s.notify,
    downloads: s.downloads,
    startDownload: s.startDownload,
    cancelDownload: s.cancelDownload,
    libraryRevision: s.libraryRevision,
  }));
  const navigate = useNavigate();

  const [items, setItems] = useState<ModelManagerItem[]>(connection.preview ? DEMO_MODELS : []);
  const [total, setTotal] = useState<number>(connection.preview ? DEMO_MODELS.length : 0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [checkingUpdates, setCheckingUpdates] = useState(false);
  const [apiError, setApiError] = useState('');

  // Filter states
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [folder, setFolder] = useState('all');
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [tagLogic, setTagLogic] = useState<'any' | 'all'>('any');
  const [status, setStatus] = useState<'all' | 'favorites' | 'updates'>('all');
  const favoritesOnly = status === 'favorites';
  const updatesOnly = status === 'updates';
  const [showNsfw, setShowNsfw] = useState(false);

  // Facets & Tag management states
  const [folders, setFolders] = useState<string[]>(['Flux1.D', 'Krea2', 'Qwen']);
  const [roots, setRoots] = useState<string[]>([
    'E:/ComfyUI/models/diffusion_models',
    'E:/ComfyUI/models/checkpoints',
  ]);
  const [topTags, setTopTags] = useState<{ tag: string; count: number }[]>([
    { tag: 'flux', count: 10 },
    { tag: 'photorealistic', count: 8 },
    { tag: 'portrait', count: 6 },
    { tag: 'krea2', count: 4 },
    { tag: 'qwen', count: 4 },
    { tag: 'editorial', count: 3 },
  ]);

  // Detail modal state
  const [activeModel, setActiveModel] = useState<ModelManagerItem | null>(null);
  const [editModelName, setEditModelName] = useState('');
  const [editBaseModel, setEditBaseModel] = useState('');
  const [editFamily, setEditFamily] = useState<ModelFamily | ''>('');
  const [editNotes, setEditNotes] = useState('');
  const [editTagInput, setEditTagInput] = useState('');
  const [editRenameInput, setEditRenameInput] = useState('');
  const [editMoveFolder, setEditMoveFolder] = useState('');
  const [relinkModelId, setRelinkModelId] = useState('');
  const [relinkVersionId, setRelinkVersionId] = useState('');
  const [remoteVersions, setRemoteVersions] = useState<CivitaiVersion[]>([]);
  const [loadingVersions, setLoadingVersions] = useState(false);
  const [savingDetail, setSavingDetail] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<ModelManagerItem | null>(null);
  const [examplesRevision, setExamplesRevision] = useState(0);
  // A new default image replaces the card preview without reloading the list.
  function handlePreviewChanged(filePath: string, previewUrl: string, nsfwLevel: number) {
    const patch = (x: ModelManagerItem) =>
      x.file_path === filePath
        ? { ...x, preview_url: previewUrl, preview_nsfw_level: nsfwLevel }
        : x;
    setItems((prev) => prev.map(patch));
    setActiveModel((prev) => (prev ? patch(prev) : prev));
  }

  // CivitAI download modal state
  const [downloadModalOpen, setDownloadModalOpen] = useState(false);
  const [civitaiQuery, setCivitaiQuery] = useState('');
  const [lookupLoading, setLookupLoading] = useState(false);
  const [lookupVersions, setLookupVersions] = useState<CivitaiVersion[]>([]);
  const [lookupAir, setLookupAir] = useState<CivitaiAir | null>(null);
  const [selectedVersionId, setSelectedVersionId] = useState<number>(0);
  const [targetRoot, setTargetRoot] = useState('');
  const [targetFolder, setTargetFolder] = useState('auto');
  const [customSubfolder, setCustomSubfolder] = useState('');
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const t = setTimeout(() => {
      setDebouncedSearch(search);
    }, 220);
    return () => clearTimeout(t);
  }, [search]);

  async function loadFacets() {
    if (connection.preview) {
      setFolders(['Flux1.D', 'Krea2', 'Qwen']);
      setRoots(['E:/ComfyUI/models/diffusion_models', 'E:/ComfyUI/models/checkpoints']);
      setTopTags([
        { tag: 'flux', count: 1 },
        { tag: 'photorealistic', count: 1 },
        { tag: 'portrait', count: 1 },
        { tag: 'krea2', count: 1 },
        { tag: 'moss', count: 1 },
        { tag: 'qwen', count: 1 },
      ]);
      return;
    }
    try {
      const [fList, rList, tList] = await Promise.all([
        fetchModelFolders(connection.base).catch(() => []),
        fetchModelRoots(connection.base).catch(() => []),
        fetchModelTopTags(connection.base, 150).catch(() => []),
      ]);
      if (fList.length) setFolders(fList);
      if (rList.length) {
        const primary = rList.find((r) => /[/\\]diffusion_models[/\\]?$/i.test(r));
        const ordered = primary ? [primary, ...rList.filter((r) => r !== primary)] : rList;
        setRoots(ordered);
        setTargetRoot((prev) => prev || ordered[0]);
      }
      if (tList.length) setTopTags(tList);
    } catch {
      /* Facets are optional */
    }
  }

  async function loadModels(targetPage = 1, append = false) {
    if (connection.preview) {
      setApiError('');
      let filtered = [...DEMO_MODELS];
      if (debouncedSearch.trim()) {
        const q = debouncedSearch.trim().toLowerCase();
        filtered = filtered.filter(
          (item) =>
            item.model_name.toLowerCase().includes(q) ||
            item.file_name.toLowerCase().includes(q) ||
            (item.base_model || '').toLowerCase().includes(q) ||
            item.tags.some((t) => t.toLowerCase().includes(q)),
        );
      }
      if (folder !== 'all') {
        filtered = filtered.filter((item) => item.folder === folder);
      }
      if (selectedTags.length > 0) {
        filtered = filtered.filter((item) => {
          const itemTags = item.tags.map((t) => t.toLowerCase());
          if (tagLogic === 'all') {
            return selectedTags.every((st) => itemTags.includes(st.toLowerCase()));
          }
          return selectedTags.some((st) => itemTags.includes(st.toLowerCase()));
        });
      }
      if (favoritesOnly) {
        filtered = filtered.filter((item) => item.favorite);
      }
      if (updatesOnly) {
        filtered = filtered.filter((item) => item.update_available);
      }
      setItems(filtered);
      setTotal(filtered.length);
      setPage(1);
      return;
    }

    if (append) {
      setLoadingMore(true);
    } else {
      setLoading(true);
      setApiError('');
    }

    try {
      const res = await fetchModelList(connection.base, {
        page: targetPage,
        pageSize: 100,
        search: debouncedSearch,
        folder,
        tags: selectedTags,
        tagLogic,
        favoritesOnly,
        updatesOnly,
      });

      if (append) {
        setItems((prev) => [...prev, ...(res.items || [])]);
      } else {
        setItems(res.items || []);
        scrollContainerRef.current?.scrollTo({ top: 0 });
      }
      setTotal(res.total || 0);
      setPage(targetPage);
    } catch (e) {
      setApiError((e as Error).message);
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }

  useEffect(() => {
    void loadModels(1, false);
  }, [
    connection.base,
    connection.preview,
    debouncedSearch,
    folder,
    selectedTags,
    tagLogic,
    favoritesOnly,
    updatesOnly,
  ]);

  useEffect(() => {
    void loadFacets();
  }, [connection.base, connection.preview]);

  // Reload the library when a background download lands.
  const libraryRevisionRef = useRef(libraryRevision);
  useEffect(() => {
    if (libraryRevisionRef.current === libraryRevision) return;
    libraryRevisionRef.current = libraryRevision;
    void loadFacets();
    void loadModels(1, false);
  }, [libraryRevision]);

  const kindDownloads = downloads.filter((d) => d.kind === 'model' && d.base === connection.base);
  const isDownloadingVersion = (versionId?: number) =>
    Boolean(versionId) && kindDownloads.some((d) => d.versionId === versionId);

  const hasMore = items.length < total;

  function handleScroll(e: UIEvent<HTMLDivElement>) {
    if (loading || loadingMore || !hasMore || connection.preview) return;
    const el = e.currentTarget;
    const nearBottom = el.scrollHeight - el.scrollTop <= el.clientHeight + 280;
    if (nearBottom) {
      void loadModels(page + 1, true);
    }
  }

  function openDetail(item: ModelManagerItem) {
    const comfyName = resolveComfyModelName(item, info);
    const assigned =
      assetFamily('model', comfyName, familyAssignments) || inferFamilyFromModelItem(item) || '';
    setActiveModel(item);
    setEditModelName(item.model_name || item.file_name);
    setEditBaseModel(item.base_model || '');
    setEditFamily(assigned);
    setEditNotes(item.notes || '');
    setEditTagInput('');
    setEditRenameInput(item.file_name);
    setEditMoveFolder(item.folder || '');
    setRelinkModelId(item.civitai?.modelId ? String(item.civitai.modelId) : '');
    setRelinkVersionId(item.civitai?.id ? String(item.civitai.id) : '');
    setRemoteVersions([]);
  }

  function applyModelToGeneration(item: ModelManagerItem, navigateAfter = false) {
    const comfyName = resolveComfyModelName(item, info);
    if (isSpecializedModelPath(comfyName) || isSpecializedModelPath(item.file_path)) {
      notify('전용 워크플로 모델입니다. API 워크플로에서 사용해 주세요');
      return;
    }

    const isCheckpoint = item.sub_type === 'checkpoint' && !/\.gguf$/i.test(item.file_path || '');
    const preferredFamily: ModelFamily = isCheckpoint
      ? 'flux'
      : (editFamily && activeModel?.file_path === item.file_path ? editFamily : null) ||
        assetFamily('model', comfyName, familyAssignments) ||
        inferFamilyFromModelItem(item) ||
        settings.architecture;

    const nextAssignments = {
      ...familyAssignments,
      [`model:${comfyName}`]: preferredFamily,
    };
    setFamilyAssignments(nextAssignments);

    let entry: ModelEntry | null = resolveComfyModelEntry(item, info, nextAssignments);
    if (!entry) {
      const isGguf = /\.gguf$/i.test(item.file_path || '');
      entry = {
        id: `${isGguf ? 'UnetLoaderGGUF' : isCheckpoint ? 'CheckpointLoaderSimple' : 'UNETLoader'}:${comfyName}`,
        name: comfyName,
        loader: isGguf ? 'UnetLoaderGGUF' : isCheckpoint ? 'CheckpointLoaderSimple' : 'UNETLoader',
        family: preferredFamily,
        format: isGguf ? 'GGUF' : isCheckpoint ? '체크포인트' : 'Diffusion',
      };
    }

    setSettings((prev) => selectModel(prev, entry!, info, nextAssignments));
    const familyLabel = families.find((f) => f.id === entry!.family)?.label || entry.family;
    notify(`${item.model_name || item.file_name} (${familyLabel}) 모델을 선택했어요`);

    if (navigateAfter) {
      setActiveModel(null);
      navigate('/create');
    }
  }

  async function handleToggleFavorite(item: ModelManagerItem) {
    const nextFav = !item.favorite;
    setItems((prev) =>
      prev.map((x) => (x.file_path === item.file_path ? { ...x, favorite: nextFav } : x)),
    );
    if (activeModel?.file_path === item.file_path) {
      setActiveModel((prev) => (prev ? { ...prev, favorite: nextFav } : null));
    }
    if (connection.preview) {
      notify(nextFav ? '즐겨찾기에 등록했어요' : '즐겨찾기에서 해제했어요');
      return;
    }
    try {
      await saveModelMetadata(connection.base, {
        file_path: item.file_path,
        favorite: nextFav,
      });
      notify(nextFav ? '즐겨찾기에 등록했어요' : '즐겨찾기에서 해제했어요');
    } catch (e) {
      notify((e as Error).message);
      void loadModels(1, false);
    }
  }

  async function handleScanModels() {
    if (connection.preview) {
      notify('미리보기 모드에서는 데모 모델 목록을 유지해요');
      return;
    }
    setScanning(true);
    try {
      await scanModels(connection.base, false);
      refreshModels();
      await Promise.all([loadFacets(), loadModels(1, false)]);
      notify('로컬 모델 폴더 스캔과 설치 목록 갱신을 완료했어요');
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setScanning(false);
    }
  }

  async function handleRefreshUpdates() {
    if (connection.preview) {
      notify('미리보기 모드에서 1개의 업데이트 가능 모델을 확인했어요');
      return;
    }
    setCheckingUpdates(true);
    try {
      const res = await refreshModelUpdates(connection.base);
      const updateCount = (res.records || []).filter((r) => r.has_update).length;
      await loadModels(1, false);
      notify(
        updateCount > 0
          ? `CivitAI 확인 결과 ${updateCount}개 모델의 새 버전이 있어요`
          : '모든 모델이 최신 버전 상태예요',
      );
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setCheckingUpdates(false);
    }
  }

  async function handleSaveDetail() {
    if (!activeModel) return;
    const comfyName = resolveComfyModelName(activeModel, info);
    if (editFamily) {
      setFamilyAssignments((prev) => ({
        ...prev,
        [`model:${comfyName}`]: editFamily,
      }));
    }

    if (connection.preview) {
      const updated: ModelManagerItem = {
        ...activeModel,
        model_name: editModelName.trim() || activeModel.file_name,
        base_model: editBaseModel.trim() || activeModel.base_model,
        notes: editNotes,
      };
      setItems((prev) => prev.map((x) => (x.file_path === activeModel.file_path ? updated : x)));
      setActiveModel(updated);
      notify('모델 메타데이터와 계열 분류를 저장했어요');
      return;
    }

    setSavingDetail(true);
    try {
      await saveModelMetadata(connection.base, {
        file_path: activeModel.file_path,
        model_name: editModelName.trim() || activeModel.file_name,
        base_model: editBaseModel.trim() || activeModel.base_model,
        notes: editNotes,
      });
      await loadModels(1, false);
      setActiveModel((prev) =>
        prev
          ? {
              ...prev,
              model_name: editModelName.trim() || prev.file_name,
              base_model: editBaseModel.trim() || prev.base_model,
              notes: editNotes,
            }
          : null,
      );
      notify('모델 메타데이터와 계열 분류를 저장했어요');
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setSavingDetail(false);
    }
  }

  async function handleAddTag() {
    if (!activeModel || !editTagInput.trim()) return;
    const newTags = editTagInput
      .split(',')
      .map((t) => t.trim().toLowerCase())
      .filter(Boolean);
    if (!newTags.length) return;

    if (connection.preview) {
      const merged = [...new Set([...(activeModel.tags || []), ...newTags])];
      setActiveModel({ ...activeModel, tags: merged });
      setItems((prev) =>
        prev.map((x) => (x.file_path === activeModel.file_path ? { ...x, tags: merged } : x)),
      );
      setEditTagInput('');
      notify('태그를 추가했어요');
      return;
    }

    try {
      const res = await addModelTags(connection.base, activeModel.file_path, newTags);
      const merged = res.tags || [...new Set([...(activeModel.tags || []), ...newTags])];
      setActiveModel({ ...activeModel, tags: merged });
      setEditTagInput('');
      await loadModels(page, false);
      void loadFacets();
      notify('태그를 추가했어요');
    } catch (e) {
      notify((e as Error).message);
    }
  }

  async function handleRemoveTag(tagToRemove: string) {
    if (!activeModel) return;
    const remaining = (activeModel.tags || []).filter((t) => t !== tagToRemove);

    if (connection.preview) {
      setActiveModel({ ...activeModel, tags: remaining });
      setItems((prev) =>
        prev.map((x) => (x.file_path === activeModel.file_path ? { ...x, tags: remaining } : x)),
      );
      notify(`#${tagToRemove} 태그를 삭제했어요`);
      return;
    }

    try {
      await saveModelMetadata(connection.base, {
        file_path: activeModel.file_path,
        tags: remaining,
      });
      setActiveModel({ ...activeModel, tags: remaining });
      setItems((prev) =>
        prev.map((x) => (x.file_path === activeModel.file_path ? { ...x, tags: remaining } : x)),
      );
      void loadFacets();
      notify(`#${tagToRemove} 태그를 삭제했어요`);
    } catch (e) {
      notify((e as Error).message);
    }
  }

  async function handleSyncCivitaiSingle() {
    if (!activeModel) return;
    if (connection.preview) {
      notify('미리보기 모드에서 CivitAI 메타데이터 동기화를 완료했어요');
      return;
    }
    setSavingDetail(true);
    try {
      const res = await fetchModelCivitaiMetadata(connection.base, activeModel.file_path);
      if (!res.success) throw new Error(res.error || 'CivitAI 정보를 찾을 수 없습니다');
      await loadModels(1, false);
      if (res.metadata) setActiveModel(res.metadata);
      setExamplesRevision((n) => n + 1);
      notify('CivitAI 메타데이터와 프리뷰를 동기화했어요');
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setSavingDetail(false);
    }
  }

  async function handleRelinkCivitai() {
    if (!activeModel) return;
    const mid = Number(relinkModelId.trim());
    const vid = relinkVersionId.trim() ? Number(relinkVersionId.trim()) : undefined;
    if (!Number.isInteger(mid) || mid <= 0) {
      notify('올바른 CivitAI 모델 ID 숫자를 입력해 주세요');
      return;
    }
    if (connection.preview) {
      notify(`CivitAI 모델 #${mid}로 연결을 갱신했어요`);
      return;
    }
    setSavingDetail(true);
    try {
      await relinkModelCivitai(connection.base, {
        file_path: activeModel.file_path,
        model_id: mid,
        ...(vid && vid > 0 ? { model_version_id: vid } : {}),
      });
      await loadModels(1, false);
      setExamplesRevision((n) => n + 1);
      notify(`CivitAI 모델 #${mid}로 재연결했어요`);
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setSavingDetail(false);
    }
  }

  async function handleLoadRemoteVersions(modelId?: number) {
    const mid = modelId || activeModel?.civitai?.modelId;
    if (!mid) {
      notify('연결된 CivitAI 모델 ID가 없습니다');
      return;
    }
    if (connection.preview) {
      setRemoteVersions([
        {
          id: 852897,
          modelId: mid,
          name: 'v2.0 FP8',
          baseModel: 'Flux.1 D',
          existsLocally: true,
          modelSizeKB: 11_622_555,
        },
        {
          id: 992100,
          modelId: mid,
          name: 'v3.0 Studio FP8 (최신 업데이트)',
          baseModel: 'Flux.1 D',
          existsLocally: false,
          modelSizeKB: 11_840_000,
        },
      ]);
      return;
    }
    setLoadingVersions(true);
    try {
      const versions = await fetchModelCivitaiVersions(connection.base, mid);
      setRemoteVersions(versions);
      if (versions.length === 0) {
        notify('조회된 CivitAI 버전이 없습니다');
      }
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setLoadingVersions(false);
    }
  }

  async function handleRenameModel() {
    if (!activeModel) return;
    const clean = editRenameInput.trim().replace(/\.(safetensors|sft|gguf|ckpt|pt|pth|bin)$/i, '');
    if (!clean || clean === activeModel.file_name) return;
    if (connection.preview) {
      setActiveModel({ ...activeModel, file_name: clean });
      setItems((prev) =>
        prev.map((x) => (x.file_path === activeModel.file_path ? { ...x, file_name: clean } : x)),
      );
      notify(`파일명을 ${clean}으로 변경했어요`);
      return;
    }
    setSavingDetail(true);
    try {
      await renameModelFile(connection.base, activeModel.file_path, clean);
      refreshModels();
      await loadModels(1, false);
      setActiveModel(null);
      notify(`파일명을 ${clean}으로 변경했어요`);
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setSavingDetail(false);
    }
  }

  async function handleMoveModel() {
    if (!activeModel) return;
    const matchedRoot =
      roots.find((r) =>
        activeModel.file_path
          .replaceAll('\\', '/')
          .toLowerCase()
          .startsWith(r.replaceAll('\\', '/').toLowerCase()),
      ) ||
      roots[0] ||
      'E:/ComfyUI/models/diffusion_models';
    const targetDir = editMoveFolder
      ? `${matchedRoot.replace(/\/+$/, '')}/${editMoveFolder.replace(/^\/+|\/+$/g, '')}`
      : matchedRoot.replace(/\/+$/, '');
    if (connection.preview) {
      setActiveModel({ ...activeModel, folder: editMoveFolder });
      setItems((prev) =>
        prev.map((x) =>
          x.file_path === activeModel.file_path ? { ...x, folder: editMoveFolder } : x,
        ),
      );
      notify(`폴더를 ${editMoveFolder || '루트'}로 이동했어요`);
      return;
    }
    setSavingDetail(true);
    try {
      await moveModelFile(connection.base, activeModel.file_path, targetDir);
      refreshModels();
      await loadModels(1, false);
      setActiveModel(null);
      notify(`폴더를 ${editMoveFolder || '루트'}로 이동했어요`);
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setSavingDetail(false);
    }
  }

  async function handleConfirmDelete() {
    if (!deleteTarget) return;
    if (connection.preview) {
      setItems((prev) => prev.filter((x) => x.file_path !== deleteTarget.file_path));
      setDeleteTarget(null);
      setActiveModel(null);
      notify('선택한 모델을 삭제했어요');
      return;
    }
    try {
      await deleteModelFile(connection.base, deleteTarget.file_path);
      refreshModels();
      setDeleteTarget(null);
      setActiveModel(null);
      await loadModels(1, false);
      notify('모델 파일을 삭제했어요');
    } catch (e) {
      notify((e as Error).message);
    }
  }

  async function handleLookupCivitai() {
    const problem = civitaiAirProblem(civitaiQuery, 'model');
    if (problem) {
      notify(problem);
      return;
    }
    const parsed = parseCivitaiAir(civitaiQuery)!;
    setLookupAir(parsed);
    if (connection.preview) {
      const mockVersion: CivitaiVersion = {
        id: parsed.modelVersionId || 992100,
        modelId: parsed.modelId || 705606,
        name: 'v3.0 Studio FP8',
        baseModel: 'Flux.1 D',
        existsLocally: false,
        modelSizeKB: 11_840_000,
        model: { name: 'Flux Studio Realism v3', type: 'Checkpoint' },
        images: [{ url: '/sample.svg', nsfwLevel: 1 }],
      };
      setLookupVersions([mockVersion]);
      setSelectedVersionId(mockVersion.id);
      return;
    }

    setLookupLoading(true);
    setLookupVersions([]);
    try {
      if (parsed.modelId) {
        const versions = await fetchModelCivitaiVersions(connection.base, parsed.modelId);
        if (!versions.length) {
          throw new Error('해당 CivitAI 모델의 버전 정보를 찾을 수 없습니다');
        }
        setLookupVersions(versions);
        const preferred =
          (parsed.modelVersionId && versions.find((v) => v.id === parsed.modelVersionId)) ||
          versions[0];
        setSelectedVersionId(preferred.id);
      } else if (parsed.modelVersionId) {
        const single = await fetchModelCivitaiVersionById(connection.base, parsed.modelVersionId);
        if (single.modelId) {
          const versions = await fetchModelCivitaiVersions(connection.base, single.modelId).catch(
            () => [single],
          );
          const list = versions.length ? versions : [single];
          setLookupVersions(list);
          setSelectedVersionId(single.id);
        } else {
          setLookupVersions([single]);
          setSelectedVersionId(single.id);
        }
      }
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setLookupLoading(false);
    }
  }

  async function handleStartDownload(opts?: {
    modelId?: number;
    modelVersionId: number;
    folderOverride?: string;
  }) {
    const versionId = opts?.modelVersionId || selectedVersionId;
    const selectedVer = lookupVersions.find((v) => v.id === versionId);
    const modelId = opts?.modelId || selectedVer?.modelId;
    if (!versionId) {
      notify('다운로드할 버전을 선택해 주세요');
      return;
    }

    if (connection.preview) {
      const newItem: ModelManagerItem = {
        model_name: selectedVer?.model?.name || selectedVer?.name || `CivitAI Model #${versionId}`,
        file_name: `civitai_model_${versionId}`,
        preview_url: '/sample.svg',
        preview_nsfw_level: 1,
        base_model: selectedVer?.baseModel || 'Flux.1 D',
        folder:
          opts?.folderOverride ??
          (targetFolder === 'auto'
            ? 'Flux1.D'
            : targetFolder === 'custom'
              ? customSubfolder.trim()
              : targetFolder),
        sha256: String(versionId).padStart(64, '0'),
        hash_status: 'completed',
        quantization: 'FP8',
        file_path: `E:/ComfyUI/models/checkpoints/civitai_model_${versionId}.safetensors`,
        file_size: (selectedVer?.modelSizeKB || 11_800_000) * 1024,
        modified: Math.floor(Date.now() / 1000),
        tags: ['civitai', 'checkpoint'],
        from_civitai: true,
        notes: 'CivitAI에서 다운로드한 모델',
        sub_type: 'checkpoint',
        favorite: false,
        update_available: false,
        civitai: {
          id: versionId,
          modelId: modelId || 705606,
          name: selectedVer?.name || 'v1.0',
        },
      };
      setItems((prev) => [
        newItem,
        ...prev.map((x) =>
          modelId && x.civitai?.modelId === modelId ? { ...x, update_available: false } : x,
        ),
      ]);
      setDownloadModalOpen(false);
      notify('CivitAI 모델 다운로드를 완료했어요');
      return;
    }

    const chosenFolder =
      opts?.folderOverride !== undefined
        ? opts.folderOverride
        : targetFolder === 'auto'
          ? ''
          : targetFolder === 'custom'
            ? customSubfolder.trim()
            : targetFolder;
    const useDefault = opts?.folderOverride === undefined && targetFolder === 'auto';
    const airFileId =
      lookupAir?.fileId && lookupAir.modelVersionId === versionId ? lookupAir.fileId : undefined;
    const version = selectedVer || remoteVersions.find((v) => v.id === versionId);
    const name =
      [version?.model?.name || activeModel?.model_name, version?.name].filter(Boolean).join(' ') ||
      `CivitAI #${versionId}`;

    startDownload(
      {
        id: `cm-mdl-${Date.now()}`,
        kind: 'model',
        base: connection.base,
        name,
        versionId,
        ...(modelId ? { modelId } : {}),
      },
      {
        ...(modelId ? { model_id: modelId } : {}),
        model_version_id: versionId,
        model_root: targetRoot || roots[0] || undefined,
        relative_path: chosenFolder,
        use_default_paths: useDefault,
        ...(airFileId ? { file_params: { id: airFileId } } : {}),
      },
    );
    setDownloadModalOpen(false);
    notify('백그라운드에서 다운로드를 시작했어요\n앱을 닫아도 ComfyUI 서버에서 계속 받아요');
  }

  const selectedLookupVersion = useMemo(
    () => lookupVersions.find((v) => v.id === selectedVersionId) || lookupVersions[0] || null,
    [lookupVersions, selectedVersionId],
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      <HeaderActions>
        <HeaderActionButton
          primary
          icon={CloudDownload}
          label="CivitAI 다운로드"
          onClick={() => setDownloadModalOpen(true)}
        />
        <HeaderActionButton
          icon={RefreshCw}
          label="업데이트 확인"
          busy={checkingUpdates}
          onClick={handleRefreshUpdates}
        />
        <HeaderActionButton
          icon={ScanSearch}
          label="로컬 스캔"
          busy={scanning}
          onClick={handleScanModels}
        />
      </HeaderActions>
      {/* Top Toolbar */}
      <div
        data-ui-audit-row
        className="flex flex-none flex-wrap items-center gap-2 border-b border-line bg-paper px-4 py-3 sm:px-5 lg:px-6"
      >
        <label className="relative w-full min-w-0 sm:w-64 lg:w-72">
          <Search
            size={15}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted"
          />
          <input
            type="search"
            aria-label="모델 검색"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="이름, 파일명, 태그, 베이스 모델 검색"
            className="field pl-10"
          />
        </label>
        <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto sm:max-w-full">
          <div className="min-w-0 sm:w-36">
            <SelectControl
              aria-label="상태 필터"
              value={status}
              onChange={(e) => setStatus(e.target.value as typeof status)}
            >
              <option value="all">전체 모델</option>
              <option value="favorites">즐겨찾기</option>
              <option value="updates">업데이트 가능</option>
            </SelectControl>
          </div>
          <div className="min-w-0 sm:w-36">
            <SelectControl
              aria-label="폴더 필터"
              value={folder}
              onChange={(e) => setFolder(e.target.value)}
            >
              <option value="all">전체 폴더</option>
              {folders.map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </SelectControl>
          </div>
          <div className="col-span-2 flex min-w-0 gap-2">
            <div className="min-w-0 flex-1 sm:w-56 sm:flex-initial">
              <MultiSelect
                label="태그 필터"
                placeholder="전체 태그"
                options={topTags.map((t) => ({ value: t.tag, label: `#${t.tag}`, count: t.count }))}
                value={selectedTags}
                onChange={setSelectedTags}
                footer={
                  <div className="flex items-center justify-between gap-2">
                    <div
                      role="group"
                      aria-label="태그 일치 조건"
                      className="flex rounded-md bg-paper p-0.5"
                    >
                      {(
                        [
                          ['any', '하나라도 포함'],
                          ['all', '모두 포함'],
                        ] as const
                      ).map(([v, l]) => (
                        <button
                          key={v}
                          type="button"
                          aria-pressed={tagLogic === v}
                          onClick={() => setTagLogic(v)}
                          className={`min-h-7 rounded px-2 text-2xs font-semibold transition ${
                            tagLogic === v
                              ? 'bg-white text-ink shadow-sm'
                              : 'text-muted hover:text-ink'
                          }`}
                        >
                          {l}
                        </button>
                      ))}
                    </div>
                    <button
                      type="button"
                      disabled={selectedTags.length === 0}
                      onClick={() => setSelectedTags([])}
                      className="min-h-7 rounded-md px-2 text-2xs font-semibold text-muted hover:bg-paper hover:text-ink disabled:opacity-40"
                    >
                      선택 해제
                    </button>
                  </div>
                }
              />
            </div>
            <IconButton
              icon={showNsfw ? Eye : EyeOff}
              label="민감 프리뷰 표시"
              pressed={showNsfw}
              onClick={() => setShowNsfw((v) => !v)}
              className={`h-9 w-9 border ${showNsfw ? 'border-ink' : 'border-line bg-white'}`}
            />
          </div>
        </div>
        <div className="ml-auto flex items-center gap-3 text-xs text-muted">
          <span className="font-mono text-2xs">
            표시 {items.length} / {total}개
          </span>
        </div>
      </div>

      <DownloadTray downloads={kindDownloads} onCancel={(id) => void cancelDownload(id)} />

      {/* Scrollable Grid Area */}
      <div
        ref={scrollContainerRef}
        onScroll={handleScroll}
        data-ui-audit-scroll-root
        className="min-h-0 flex-1 overflow-y-auto px-4 pb-8 pt-4 sm:px-5 lg:px-6"
      >
        {apiError ? (
          <div className="mb-4 rounded-2xl border border-red-200 bg-red-50 p-4 text-xs text-red-800">
            <p className="font-semibold">모델 관리 확장 응답을 확인해 주세요</p>
            <p className="mt-1">{apiError}</p>
          </div>
        ) : null}

        {loading ? (
          <div className="flex min-h-64 items-center justify-center">
            <Spinner />
          </div>
        ) : items.length === 0 ? (
          <Empty
            icon={Box}
            title="조건에 맞는 모델이 없습니다"
            description="검색어와 태그 필터를 초기화하거나 CivitAI 다운로드로 새 모델을 추가해 보세요"
          >
            <button
              type="button"
              onClick={() => {
                setSearch('');
                setFolder('all');
                setSelectedTags([]);
                setStatus('all');
              }}
              className="btn-primary"
            >
              필터 초기화
            </button>
          </Empty>
        ) : (
          <div
            data-ui-audit-card-group
            className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
          >
            {items.map((item) => {
              const previewSrc = modelPreviewUrl(connection.base, item.preview_url);
              const videoPreview = isVideoPreview(previewSrc);
              const comfyName = resolveComfyModelName(item, info);
              const specialized =
                isSpecializedModelPath(comfyName) || isSpecializedModelPath(item.file_path);
              const inferredFamily =
                assetFamily('model', comfyName, familyAssignments) ||
                inferFamilyFromModelItem(item);
              const familyLabel = inferredFamily
                ? families.find((f) => f.id === inferredFamily)?.label || inferredFamily
                : specialized
                  ? '전용 워크플로'
                  : '미분류';
              const subTypeLabel = formatModelSubType(item);
              const isSelected =
                !settings.workflow &&
                settings.model.replaceAll('\\', '/').toLowerCase() ===
                  comfyName.replaceAll('\\', '/').toLowerCase();
              const blurred = item.preview_nsfw_level >= 4 && !showNsfw;

              return (
                <article
                  key={item.file_path}
                  data-ui-audit-card
                  data-ui-audit-card-type="model-card"
                  className="flex h-full min-w-0 flex-col justify-between overflow-hidden rounded-2xl border border-line bg-white p-4"
                >
                  <div>
                    {/* Preview Image Box */}
                    <div
                      onClick={() => openDetail(item)}
                      className="relative mb-3 aspect-[4/3] w-full cursor-pointer overflow-hidden rounded-xl bg-stone"
                    >
                      {previewSrc ? (
                        videoPreview ? (
                          <video
                            src={previewSrc}
                            muted
                            loop
                            playsInline
                            autoPlay
                            className={`h-full w-full object-contain ${blurred ? 'blur-xl' : ''}`}
                          />
                        ) : (
                          <img
                            src={previewSrc}
                            alt={item.model_name || item.file_name}
                            loading="lazy"
                            className={`h-full w-full object-contain ${blurred ? 'blur-xl' : ''}`}
                          />
                        )
                      ) : (
                        <div className="flex h-full w-full flex-col items-center justify-center gap-2 text-muted">
                          <Box size={24} />
                          <span className="text-xs">프리뷰 없음</span>
                        </div>
                      )}

                      <div className="absolute left-2.5 top-2.5 flex flex-wrap items-center gap-1">
                        <span className="rounded-md bg-ink/80 px-2 py-0.5 text-2xs font-semibold text-white">
                          {item.base_model && item.base_model !== 'Unknown'
                            ? item.base_model
                            : familyLabel}
                        </span>
                        <span className="rounded-md bg-white/90 px-2 py-0.5 text-2xs font-semibold text-ink">
                          {subTypeLabel}
                        </span>
                        {item.update_available ? (
                          <span className="rounded-md bg-lime px-2 py-0.5 text-2xs font-bold text-ink">
                            업데이트
                          </span>
                        ) : null}
                      </div>

                      <button
                        type="button"
                        aria-label={`${item.model_name || item.file_name} 즐겨찾기`}
                        onClick={(e) => {
                          e.stopPropagation();
                          void handleToggleFavorite(item);
                        }}
                        className="absolute right-2.5 top-2.5 flex h-8 w-8 items-center justify-center rounded-full bg-white/90 text-ink shadow-sm transition hover:bg-white"
                      >
                        <Heart
                          size={15}
                          className={item.favorite ? 'fill-red-600 text-red-600' : 'text-ink/70'}
                        />
                      </button>
                    </div>

                    {/* Title & Subtitle */}
                    <button
                      type="button"
                      onClick={() => openDetail(item)}
                      className="w-full text-left"
                    >
                      <h2 className="line-clamp-1 text-sm font-bold text-ink [overflow-wrap:anywhere]">
                        {item.model_name || item.file_name}
                      </h2>
                      <p className="mt-1 truncate font-mono text-2xs text-muted">
                        {item.folder ? `${item.folder}/${item.file_name}` : item.file_name}
                      </p>
                    </button>

                    <div className="mt-2.5 flex flex-wrap gap-1.5">
                      <span className="chip">{familyLabel}</span>
                      {item.quantization ? (
                        <span className="chip font-mono">{item.quantization}</span>
                      ) : null}
                      <span className="chip font-mono">{formatBytes(item.file_size)}</span>
                    </div>

                    <p className="mt-2 line-clamp-1 text-xs text-muted">
                      {item.notes
                        ? item.notes.replace(/\.+$/, '')
                        : item.tags.length > 0
                          ? item.tags.map((t) => `#${t}`).join(' ')
                          : '등록된 메모 없음'}
                    </p>
                  </div>

                  {/* Card Footer */}
                  <div data-ui-audit-row className="mt-4 flex items-center justify-between gap-2">
                    <button
                      type="button"
                      disabled={specialized}
                      onClick={() => applyModelToGeneration(item, false)}
                      className={
                        isSelected || specialized ? 'btn-secondary flex-1' : 'btn-primary flex-1'
                      }
                    >
                      {isSelected ? <Check size={15} /> : <Plus size={15} />}
                      <span>
                        {specialized ? '전용 워크플로' : isSelected ? '선택됨' : '생성 적용'}
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => openDetail(item)}
                      className="btn-secondary"
                    >
                      상세
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        )}

        {/* Infinite Scroll Progress and End Status */}
        {loadingMore && (
          <div className="flex items-center justify-center gap-2 py-4 text-xs text-muted">
            <Spinner />
            <span>추가 모델 불러오는 중</span>
          </div>
        )}
      </div>

      {/* Model Detail & Management Modal */}
      <Modal
        title={activeModel ? activeModel.model_name || activeModel.file_name : '모델 상세 관리'}
        open={Boolean(activeModel)}
        size="lg"
        onClose={() => setActiveModel(null)}
        footer={
          activeModel ? (
            <>
              <button
                type="button"
                onClick={() => setDeleteTarget(activeModel)}
                className="btn-danger"
              >
                <Trash2 size={15} />
                삭제
              </button>
              <button
                type="button"
                disabled={savingDetail}
                onClick={handleSaveDetail}
                className="btn-secondary"
              >
                메타데이터 저장
              </button>
              <button
                type="button"
                disabled={isSpecializedModelPath(activeModel.file_path)}
                onClick={() => applyModelToGeneration(activeModel, true)}
                className="btn-primary"
              >
                <Wand2 size={15} />
                적용 후 생성 화면으로
              </button>
            </>
          ) : undefined
        }
      >
        {activeModel ? (
          <div className="flex flex-col gap-5">
            <DetailExamples
              kind="checkpoints"
              item={activeModel}
              showNsfw={showNsfw}
              revision={examplesRevision}
              onPreviewChanged={handlePreviewChanged}
            />
            {/* Top Summary */}
            <div className="flex flex-col gap-3 rounded-xl bg-paper p-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="chip font-semibold text-ink">
                  {activeModel.base_model || 'Unknown'}
                </span>
                <span className="chip">{formatModelSubType(activeModel)}</span>
                {activeModel.quantization ? (
                  <span className="chip font-mono">{activeModel.quantization}</span>
                ) : null}
                <span className="chip font-mono">{formatBytes(activeModel.file_size)}</span>
                {activeModel.civitai?.modelId ? (
                  <a
                    href={`https://civitai.com/models/${activeModel.civitai.modelId}${
                      activeModel.civitai.id ? `?modelVersionId=${activeModel.civitai.id}` : ''
                    }`}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 rounded-md bg-white px-2.5 py-1 text-xs font-semibold text-olive"
                  >
                    CivitAI #{activeModel.civitai.modelId}
                    <ExternalLink size={12} />
                  </a>
                ) : null}
              </div>

              <p className="font-mono text-xs text-muted [overflow-wrap:anywhere]">
                {activeModel.file_path}
              </p>
            </div>

            {/* Metadata Form */}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label className="flex flex-col gap-1.5 text-xs font-semibold">
                표시 이름
                <input
                  type="text"
                  aria-label="표시 이름"
                  value={editModelName}
                  onChange={(e) => setEditModelName(e.target.value)}
                  className="field"
                />
              </label>
              <label className="flex flex-col gap-1.5 text-xs font-semibold">
                베이스 모델
                <input
                  type="text"
                  aria-label="베이스 모델"
                  value={editBaseModel}
                  onChange={(e) => setEditBaseModel(e.target.value)}
                  placeholder="예: Flux.1 D, Krea2, MOSS, Qwen"
                  className="field"
                />
              </label>
              <label className="flex flex-col gap-1.5 text-xs font-semibold sm:col-span-2">
                생성 계열 분류
                <SelectControl
                  aria-label="생성 계열 분류"
                  value={editFamily}
                  onChange={(e) => setEditFamily(e.target.value as ModelFamily)}
                >
                  <option value="">자동 추론 사용</option>
                  {families.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.label}
                    </option>
                  ))}
                </SelectControl>
              </label>
              <label className="flex flex-col gap-1.5 text-xs font-semibold sm:col-span-2">
                사용 메모
                <textarea
                  rows={2}
                  aria-label="사용 메모"
                  value={editNotes}
                  onChange={(e) => setEditNotes(e.target.value)}
                  placeholder="권장 샘플러나 해상도 메모"
                  className="field min-h-16"
                />
              </label>
            </div>

            {/* Tag management */}
            <div className="flex flex-col gap-2 rounded-xl bg-paper p-4">
              <span className="text-xs font-semibold">태그 관리</span>
              <div className="flex flex-wrap gap-1.5">
                {(activeModel.tags || []).length > 0 ? (
                  (activeModel.tags || []).map((t) => (
                    <span
                      key={t}
                      className="chip inline-flex items-center gap-1 bg-white px-2 py-1 text-xs"
                    >
                      #{t}
                      <button
                        type="button"
                        aria-label={`${t} 태그 삭제`}
                        onClick={() => handleRemoveTag(t)}
                        className="text-muted hover:text-red-700"
                      >
                        <X size={12} />
                      </button>
                    </span>
                  ))
                ) : (
                  <span className="text-xs text-muted">등록된 태그가 없습니다</span>
                )}
              </div>
              <div className="flex gap-2">
                <input
                  type="text"
                  aria-label="추가할 태그 입력"
                  value={editTagInput}
                  onChange={(e) => setEditTagInput(e.target.value)}
                  placeholder="새 태그 입력 (쉼표 구분)"
                  className="field flex-1"
                />
                <button type="button" onClick={handleAddTag} className="btn-secondary">
                  태그 추가
                </button>
              </div>
            </div>

            {/* CivitAI Sync & Versions */}
            <div className="flex flex-col gap-3 rounded-xl bg-paper p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs font-semibold">CivitAI 동기화 및 버전 업데이트</span>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={savingDetail}
                    onClick={handleSyncCivitaiSingle}
                    className="btn-secondary"
                  >
                    <RefreshCw size={14} />
                    메타데이터 동기화
                  </button>
                  {activeModel.civitai?.modelId ? (
                    <button
                      type="button"
                      disabled={loadingVersions}
                      onClick={() => handleLoadRemoteVersions(activeModel.civitai?.modelId)}
                      className="btn-primary"
                    >
                      <CloudDownload size={14} />
                      {loadingVersions ? '조회 중' : '원격 버전 조회'}
                    </button>
                  ) : null}
                </div>
              </div>

              <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                <input
                  type="text"
                  aria-label="CivitAI 모델 ID"
                  value={relinkModelId}
                  onChange={(e) => setRelinkModelId(e.target.value)}
                  placeholder="모델 ID (예: 705606)"
                  className="field"
                />
                <input
                  type="text"
                  aria-label="CivitAI 버전 ID"
                  value={relinkVersionId}
                  onChange={(e) => setRelinkVersionId(e.target.value)}
                  placeholder="버전 ID (선택)"
                  className="field"
                />
                <button
                  type="button"
                  disabled={savingDetail}
                  onClick={handleRelinkCivitai}
                  className="btn-secondary"
                >
                  CivitAI ID 재연결
                </button>
              </div>

              {remoteVersions.length > 0 ? (
                <div className="flex flex-col gap-2 border-t border-line pt-3">
                  {remoteVersions.map((ver) => (
                    <div
                      key={ver.id}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line bg-white p-3 text-xs"
                    >
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-bold">{ver.name}</span>
                          <span className="chip">{ver.baseModel || 'Model'}</span>
                          <span className="chip">{ver.existsLocally ? '설치됨' : '미설치'}</span>
                        </div>
                        {ver.modelSizeKB ? (
                          <p className="mt-1 font-mono text-2xs text-muted">
                            버전 #{ver.id} | {formatBytes(ver.modelSizeKB * 1024)}
                          </p>
                        ) : null}
                      </div>
                      {!ver.existsLocally ? (
                        <button
                          type="button"
                          disabled={isDownloadingVersion(ver.id)}
                          onClick={() =>
                            handleStartDownload({
                              modelId: ver.modelId || activeModel.civitai?.modelId,
                              modelVersionId: ver.id,
                              folderOverride: activeModel.folder,
                            })
                          }
                          className="btn-primary"
                        >
                          <CloudDownload size={14} />이 버전 설치
                        </button>
                      ) : null}
                    </div>
                  ))}
                </div>
              ) : null}
            </div>

            {/* File Rename & Move */}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="flex flex-col gap-2 rounded-xl bg-paper p-4">
                <span className="text-xs font-semibold">파일명 변경</span>
                <div className="flex gap-2">
                  <input
                    type="text"
                    aria-label="새 파일명"
                    value={editRenameInput}
                    onChange={(e) => setEditRenameInput(e.target.value)}
                    className="field flex-1 font-mono"
                  />
                  <button
                    type="button"
                    disabled={savingDetail}
                    onClick={handleRenameModel}
                    className="btn-secondary"
                  >
                    변경
                  </button>
                </div>
              </div>

              <div className="flex flex-col gap-2 rounded-xl bg-paper p-4">
                <span className="text-xs font-semibold">폴더 이동</span>
                <div className="flex gap-2">
                  <div className="flex-1">
                    <SelectControl
                      aria-label="이동할 폴더"
                      value={editMoveFolder}
                      onChange={(e) => setEditMoveFolder(e.target.value)}
                    >
                      <option value="">루트 폴더</option>
                      {folders.map((f) => (
                        <option key={f} value={f}>
                          {f}
                        </option>
                      ))}
                    </SelectControl>
                  </div>
                  <button
                    type="button"
                    disabled={savingDetail}
                    onClick={handleMoveModel}
                    className="btn-secondary"
                  >
                    <FolderInput size={15} />
                    이동
                  </button>
                </div>
              </div>
            </div>
          </div>
        ) : null}
      </Modal>

      {/* Delete Confirmation Modal */}
      <Modal
        title="모델 파일을 삭제할까요?"
        open={Boolean(deleteTarget)}
        onClose={() => setDeleteTarget(null)}
        footer={
          <>
            <button type="button" className="btn-secondary" onClick={() => setDeleteTarget(null)}>
              유지하기
            </button>
            <button type="button" className="btn-danger" onClick={handleConfirmDelete}>
              삭제
            </button>
          </>
        }
      >
        <p className="text-xs leading-relaxed text-muted">
          <strong>{deleteTarget?.model_name || deleteTarget?.file_name}</strong> 파일과 메타데이터를
          삭제합니다
        </p>
      </Modal>

      {/* CivitAI Download Modal */}
      <Modal
        title="CivitAI 모델 다운로드"
        open={downloadModalOpen}
        onClose={() => {
          setDownloadModalOpen(false);
        }}
        footer={
          <>
            <button
              type="button"
              onClick={() => setDownloadModalOpen(false)}
              className="btn-secondary"
            >
              닫기
            </button>
            <button
              type="button"
              disabled={!selectedLookupVersion || isDownloadingVersion(selectedLookupVersion.id)}
              onClick={() => handleStartDownload()}
              className="btn-primary"
            >
              <CloudDownload size={16} />
              {isDownloadingVersion(selectedLookupVersion?.id)
                ? '다운로드 진행 중'
                : '선택 버전 다운로드'}
            </button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <label htmlFor="civitai-air" className="text-xs font-semibold">
              CivitAI AIR 코드
            </label>
            <div data-ui-audit-row className="flex items-center gap-2">
              <input
                id="civitai-air"
                type="text"
                autoComplete="off"
                spellCheck={false}
                enterKeyHint="search"
                aria-label="CivitAI AIR 코드"
                value={civitaiQuery}
                onChange={(e) => setCivitaiQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void handleLookupCivitai();
                }}
                placeholder="urn:air:flux1:checkpoint:civitai:705606@992100"
                className="field min-w-0 flex-1 font-mono"
              />
              <button
                type="button"
                disabled={lookupLoading}
                onClick={handleLookupCivitai}
                className="btn-secondary shrink-0"
              >
                {lookupLoading ? <Spinner /> : 'CivitAI 조회'}
              </button>
            </div>
            <p className="text-2xs leading-relaxed text-muted">
              CivitAI 모델 페이지의 AIR 항목을 복사해 붙여 넣으면 되고, 버전(@숫자)이 있으면 그
              버전을 먼저 선택해요
            </p>
            {lookupAir?.fileId && selectedLookupVersion?.id === lookupAir.modelVersionId && (
              <p className="text-2xs font-semibold text-olive">
                AIR에 지정된 파일로 받아요:{' '}
                {selectedLookupVersion.files?.find((f) => f.id === lookupAir.fileId)?.name ||
                  `파일 #${lookupAir.fileId}`}
              </p>
            )}
          </div>

          {selectedLookupVersion ? (
            <div className="flex flex-col gap-4 rounded-xl bg-paper p-4">
              <div className="flex flex-col gap-3">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-sm font-bold">
                    {selectedLookupVersion.model?.name || selectedLookupVersion.name}
                  </h3>
                  <span className="chip">{selectedLookupVersion.baseModel || 'Model'}</span>
                  {selectedLookupVersion.existsLocally ? (
                    <span className="chip font-semibold text-olive">이미 설치됨</span>
                  ) : null}
                </div>

                <label className="flex flex-col gap-1.5 text-xs font-semibold">
                  버전 선택
                  <SelectControl
                    aria-label="다운로드할 버전 선택"
                    value={String(selectedLookupVersion.id)}
                    onChange={(e) => setSelectedVersionId(Number(e.target.value))}
                  >
                    {lookupVersions.map((ver) => (
                      <option key={ver.id} value={String(ver.id)}>
                        {ver.name} ({ver.baseModel || 'Model'})
                        {ver.existsLocally ? ' [설치됨]' : ''}
                      </option>
                    ))}
                  </SelectControl>
                </label>

                {roots.length > 1 ? (
                  <label className="flex flex-col gap-1.5 text-xs font-semibold">
                    루트 경로
                    <SelectControl
                      aria-label="루트 경로 선택"
                      value={targetRoot || roots[0]}
                      onChange={(e) => setTargetRoot(e.target.value)}
                    >
                      {roots.map((r) => (
                        <option key={r} value={r}>
                          {r}
                        </option>
                      ))}
                    </SelectControl>
                  </label>
                ) : null}

                <label className="flex flex-col gap-1.5 text-xs font-semibold">
                  저장 폴더
                  <SelectControl
                    aria-label="저장 폴더 선택"
                    value={targetFolder}
                    onChange={(e) => setTargetFolder(e.target.value)}
                  >
                    <option value="auto">기본 경로 자동 분류 (권장)</option>
                    <option value="">루트 폴더 직접 저장</option>
                    {folders.map((f) => (
                      <option key={f} value={f}>
                        {f}
                      </option>
                    ))}
                    <option value="custom">새 하위 폴더 직접 입력</option>
                  </SelectControl>
                </label>

                {targetFolder === 'custom' ? (
                  <label className="flex flex-col gap-1.5 text-xs font-semibold">
                    새 하위 폴더 경로
                    <input
                      type="text"
                      aria-label="새 하위 폴더 경로"
                      value={customSubfolder}
                      onChange={(e) => setCustomSubfolder(e.target.value)}
                      placeholder="예: Flux1.D"
                      className="field"
                    />
                  </label>
                ) : null}
              </div>
            </div>
          ) : (
            <p className="rounded-xl bg-paper p-4 text-xs leading-relaxed text-muted">
              AIR 코드를 입력하고 조회를 누르면 버전 목록과 파일 크기를 확인할 수 있어요
            </p>
          )}
        </div>
      </Modal>
    </div>
  );
}
