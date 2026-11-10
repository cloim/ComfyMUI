import { useEffect, useMemo, useRef, useState, type UIEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Check,
  CloudDownload,
  Copy,
  ExternalLink,
  Eye,
  EyeOff,
  FolderInput,
  Heart,
  Layers2,
  Plus,
  RefreshCw,
  ScanSearch,
  Search,
  Trash2,
  Wand2,
  X,
} from 'lucide-react';
import { useStudio } from '../studio';
import { options } from '../domain';
import { assetFamily, type ModelFamily } from '../models';
import {
  DEMO_LORAS,
  addLoraTags,
  appendTriggerWords,
  deleteLoraFile,
  fetchCivitaiModelVersions,
  fetchCivitaiVersionById,
  fetchLoraCivitaiMetadata,
  fetchLoraFolders,
  fetchLoraList,
  fetchLoraRoots,
  fetchLoraTopTags,
  formatBytes,
  inferFamilyFromLoraItem,
  isVideoPreview,
  loraPreviewUrl,
  moveLoraFile,
  civitaiAirProblem,
  parseCivitaiAir,
  parseUsageTips,
  refreshLoraUpdates,
  relinkLoraCivitai,
  renameLoraFile,
  resolveComfyLoraName,
  saveLoraMetadata,
  scanLoras,
  serializeUsageTips,
  type CivitaiAir,
  type CivitaiVersion,
  type LoraItem,
} from '../lora-manager';
import {
  Empty,
  IconButton,
  Modal,
  MultiSelect,
  SelectControl,
  Spinner,
} from '../components/ui';
import { DetailExamples } from '../components/ExampleGallery';
import { HeaderActionButton, HeaderActions } from '../components/HeaderActions';
import { DownloadTray } from '../components/DownloadTray';

export default function Loras() {
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
  } = useStudio();
  const navigate = useNavigate();

  const [items, setItems] = useState<LoraItem[]>(connection.preview ? DEMO_LORAS : []);
  const [total, setTotal] = useState<number>(connection.preview ? DEMO_LORAS.length : 0);
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
  const [folders, setFolders] = useState<string[]>([
    'Flux1.D/commons',
    'Flux1.D/illust',
    'Krea2',
    'Qwen',
  ]);
  const [roots, setRoots] = useState<string[]>(['E:/ComfyUI/models/loras']);
  const [topTags, setTopTags] = useState<{ tag: string; count: number }[]>([
    { tag: 'concept', count: 25 },
    { tag: 'portrait', count: 15 },
    { tag: 'style', count: 12 },
    { tag: 'detail', count: 10 },
    { tag: 'editorial', count: 6 },
    { tag: 'photorealistic', count: 7 },
  ]);

  // Detail modal state
  const [activeLora, setActiveLora] = useState<LoraItem | null>(null);
  const [examplesRevision, setExamplesRevision] = useState(0);
  // A new default image replaces the card preview without reloading the list.
  function handlePreviewChanged(filePath: string, previewUrl: string, nsfwLevel: number) {
    const patch = (x: LoraItem) =>
      x.file_path === filePath ? { ...x, preview_url: previewUrl, preview_nsfw_level: nsfwLevel } : x;
    setItems((prev) => prev.map(patch));
    setActiveLora((prev) => (prev ? patch(prev) : prev));
  }
  const [editModelName, setEditModelName] = useState('');
  const [editBaseModel, setEditBaseModel] = useState('');
  const [editStrength, setEditStrength] = useState('0.8');
  const [editClipStrength, setEditClipStrength] = useState('0.8');
  const [editTrainedWords, setEditTrainedWords] = useState('');
  const [editNotes, setEditNotes] = useState('');
  const [editTagInput, setEditTagInput] = useState('');
  const [editRenameInput, setEditRenameInput] = useState('');
  const [editMoveFolder, setEditMoveFolder] = useState('');
  const [relinkModelId, setRelinkModelId] = useState('');
  const [relinkVersionId, setRelinkVersionId] = useState('');
  const [remoteVersions, setRemoteVersions] = useState<CivitaiVersion[]>([]);
  const [loadingVersions, setLoadingVersions] = useState(false);
  const [savingDetail, setSavingDetail] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<LoraItem | null>(null);

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

  const comfyLoraNames = useMemo(() => {
    const names = options(info, 'LoraLoaderModelOnly', 'lora_name').concat(
      options(info, 'LoraLoader', 'lora_name'),
    );
    return [...new Set(names)];
  }, [info]);

  useEffect(() => {
    const t = setTimeout(() => {
      setDebouncedSearch(search);
    }, 220);
    return () => clearTimeout(t);
  }, [search]);

  async function loadFacets() {
    if (connection.preview) {
      setFolders(['Flux1.D/commons', 'Flux1.D/illust', 'Krea2', 'Qwen']);
      setRoots(['E:/ComfyUI/models/loras']);
      setTopTags([
        { tag: 'portrait', count: 2 },
        { tag: 'detail', count: 2 },
        { tag: 'style', count: 2 },
        { tag: 'concept', count: 1 },
        { tag: 'editorial', count: 1 },
        { tag: 'photorealistic', count: 1 },
      ]);
      return;
    }
    try {
      const [fList, rList, tList] = await Promise.all([
        fetchLoraFolders(connection.base).catch(() => []),
        fetchLoraRoots(connection.base).catch(() => []),
        fetchLoraTopTags(connection.base, 150).catch(() => []),
      ]);
      if (fList.length) setFolders(fList);
      if (rList.length) {
        setRoots(rList);
        setTargetRoot((prev) => prev || rList[0]);
      }
      if (tList.length) setTopTags(tList);
    } catch {
      /* Facets are optional */
    }
  }

  async function loadLoras(targetPage = 1, append = false) {
    if (connection.preview) {
      setApiError('');
      let filtered = [...DEMO_LORAS];
      if (debouncedSearch.trim()) {
        const q = debouncedSearch.trim().toLowerCase();
        filtered = filtered.filter(
          (item) =>
            item.model_name.toLowerCase().includes(q) ||
            item.file_name.toLowerCase().includes(q) ||
            item.tags.some((t) => t.toLowerCase().includes(q)) ||
            (item.civitai?.trainedWords || []).some((w) => w.toLowerCase().includes(q)),
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
      const res = await fetchLoraList(connection.base, {
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

  // Reload from page 1 when any filter changes
  useEffect(() => {
    void loadLoras(1, false);
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
    void loadLoras(1, false);
  }, [libraryRevision]);

  const kindDownloads = downloads.filter((d) => d.kind === 'lora' && d.base === connection.base);
  const isDownloadingVersion = (versionId?: number) =>
    Boolean(versionId) && kindDownloads.some((d) => d.versionId === versionId);

  const hasMore = items.length < total;

  function handleScroll(e: UIEvent<HTMLDivElement>) {
    if (loading || loadingMore || !hasMore || connection.preview) return;
    const el = e.currentTarget;
    const nearBottom = el.scrollHeight - el.scrollTop <= el.clientHeight + 280;
    if (nearBottom) {
      void loadLoras(page + 1, true);
    }
  }

  function openDetail(item: LoraItem) {
    setActiveLora(item);
    setEditModelName(item.model_name || item.file_name);
    setEditBaseModel(item.base_model || '');
    const tips = parseUsageTips(item.usage_tips);
    setEditStrength(String(tips.strength ?? 0.8));
    setEditClipStrength(String(tips.clipStrength ?? tips.strength ?? 0.8));
    setEditTrainedWords((item.civitai?.trainedWords || []).join(', '));
    setEditNotes(item.notes || '');
    setEditTagInput('');
    setEditRenameInput(item.file_name);
    setEditMoveFolder(item.folder || folders[0] || '');
    setRelinkModelId(item.civitai?.modelId ? String(item.civitai.modelId) : '');
    setRelinkVersionId(item.civitai?.id ? String(item.civitai.id) : '');
    setRemoteVersions([]);
  }

  function ensureLoraCompatibleWithFamily(comfyName: string, item: LoraItem): ModelFamily {
    const inferred = inferFamilyFromLoraItem(item) || settings.architecture;
    const currentAssigned = assetFamily('lora', comfyName, familyAssignments);
    const targetFamily = currentAssigned || inferred;
    if (targetFamily && assetFamily('lora', comfyName, familyAssignments) !== targetFamily) {
      setFamilyAssignments((prev) => ({
        ...prev,
        [`lora:${comfyName}`]: targetFamily,
      }));
    }
    return targetFamily;
  }

  function applyLoraToGeneration(item: LoraItem, navigateAfter = false) {
    const comfyName = resolveComfyLoraName(item, comfyLoraNames);
    const targetFamily = ensureLoraCompatibleWithFamily(comfyName, item);
    if (targetFamily !== settings.architecture) {
      setFamilyAssignments((prev) => ({
        ...prev,
        [`lora:${comfyName}`]: settings.architecture,
      }));
    }

    const tips = parseUsageTips(item.usage_tips);
    const recommendedStrength = tips.strength ?? 0.8;
    const recommendedClip = tips.clipStrength ?? recommendedStrength;
    const trainedWords = item.civitai?.trainedWords || [];

    const alreadyAdded = settings.loras.some((l) => l.name === comfyName);
    setSettings((prev) => {
      const nextLoras = alreadyAdded
        ? prev.loras.map((l) =>
            l.name === comfyName ? { ...l, model: recommendedStrength, clip: recommendedClip } : l,
          )
        : [
            ...prev.loras,
            {
              name: comfyName,
              model: recommendedStrength,
              clip: recommendedClip,
            },
          ];
      const nextPositive =
        trainedWords.length > 0 ? appendTriggerWords(prev.positive, trainedWords) : prev.positive;
      return {
        ...prev,
        loras: nextLoras,
        positive: nextPositive,
      };
    });

    notify(`${item.model_name || item.file_name} LoRA를 강도 ${recommendedStrength}로 적용했어요`);
    if (navigateAfter) {
      setActiveLora(null);
      navigate('/create');
    }
  }

  function handleAddTriggerWords(words: string[]) {
    if (!words.length) return;
    setSettings((prev) => ({
      ...prev,
      positive: appendTriggerWords(prev.positive, words),
    }));
    notify('트리거 워드를 생성 프롬프트에 추가했어요');
  }

  async function handleCopyText(text: string, label: string) {
    try {
      await navigator.clipboard.writeText(text);
      notify(`${label} 내용을 복사했어요`);
    } catch {
      notify('클립보드 복사를 지원하지 않는 환경입니다');
    }
  }

  async function handleToggleFavorite(item: LoraItem) {
    const nextFav = !item.favorite;
    setItems((prev) =>
      prev.map((x) => (x.file_path === item.file_path ? { ...x, favorite: nextFav } : x)),
    );
    if (activeLora?.file_path === item.file_path) {
      setActiveLora((prev) => (prev ? { ...prev, favorite: nextFav } : null));
    }
    if (connection.preview) {
      notify(nextFav ? '즐겨찾기에 등록했어요' : '즐겨찾기에서 해제했어요');
      return;
    }
    try {
      await saveLoraMetadata(connection.base, {
        file_path: item.file_path,
        favorite: nextFav,
      });
      notify(nextFav ? '즐겨찾기에 등록했어요' : '즐겨찾기에서 해제했어요');
    } catch (e) {
      notify((e as Error).message);
      void loadLoras(1, false);
    }
  }

  async function handleScanLoras() {
    if (connection.preview) {
      notify('미리보기 모드에서는 데모 LoRA 목록을 유지해요');
      return;
    }
    setScanning(true);
    try {
      await scanLoras(connection.base, false);
      refreshModels();
      await Promise.all([loadFacets(), loadLoras(1, false)]);
      notify('로컬 LoRA 폴더 스캔과 모델 목록 갱신을 완료했어요');
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setScanning(false);
    }
  }

  async function handleRefreshUpdates() {
    if (connection.preview) {
      notify('미리보기 모드에서 1개의 업데이트 가능 LoRA를 확인했어요');
      return;
    }
    setCheckingUpdates(true);
    try {
      const res = await refreshLoraUpdates(connection.base);
      const updateCount = (res.records || []).filter((r) => r.has_update).length;
      await loadLoras(1, false);
      notify(
        updateCount > 0
          ? `CivitAI 확인 결과 ${updateCount}개 모델의 새 버전이 있어요`
          : '모든 LoRA가 최신 버전 상태예요',
      );
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setCheckingUpdates(false);
    }
  }

  async function handleSaveDetail() {
    if (!activeLora) return;
    const strengthNum = Number(editStrength);
    const clipStrengthNum = Number(editClipStrength);
    const usageTipsJson = serializeUsageTips({
      strength: Number.isFinite(strengthNum) ? strengthNum : 0.8,
      clipStrength: Number.isFinite(clipStrengthNum) ? clipStrengthNum : 0.8,
    });
    const words = editTrainedWords
      .split(',')
      .map((w) => w.trim())
      .filter(Boolean);

    if (connection.preview) {
      const updated: LoraItem = {
        ...activeLora,
        model_name: editModelName.trim() || activeLora.file_name,
        base_model: editBaseModel.trim() || activeLora.base_model,
        usage_tips: usageTipsJson,
        notes: editNotes,
        civitai: {
          ...activeLora.civitai,
          trainedWords: words,
        },
      };
      setItems((prev) => prev.map((x) => (x.file_path === activeLora.file_path ? updated : x)));
      setActiveLora(updated);
      notify('LoRA 메타데이터와 권장 강도를 저장했어요');
      return;
    }

    setSavingDetail(true);
    try {
      await saveLoraMetadata(connection.base, {
        file_path: activeLora.file_path,
        model_name: editModelName.trim() || activeLora.file_name,
        base_model: editBaseModel.trim() || activeLora.base_model,
        usage_tips: usageTipsJson,
        notes: editNotes,
        civitai: { trainedWords: words },
      });
      await loadLoras(1, false);
      setActiveLora((prev) =>
        prev
          ? {
              ...prev,
              model_name: editModelName.trim() || prev.file_name,
              base_model: editBaseModel.trim() || prev.base_model,
              usage_tips: usageTipsJson,
              notes: editNotes,
              civitai: { ...prev.civitai, trainedWords: words },
            }
          : null,
      );
      notify('LoRA 메타데이터와 권장 강도를 저장했어요');
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setSavingDetail(false);
    }
  }

  async function handleAddTag() {
    if (!activeLora || !editTagInput.trim()) return;
    const newTags = editTagInput
      .split(',')
      .map((t) => t.trim().toLowerCase())
      .filter(Boolean);
    if (!newTags.length) return;

    if (connection.preview) {
      const merged = [...new Set([...(activeLora.tags || []), ...newTags])];
      setActiveLora({ ...activeLora, tags: merged });
      setItems((prev) =>
        prev.map((x) => (x.file_path === activeLora.file_path ? { ...x, tags: merged } : x)),
      );
      setEditTagInput('');
      notify('태그를 추가했어요');
      return;
    }

    try {
      const res = await addLoraTags(connection.base, activeLora.file_path, newTags);
      const merged = res.tags || [...new Set([...(activeLora.tags || []), ...newTags])];
      setActiveLora({ ...activeLora, tags: merged });
      setEditTagInput('');
      await loadLoras(page, false);
      void loadFacets();
      notify('태그를 추가했어요');
    } catch (e) {
      notify((e as Error).message);
    }
  }

  async function handleRemoveTag(tagToRemove: string) {
    if (!activeLora) return;
    const remaining = (activeLora.tags || []).filter((t) => t !== tagToRemove);

    if (connection.preview) {
      setActiveLora({ ...activeLora, tags: remaining });
      setItems((prev) =>
        prev.map((x) => (x.file_path === activeLora.file_path ? { ...x, tags: remaining } : x)),
      );
      notify(`#${tagToRemove} 태그를 삭제했어요`);
      return;
    }

    try {
      await saveLoraMetadata(connection.base, {
        file_path: activeLora.file_path,
        tags: remaining,
      });
      setActiveLora({ ...activeLora, tags: remaining });
      setItems((prev) =>
        prev.map((x) => (x.file_path === activeLora.file_path ? { ...x, tags: remaining } : x)),
      );
      void loadFacets();
      notify(`#${tagToRemove} 태그를 삭제했어요`);
    } catch (e) {
      notify((e as Error).message);
    }
  }

  async function handleSyncCivitaiSingle() {
    if (!activeLora) return;
    if (connection.preview) {
      notify('미리보기 모드에서 CivitAI 메타데이터 동기화를 완료했어요');
      return;
    }
    setSavingDetail(true);
    try {
      const res = await fetchLoraCivitaiMetadata(connection.base, activeLora.file_path);
      if (!res.success) throw new Error(res.error || 'CivitAI 정보를 찾을 수 없습니다');
      await loadLoras(1, false);
      setExamplesRevision((n) => n + 1);
      notify('CivitAI 메타데이터와 프리뷰를 동기화했어요');
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setSavingDetail(false);
    }
  }

  async function handleRelinkCivitai() {
    if (!activeLora) return;
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
      await relinkLoraCivitai(connection.base, {
        file_path: activeLora.file_path,
        model_id: mid,
        ...(vid && vid > 0 ? { model_version_id: vid } : {}),
      });
      await loadLoras(1, false);
      setExamplesRevision((n) => n + 1);
      notify(`CivitAI 모델 #${mid}로 재연결했어요`);
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setSavingDetail(false);
    }
  }

  async function handleLoadRemoteVersions(modelId?: number) {
    const mid = modelId || activeLora?.civitai?.modelId;
    if (!mid) {
      notify('연결된 CivitAI 모델 ID가 없습니다');
      return;
    }
    if (connection.preview) {
      setRemoteVersions([
        {
          id: 940211,
          modelId: mid,
          name: 'v1.2 Studio',
          baseModel: 'Flux.1 D',
          existsLocally: true,
          modelSizeKB: 150585,
          trainedWords: ['detailed skin texture', 'soft studio rim light'],
        },
        {
          id: 988500,
          modelId: mid,
          name: 'v2.0 Pro (최신 업데이트)',
          baseModel: 'Flux.1 D',
          existsLocally: false,
          modelSizeKB: 154200,
          trainedWords: ['detailed skin texture', 'studio lighting v2'],
        },
      ]);
      return;
    }
    setLoadingVersions(true);
    try {
      const versions = await fetchCivitaiModelVersions(connection.base, mid);
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

  async function handleRenameLora() {
    if (!activeLora) return;
    const clean = editRenameInput.trim().replace(/\.safetensors$/i, '');
    if (!clean || clean === activeLora.file_name) return;
    if (connection.preview) {
      setActiveLora({ ...activeLora, file_name: clean });
      setItems((prev) =>
        prev.map((x) => (x.file_path === activeLora.file_path ? { ...x, file_name: clean } : x)),
      );
      notify(`파일명을 ${clean}으로 변경했어요`);
      return;
    }
    setSavingDetail(true);
    try {
      await renameLoraFile(connection.base, activeLora.file_path, clean);
      refreshModels();
      await loadLoras(1, false);
      setActiveLora(null);
      notify(`파일명을 ${clean}으로 변경했어요`);
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setSavingDetail(false);
    }
  }

  async function handleMoveLora() {
    if (!activeLora) return;
    const root = roots[0] || 'E:/ComfyUI/models/loras';
    const targetDir = editMoveFolder
      ? `${root.replace(/\/+$/, '')}/${editMoveFolder.replace(/^\/+|\/+$/g, '')}`
      : root.replace(/\/+$/, '');
    if (connection.preview) {
      setActiveLora({ ...activeLora, folder: editMoveFolder });
      setItems((prev) =>
        prev.map((x) =>
          x.file_path === activeLora.file_path ? { ...x, folder: editMoveFolder } : x,
        ),
      );
      notify(`폴더를 ${editMoveFolder || '루트'}로 이동했어요`);
      return;
    }
    setSavingDetail(true);
    try {
      await moveLoraFile(connection.base, activeLora.file_path, targetDir);
      refreshModels();
      await loadLoras(1, false);
      setActiveLora(null);
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
      setActiveLora(null);
      notify('선택한 LoRA를 삭제했어요');
      return;
    }
    try {
      await deleteLoraFile(connection.base, deleteTarget.file_path);
      refreshModels();
      setDeleteTarget(null);
      setActiveLora(null);
      await loadLoras(1, false);
      notify('LoRA 파일을 삭제했어요');
    } catch (e) {
      notify((e as Error).message);
    }
  }

  async function handleLookupCivitai() {
    const problem = civitaiAirProblem(civitaiQuery, 'lora');
    if (problem) {
      notify(problem);
      return;
    }
    const parsed = parseCivitaiAir(civitaiQuery)!;
    setLookupAir(parsed);
    if (connection.preview) {
      const mockVersion: CivitaiVersion = {
        id: parsed.modelVersionId || 988500,
        modelId: parsed.modelId || 840370,
        name: 'v2.0 Studio Realism',
        baseModel: 'Flux.1 D',
        existsLocally: false,
        modelSizeKB: 158400,
        trainedWords: ['studio portrait', 'natural skin texture'],
        model: { name: 'Flux Realism Enhancer v2', type: 'LORA' },
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
        const versions = await fetchCivitaiModelVersions(connection.base, parsed.modelId);
        if (!versions.length) {
          throw new Error('해당 CivitAI 모델의 버전 정보를 찾을 수 없습니다');
        }
        setLookupVersions(versions);
        const preferred =
          (parsed.modelVersionId && versions.find((v) => v.id === parsed.modelVersionId)) ||
          versions[0];
        setSelectedVersionId(preferred.id);
      } else if (parsed.modelVersionId) {
        const single = await fetchCivitaiVersionById(connection.base, parsed.modelVersionId);
        if (single.modelId) {
          const versions = await fetchCivitaiModelVersions(connection.base, single.modelId).catch(
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
      const newItem: LoraItem = {
        model_name: selectedVer?.model?.name || selectedVer?.name || `CivitAI LoRA #${versionId}`,
        file_name: `civitai_${versionId}`,
        preview_url: '/sample.svg',
        preview_nsfw_level: 1,
        base_model: selectedVer?.baseModel || 'Flux.1 D',
        folder:
          opts?.folderOverride ??
          (targetFolder === 'auto'
            ? 'Flux1.D/commons'
            : targetFolder === 'custom'
              ? customSubfolder.trim()
              : targetFolder),
        sha256: String(versionId).padStart(64, '0'),
        file_path: `E:/ComfyUI/models/loras/civitai_${versionId}.safetensors`,
        file_size: (selectedVer?.modelSizeKB || 150000) * 1024,
        modified: Math.floor(Date.now() / 1000),
        tags: ['civitai', 'downloaded'],
        from_civitai: true,
        usage_tips: '{"strength":0.8,"clipStrength":0.8}',
        notes: 'CivitAI에서 다운로드한 LoRA',
        favorite: false,
        update_available: false,
        civitai: {
          id: versionId,
          modelId: modelId || 840370,
          name: selectedVer?.name || 'v1.0',
          trainedWords: selectedVer?.trainedWords || ['studio quality'],
        },
      };
      setItems((prev) => [
        newItem,
        ...prev.map((x) =>
          modelId && x.civitai?.modelId === modelId ? { ...x, update_available: false } : x,
        ),
      ]);
      setDownloadModalOpen(false);
      notify('CivitAI LoRA 다운로드를 완료했어요');
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
      [version?.model?.name || activeLora?.model_name, version?.name].filter(Boolean).join(' ') ||
      `CivitAI #${versionId}`;

    startDownload(
      {
        id: `cm-dl-${Date.now()}`,
        kind: 'lora',
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
          onClick={handleScanLoras}
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
            aria-label="LoRA 검색"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="이름, 파일명, 태그, 트리거 워드 검색"
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
              <option value="all">전체 LoRA</option>
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

      {/* Scrollable Grid Area (Infinite Scroll without pagination buttons) */}
      <div
        ref={scrollContainerRef}
        onScroll={handleScroll}
        data-ui-audit-scroll-root
        className="min-h-0 flex-1 overflow-y-auto px-4 pb-8 pt-4 sm:px-5 lg:px-6"
      >
        {apiError ? (
          <div className="mb-4 rounded-2xl border border-red-200 bg-red-50 p-4 text-xs text-red-800">
            <p className="font-semibold">LoRA Manager 확장 응답을 확인해 주세요</p>
            <p className="mt-1">{apiError}</p>
          </div>
        ) : null}

        {loading ? (
          <div className="flex min-h-64 items-center justify-center">
            <Spinner />
          </div>
        ) : items.length === 0 ? (
          <Empty
            icon={Layers2}
            title="조건에 맞는 LoRA가 없습니다"
            description="검색어와 태그 필터를 초기화하거나 CivitAI 다운로드로 새 LoRA를 추가해 보세요"
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
              const previewSrc = loraPreviewUrl(connection.base, item.preview_url);
              const videoPreview = isVideoPreview(previewSrc);
              const tips = parseUsageTips(item.usage_tips);
              const trainedWords = item.civitai?.trainedWords || [];
              const comfyName = resolveComfyLoraName(item, comfyLoraNames);
              const isApplied = settings.loras.some((l) => l.name === comfyName);
              const blurred = item.preview_nsfw_level >= 4 && !showNsfw;

              return (
                <article
                  key={item.file_path}
                  data-ui-audit-card
                  data-ui-audit-card-type="lora-card"
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
                            className={`h-full w-full object-cover ${blurred ? 'scale-110 blur-xl' : ''}`}
                          />
                        ) : (
                          <img
                            src={previewSrc}
                            alt={item.model_name || item.file_name}
                            loading="lazy"
                            className={`h-full w-full object-cover ${blurred ? 'scale-110 blur-xl' : ''}`}
                          />
                        )
                      ) : (
                        <div className="flex h-full w-full flex-col items-center justify-center gap-2 text-muted">
                          <Layers2 size={24} />
                          <span className="text-xs">프리뷰 없음</span>
                        </div>
                      )}

                      <div className="absolute left-2.5 top-2.5 flex flex-wrap items-center gap-1">
                        <span className="rounded-md bg-ink/80 px-2 py-0.5 text-2xs font-semibold text-white">
                          {item.base_model || 'Unknown'}
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
                      <span className="chip font-mono">강도 {tips.strength ?? 0.8}</span>
                      <span className="chip font-mono">{formatBytes(item.file_size)}</span>
                      {trainedWords.length > 0 ? (
                        <span className="chip">트리거 {trainedWords.length}개</span>
                      ) : null}
                    </div>

                    <p className="mt-2 line-clamp-1 text-xs text-muted">
                      {trainedWords.length > 0
                        ? trainedWords.slice(0, 2).join(', ')
                        : item.notes
                          ? item.notes.replace(/\.+$/, '')
                          : '트리거 워드 없음'}
                    </p>
                  </div>

                  {/* Card Footer */}
                  <div data-ui-audit-row className="mt-4 flex items-center justify-between gap-2">
                    <button
                      type="button"
                      onClick={() => applyLoraToGeneration(item, false)}
                      className={isApplied ? 'btn-secondary flex-1' : 'btn-primary flex-1'}
                    >
                      {isApplied ? <Check size={15} /> : <Plus size={15} />}
                      <span>{isApplied ? '적용됨' : '생성 적용'}</span>
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
            <span>추가 LoRA 불러오는 중</span>
          </div>
        )}

      </div>

      {/* LoRA Detail & Management Modal */}
      <Modal
        title={activeLora ? activeLora.model_name || activeLora.file_name : 'LoRA 상세 관리'}
        open={Boolean(activeLora)}
        size="lg"
        onClose={() => setActiveLora(null)}
        footer={
          activeLora ? (
            <>
              <button
                type="button"
                onClick={() => setDeleteTarget(activeLora)}
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
                onClick={() => applyLoraToGeneration(activeLora, true)}
                className="btn-primary"
              >
                <Wand2 size={15} />
                적용 후 생성 화면으로
              </button>
            </>
          ) : undefined
        }
      >
        {activeLora ? (
          <div className="flex flex-col gap-5">
            <DetailExamples
              kind="loras"
              item={activeLora}
              showNsfw={showNsfw}
              revision={examplesRevision}
              onPreviewChanged={handlePreviewChanged}
            />
            {/* Top Summary */}
            <div className="flex flex-col gap-3 rounded-xl bg-paper p-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="chip font-semibold text-ink">
                  {activeLora.base_model || 'Unknown'}
                </span>
                <span className="chip font-mono">{formatBytes(activeLora.file_size)}</span>
                {activeLora.civitai?.modelId ? (
                  <a
                    href={`https://civitai.com/models/${activeLora.civitai.modelId}${
                      activeLora.civitai.id ? `?modelVersionId=${activeLora.civitai.id}` : ''
                    }`}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 rounded-md bg-white px-2.5 py-1 text-xs font-semibold text-olive"
                  >
                    CivitAI #{activeLora.civitai.modelId}
                    <ExternalLink size={12} />
                  </a>
                ) : null}
              </div>

              <p className="font-mono text-xs text-muted [overflow-wrap:anywhere]">
                {activeLora.file_path}
              </p>

              {/* Trigger Words */}
              <div className="flex flex-col gap-2 border-t border-line pt-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-xs font-semibold">
                    트리거 워드 ({(activeLora.civitai?.trainedWords || []).length}개)
                  </span>
                  {(activeLora.civitai?.trainedWords || []).length > 0 ? (
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() =>
                          handleCopyText(
                            (activeLora.civitai?.trainedWords || []).join(', '),
                            '트리거 워드',
                          )
                        }
                        className="inline-flex items-center gap-1 text-xs font-semibold text-muted hover:text-ink"
                      >
                        <Copy size={13} />
                        복사
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          handleAddTriggerWords(activeLora.civitai?.trainedWords || [])
                        }
                        className="text-xs font-semibold text-olive"
                      >
                        프롬프트에 전체 추가
                      </button>
                    </div>
                  ) : null}
                </div>
                {(activeLora.civitai?.trainedWords || []).length > 0 ? (
                  <div className="flex flex-wrap gap-1.5">
                    {(activeLora.civitai?.trainedWords || []).map((w) => (
                      <button
                        key={w}
                        type="button"
                        onClick={() => handleAddTriggerWords([w])}
                        className="rounded-lg border border-line bg-white px-2.5 py-1 text-xs text-ink hover:bg-stone"
                      >
                        + {w}
                      </button>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-muted">등록된 트리거 워드가 없습니다</p>
                )}
              </div>
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
                  placeholder="예: Flux.1 D, Krea2, Qwen"
                  className="field"
                />
              </label>
              <label className="flex flex-col gap-1.5 text-xs font-semibold">
                권장 모델 강도
                <input
                  type="number"
                  aria-label="권장 모델 강도"
                  step="0.05"
                  min="-2"
                  max="2"
                  value={editStrength}
                  onChange={(e) => setEditStrength(e.target.value)}
                  className="field font-mono"
                />
              </label>
              <label className="flex flex-col gap-1.5 text-xs font-semibold">
                권장 CLIP 강도
                <input
                  type="number"
                  aria-label="권장 CLIP 강도"
                  step="0.05"
                  min="-2"
                  max="2"
                  value={editClipStrength}
                  onChange={(e) => setEditClipStrength(e.target.value)}
                  className="field font-mono"
                />
              </label>
              <label className="flex flex-col gap-1.5 text-xs font-semibold sm:col-span-2">
                트리거 워드 편집 (쉼표 구분)
                <input
                  type="text"
                  aria-label="트리거 워드 편집"
                  value={editTrainedWords}
                  onChange={(e) => setEditTrainedWords(e.target.value)}
                  placeholder="예: studio lighting, detailed skin texture"
                  className="field"
                />
              </label>
              <label className="flex flex-col gap-1.5 text-xs font-semibold sm:col-span-2">
                사용 메모
                <textarea
                  rows={2}
                  aria-label="사용 메모"
                  value={editNotes}
                  onChange={(e) => setEditNotes(e.target.value)}
                  placeholder="권장 샘플러나 조합 메모"
                  className="field min-h-16"
                />
              </label>
            </div>

            {/* Tag management with individual tag deletion */}
            <div className="flex flex-col gap-2 rounded-xl bg-paper p-4">
              <span className="text-xs font-semibold">태그 관리</span>
              <div className="flex flex-wrap gap-1.5">
                {(activeLora.tags || []).length > 0 ? (
                  (activeLora.tags || []).map((t) => (
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
                  {activeLora.civitai?.modelId ? (
                    <button
                      type="button"
                      disabled={loadingVersions}
                      onClick={() => handleLoadRemoteVersions(activeLora.civitai?.modelId)}
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
                  placeholder="모델 ID (예: 840370)"
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
                          <span className="chip">{ver.baseModel || 'LoRA'}</span>
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
                              modelId: ver.modelId || activeLora.civitai?.modelId,
                              modelVersionId: ver.id,
                              folderOverride: activeLora.folder,
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
                    onClick={handleRenameLora}
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
                    onClick={handleMoveLora}
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
        title="LoRA 파일을 삭제할까요?"
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
        title="CivitAI LoRA 다운로드"
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
                placeholder="urn:air:flux1:lora:civitai:840370@940211"
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
                  <span className="chip">{selectedLookupVersion.baseModel || 'LoRA'}</span>
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
                        {ver.name} ({ver.baseModel || 'LoRA'}){ver.existsLocally ? ' [설치됨]' : ''}
                      </option>
                    ))}
                  </SelectControl>
                </label>

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
                      placeholder="예: Flux1.D/character"
                      className="field"
                    />
                  </label>
                ) : null}
              </div>
            </div>
          ) : (
            <p className="rounded-xl bg-paper p-4 text-xs leading-relaxed text-muted">
              AIR 코드를 입력하고 조회를 누르면 버전 목록과 트리거 워드, 파일 크기를 확인할 수
              있어요
            </p>
          )}
        </div>
      </Modal>
    </div>
  );
}
