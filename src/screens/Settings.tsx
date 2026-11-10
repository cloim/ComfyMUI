import { useState, useRef, useId, useEffect, type ReactNode } from 'react';
import {
  Link2,
  Check,
  Wifi,
  Info,
  Smartphone,
  ShieldCheck,
  Bell,
  WandSparkles,
  RotateCcw,
  SlidersHorizontal,
  Plus,
  Trash2,
  Search,
  Pencil,
  ChevronLeft,
  ChevronRight,
  FileText,
  type LucideIcon,
} from 'lucide-react';
import { useStudio } from '../studio';
import {
  DEFAULT_PROMPTS,
  DEFAULT_PROMPT_ASSEMBLE,
  newId,
  parseAttributeList,
  type PromptAssembleElement,
} from '../domain';
import { usePwa } from '../pwa';
import {
  Section,
  Spinner,
  Status,
  FieldError,
  IconButton,
  Modal,
  SortableList,
  X,
} from '../components/ui';

type SettingsCategory = 'connection' | 'prompt' | 'app';

const SETTINGS_TABS: { id: SettingsCategory; label: string; icon: LucideIcon }[] = [
  { id: 'connection', label: '연결 설정', icon: Link2 },
  { id: 'prompt', label: '기본 프롬프트 설정', icon: WandSparkles },
  { id: 'app', label: '앱 및 알림', icon: Smartphone },
];

export default function Settings() {
  const {
    connection,
    connect,
    connectionState,
    connectionError,
    preview,
    info,
    notify,
    socketState,
    online,
    presets,
    jobs,
    notificationsEnabled,
    toggleNotifications,
    defaultPrompts,
    setDefaultPrompts,
    promptAssemble,
    setPromptAssemble,
    setSettings,
  } = useStudio();
  const [activeTab, setActiveTab] = useState<SettingsCategory>(() => {
    const param = new URLSearchParams(window.location.search).get('tab');
    return param === 'prompt' || param === 'app' || param === 'connection' ? param : 'connection';
  });
  const panelId = useId();
  const [base, setBase] = useState(connection.base);
  const [localError, setLocalError] = useState('');
  const [installing, setInstalling] = useState(false);
  const [defaultPositive, setDefaultPositive] = useState(defaultPrompts.positive);
  const [defaultNegative, setDefaultNegative] = useState(defaultPrompts.negative);
  const [newElementName, setNewElementName] = useState('');
  const [addingElement, setAddingElement] = useState(false);
  const [assembleView, setAssembleView] = useState<'list' | 'detail'>('list');
  const [selectedElementId, setSelectedElementId] = useState<string>(
    () => promptAssemble[0]?.id || '',
  );
  const [elementNameDraft, setElementNameDraft] = useState<string>(
    () => promptAssemble[0]?.name || '',
  );
  const [attrDraft, setAttrDraft] = useState('');
  const [attrSearch, setAttrSearch] = useState('');
  const [editingAttr, setEditingAttr] = useState<{ original: string; value: string } | null>(null);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkText, setBulkText] = useState('');
  const [deleteElement, setDeleteElement] = useState<PromptAssembleElement | null>(null);
  const assembleRef = useRef<HTMLDivElement>(null);
  const pwa = usePwa();
  const busy = connectionState === 'connecting';
  const addressInput = useRef<HTMLInputElement>(null);
  const errorMessage = localError || (connectionState === 'error' ? connectionError : '');

  const selectedElementIndex = promptAssemble.findIndex((el) => el.id === selectedElementId);
  const selectedElement =
    (selectedElementIndex >= 0 ? promptAssemble[selectedElementIndex] : promptAssemble[0]) ?? null;
  const attrQuery = attrSearch.trim().toLowerCase();
  const visibleAttrs = selectedElement
    ? selectedElement.attributes.filter((attr) => attr.toLowerCase().includes(attrQuery))
    : [];

  useEffect(() => {
    if (!selectedElement && promptAssemble.length > 0) {
      setSelectedElementId(promptAssemble[0].id);
      return;
    }
    if (selectedElement && selectedElement.id !== selectedElementId) {
      setSelectedElementId(selectedElement.id);
    }
  }, [promptAssemble, selectedElement, selectedElementId]);

  useEffect(() => {
    setElementNameDraft(selectedElement?.name || '');
    setAttrDraft('');
    setAttrSearch('');
    setEditingAttr(null);
    setBulkOpen(false);
  }, [selectedElement?.id]);

  function scrollAssembleIntoView() {
    requestAnimationFrame(() =>
      assembleRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' }),
    );
  }

  function openAssembleElement(id: string) {
    setSelectedElementId(id);
    setAssembleView('detail');
    scrollAssembleIntoView();
  }

  function openAssembleList() {
    setAssembleView('list');
    setEditingAttr(null);
    scrollAssembleIntoView();
  }

  function handlePositiveChange(nextPositive: string) {
    setDefaultPositive(nextPositive);
    setDefaultPrompts((prev) => ({ ...prev, positive: nextPositive }));
  }

  function handleNegativeChange(nextNegative: string) {
    setDefaultNegative(nextNegative);
    setDefaultPrompts((prev) => ({ ...prev, negative: nextNegative }));
  }

  function handleSaveDefaultPrompts() {
    const next = {
      positive: defaultPositive.trim(),
      negative: defaultNegative.trim(),
    };
    setDefaultPositive(next.positive);
    setDefaultNegative(next.negative);
    setDefaultPrompts(next);
    setSettings((prev) => ({
      ...prev,
      positive: next.positive,
      negative: next.negative,
    }));
    notify('기본 프롬프트 설정을 저장했어요');
  }

  function handleResetDefaultPrompts() {
    setDefaultPositive(DEFAULT_PROMPTS.positive);
    setDefaultNegative(DEFAULT_PROMPTS.negative);
    setDefaultPrompts(DEFAULT_PROMPTS);
    setSettings((prev) => ({
      ...prev,
      positive: DEFAULT_PROMPTS.positive,
      negative: DEFAULT_PROMPTS.negative,
    }));
    notify('기본 프롬프트를 초기값으로 복원했어요');
  }

  function handleAddAssembleElement() {
    const name = newElementName.trim();
    if (!name) {
      notify('요소 이름을 입력해 주세요');
      return;
    }
    const createdId = newId();
    setPromptAssemble((prev) => [...prev, { id: createdId, name, attributes: [] }]);
    setNewElementName('');
    setAddingElement(false);
    openAssembleElement(createdId);
    notify(`'${name}' 요소를 추가했어요`);
  }

  function handleRenameAssembleElement(elementId: string) {
    const trimmed = elementNameDraft.trim();
    const current = promptAssemble.find((el) => el.id === elementId)?.name || '';
    if (!trimmed) {
      setElementNameDraft(current);
      notify('요소 이름은 비워 둘 수 없어요');
      return;
    }
    if (trimmed === current) return;
    setPromptAssemble((prev) =>
      prev.map((el) => (el.id === elementId ? { ...el, name: trimmed } : el)),
    );
    notify('요소 이름을 변경했어요');
  }

  function handleReorderElements(ids: string[]) {
    setPromptAssemble((prev) =>
      ids
        .map((id) => prev.find((el) => el.id === id))
        .filter((el): el is PromptAssembleElement => !!el),
    );
  }

  function handleRemoveAssembleElement(id: string, name: string) {
    setPromptAssemble((prev) => prev.filter((el) => el.id !== id));
    notify(`'${name}' 요소를 삭제했어요`);
  }

  function handleAddAssembleAttributes(elementId: string) {
    const parsed = parseAttributeList(attrDraft);
    if (parsed.length === 0) return;
    setPromptAssemble((prev) =>
      prev.map((el) => {
        if (el.id !== elementId) return el;
        const existingLower = new Set(el.attributes.map((a) => a.toLowerCase()));
        const additions = parsed.filter((a) => !existingLower.has(a.toLowerCase()));
        return {
          ...el,
          attributes: [...el.attributes, ...additions],
        };
      }),
    );
    setAttrDraft('');
    notify('속성을 추가했어요');
  }

  function handleUpdateAssembleAttribute(elementId: string, oldAttr: string, nextRaw: string) {
    const nextAttr = nextRaw.trim();
    if (!nextAttr) {
      notify('속성 이름을 입력해 주세요');
      return;
    }
    setPromptAssemble((prev) =>
      prev.map((el) => {
        if (el.id !== elementId) return el;
        const duplicate = el.attributes.some(
          (a) => a !== oldAttr && a.toLowerCase() === nextAttr.toLowerCase(),
        );
        if (duplicate) {
          return {
            ...el,
            attributes: el.attributes.filter((a) => a !== oldAttr),
          };
        }
        return {
          ...el,
          attributes: el.attributes.map((a) => (a === oldAttr ? nextAttr : a)),
        };
      }),
    );
    setEditingAttr(null);
    notify('속성을 수정했어요');
  }

  function handleReorderAttributes(elementId: string, attributes: string[]) {
    setPromptAssemble((prev) =>
      prev.map((el) => (el.id === elementId ? { ...el, attributes } : el)),
    );
  }

  function handleApplyBulkAttributes(elementId: string) {
    const parsed = parseAttributeList(bulkText);
    setPromptAssemble((prev) =>
      prev.map((el) => (el.id === elementId ? { ...el, attributes: parsed } : el)),
    );
    setBulkOpen(false);
    setEditingAttr(null);
    notify(`속성 ${parsed.length}개를 일괄 적용했어요`);
  }

  function handleRemoveAssembleAttribute(elementId: string, attr: string) {
    setPromptAssemble((prev) =>
      prev.map((el) =>
        el.id === elementId ? { ...el, attributes: el.attributes.filter((a) => a !== attr) } : el,
      ),
    );
    if (editingAttr?.original === attr) {
      setEditingAttr(null);
    }
  }

  function handleResetAssemble() {
    setPromptAssemble(DEFAULT_PROMPT_ASSEMBLE);
    setSelectedElementId(DEFAULT_PROMPT_ASSEMBLE[0]?.id || '');
    setEditingAttr(null);
    setAssembleView('list');
    notify('프롬프트 어셈블을 기본값으로 복원했어요');
  }

  function renderAttrRow(el: PromptAssembleElement, attr: string, handle: ReactNode) {
    const editing = editingAttr?.original === attr ? editingAttr : null;
    return (
      <div
        className={`flex min-h-11 items-center gap-1 rounded-lg border bg-white pr-1 ${
          handle ? 'pl-1' : 'pl-3'
        } ${editing ? 'border-olive' : 'border-line'}`}
      >
        {handle}
        {editing ? (
          <form
            className="flex min-w-0 flex-1 items-center gap-1 py-1"
            onSubmit={(e) => {
              e.preventDefault();
              handleUpdateAssembleAttribute(el.id, attr, editing.value);
            }}
          >
            <input
              type="text"
              autoFocus
              enterKeyHint="done"
              aria-label="기존 속성 수정 입력"
              value={editing.value}
              onChange={(e) =>
                setEditingAttr((prev) => (prev ? { ...prev, value: e.target.value } : null))
              }
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  e.stopPropagation();
                  setEditingAttr(null);
                }
              }}
              className="field min-h-8 flex-1 py-1"
            />
            <button
              type="submit"
              aria-label="수정 저장"
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-ink text-lime hover:bg-ink/90"
            >
              <Check size={15} aria-hidden="true" />
            </button>
            <IconButton icon={X} label="수정 취소" onClick={() => setEditingAttr(null)} />
          </form>
        ) : (
          <>
            <button
              type="button"
              aria-label={`${el.name} ${attr} 속성 수정`}
              onClick={() => setEditingAttr({ original: attr, value: attr })}
              className="flex min-h-10 min-w-0 flex-1 items-center gap-2 text-left text-xs text-ink"
            >
              <span className="min-w-0 flex-1 truncate">{attr}</span>
              <Pencil size={12} aria-hidden="true" className="shrink-0 text-muted" />
            </button>
            <IconButton
              icon={Trash2}
              danger
              label={`${el.name} ${attr} 속성 삭제`}
              onClick={() => handleRemoveAssembleAttribute(el.id, attr)}
            />
          </>
        )}
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-4 py-4 sm:px-5 lg:px-6 lg:py-5">
      <div
        role="tablist"
        aria-label="설정 카테고리"
        className="flex gap-1.5 rounded-2xl border border-line bg-white p-1.5"
      >
        {SETTINGS_TABS.map((t, i) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={activeTab === t.id}
            aria-controls={panelId}
            tabIndex={activeTab === t.id ? 0 : -1}
            onClick={() => setActiveTab(t.id)}
            onKeyDown={(e) => {
              const delta = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
              const idx =
                e.key === 'Home'
                  ? 0
                  : e.key === 'End'
                    ? SETTINGS_TABS.length - 1
                    : (i + delta + SETTINGS_TABS.length) % SETTINGS_TABS.length;
              if (!delta && !['Home', 'End'].includes(e.key)) return;
              e.preventDefault();
              setActiveTab(SETTINGS_TABS[idx].id);
              (
                e.currentTarget.parentElement!.querySelectorAll('[role=tab]')[
                  idx
                ] as HTMLButtonElement
              ).focus();
            }}
            className={`flex min-h-9 flex-auto items-center justify-center gap-1.5 whitespace-nowrap rounded-lg px-2.5 py-1.5 text-xs font-semibold transition-colors sm:px-4 ${
              activeTab === t.id ? 'bg-ink text-lime' : 'text-muted hover:bg-paper'
            }`}
          >
            <t.icon size={15} className="hidden shrink-0 sm:inline" />
            <span>{t.label}</span>
          </button>
        ))}
      </div>

      <div
        id={panelId}
        role="tabpanel"
        aria-label={SETTINGS_TABS.find((t) => t.id === activeTab)?.label}
        className="flex flex-col gap-4"
      >
        {activeTab === 'connection' && (
          <>
            <Section
              title="ComfyUI 연결"
              icon={Link2}
              action={
                <div className="-my-1 flex items-center">
                  <Status>
                    <span
                      className={`h-1.5 w-1.5 rounded-full ${connectionState === 'connected' ? 'bg-olive' : connectionState === 'preview' ? 'bg-amber-600' : 'bg-red-600'}`}
                    />
                    {connectionState === 'connected'
                      ? '연결됨'
                      : connectionState === 'preview'
                        ? '미리보기'
                        : busy
                          ? '연결 확인 중'
                          : '연결 확인 필요'}
                  </Status>
                </div>
              }
            >
              <div className="flex flex-col gap-4">
                <p className="text-xs leading-relaxed text-muted">
                  이미지를 생성할 ComfyUI 서버에 연결해 주세요
                </p>
                <label className="flex flex-col gap-2 text-xs font-semibold">
                  서버 주소
                  <input
                    ref={addressInput}
                    aria-invalid={Boolean(errorMessage)}
                    aria-describedby={errorMessage ? 'connection-error' : undefined}
                    type="text"
                    inputMode="url"
                    aria-label="ComfyUI 서버 주소"
                    autoCapitalize="off"
                    autoCorrect="off"
                    spellCheck={false}
                    className="field font-mono"
                    value={base}
                    onChange={(e) => setBase(e.target.value)}
                    placeholder="/comfy 또는 https://example.com"
                  />
                </label>
                <div data-ui-audit-row className="flex flex-wrap gap-2">
                  <button
                    disabled={busy}
                    onClick={() => {
                      try {
                        connect(base);
                        setLocalError('');
                      } catch (e) {
                        setLocalError((e as Error).message);
                      }
                    }}
                    className="btn-primary"
                  >
                    {busy ? <Spinner /> : <Wifi size={16} />}저장하고 연결 확인
                  </button>
                  <button
                    disabled={busy}
                    className="btn-secondary"
                    onClick={() => {
                      preview();
                      setLocalError('');
                      notify('미리보기 모드로 전환했어요');
                    }}
                  >
                    미리보기 모드
                  </button>
                </div>
                <FieldError anchor={addressInput} message={errorMessage} id="connection-error" />
                {connectionState === 'connected' && (
                  <div
                    role="status"
                    className="flex flex-col gap-2 rounded-xl bg-lime/20 p-4 text-xs text-olive"
                  >
                    <p className="flex items-center gap-2 font-semibold">
                      <Check size={16} />
                      서버에 연결했어요
                    </p>
                    <p>
                      {Object.keys(info || {}).length}개 노드 | {socketState}
                    </p>
                  </div>
                )}
                <div className="flex items-start gap-3 rounded-xl bg-paper p-4">
                  <Info size={17} className="mt-0.5 shrink-0 text-muted" />
                  <p className="text-xs leading-relaxed text-muted">
                    <strong className="text-ink">같은 서버 연결</strong>에는 기본값{' '}
                    <code>/comfy</code>를 사용하세요
                    <br />
                    앱 서버가 ComfyUI로 요청을 전달해요
                    <br />
                    <br />
                    직접 주소를 쓸 때는 같은 네트워크와 CORS 허용이 필요해요
                    <br />
                    HTTPS 앱에는 HTTPS 서버 주소를 사용하세요
                  </p>
                </div>
              </div>
            </Section>
          </>
        )}

        {activeTab === 'prompt' && (
          <>
            <Section
              title="기본 프롬프트 설정"
              icon={WandSparkles}
              action={
                <span className="font-mono text-2xs text-muted">{defaultPositive.length}자</span>
              }
            >
              <div className="flex flex-col gap-4">
                <p className="text-xs leading-relaxed text-muted">
                  새 작업을 시작하거나 기본값을 불러올 때 사용할 포지티브와 네거티브 프롬프트를
                  설정해 주세요
                </p>
                <label className="flex flex-col gap-2 text-xs font-semibold">
                  기본 포지티브 프롬프트
                  <textarea
                    aria-label="기본 포지티브 프롬프트"
                    className="field min-h-36 resize-y leading-7 font-normal"
                    value={defaultPositive}
                    onChange={(e) => handlePositiveChange(e.target.value)}
                    placeholder="기본으로 사용할 포지티브 프롬프트를 입력해 주세요"
                  />
                </label>
                <label className="flex flex-col gap-2 text-xs font-semibold">
                  기본 네거티브 프롬프트
                  <textarea
                    aria-label="기본 네거티브 프롬프트"
                    className="field min-h-24 resize-y text-xs leading-6 font-normal"
                    value={defaultNegative}
                    onChange={(e) => handleNegativeChange(e.target.value)}
                    placeholder="기본으로 제외할 네거티브 프롬프트를 입력해 주세요"
                  />
                </label>
                <div data-ui-audit-row className="flex flex-wrap gap-2">
                  <button type="button" className="btn-primary" onClick={handleSaveDefaultPrompts}>
                    <Check size={16} />
                    기본 프롬프트 저장
                  </button>
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={handleResetDefaultPrompts}
                  >
                    <RotateCcw size={16} />
                    초기값 복원
                  </button>
                </div>
                <p className="text-xs leading-relaxed text-muted">
                  저장하면 현재 만들기 화면의 프롬프트에도 기본 프롬프트가 바로 반영돼요
                </p>
              </div>
            </Section>

            <div ref={assembleRef} className="scroll-mt-4">
              <Section
                title="프롬프트 어셈블"
                icon={SlidersHorizontal}
                action={
                  assembleView === 'list' ? (
                    <button
                      type="button"
                      onClick={handleResetAssemble}
                      className="inline-flex min-h-8 items-center gap-1 rounded-lg px-2 text-xs font-medium text-muted hover:bg-paper hover:text-ink"
                    >
                      <RotateCcw size={13} />
                      <span className="whitespace-nowrap">기본값 복원</span>
                    </button>
                  ) : undefined
                }
              >
                {assembleView === 'detail' && selectedElement ? (
                  <div className="flex flex-col gap-3">
                    <div className="flex items-center justify-between gap-2">
                      <button
                        type="button"
                        onClick={() => openAssembleList()}
                        className="-ml-2 inline-flex min-h-9 items-center gap-0.5 rounded-lg px-2 text-xs font-semibold text-muted hover:bg-paper hover:text-ink"
                      >
                        <ChevronLeft size={16} aria-hidden="true" />
                        요소 목록
                      </button>
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          className="btn-secondary"
                          onClick={() => {
                            setBulkText(selectedElement.attributes.join(', '));
                            setEditingAttr(null);
                            setBulkOpen(true);
                          }}
                        >
                          <FileText size={14} aria-hidden="true" />
                          일괄 편집
                        </button>
                        <IconButton
                          icon={Trash2}
                          danger
                          className="!h-9 !w-9"
                          label={`${selectedElement.name} 요소 삭제`}
                          onClick={() => setDeleteElement(selectedElement)}
                        />
                      </div>
                    </div>

                    <label className="flex flex-col gap-1.5 text-xs font-semibold text-ink/80">
                      요소 이름
                      <input
                        type="text"
                        aria-label="선택 요소 이름"
                        value={elementNameDraft}
                        onChange={(e) => setElementNameDraft(e.target.value)}
                        onBlur={() => handleRenameAssembleElement(selectedElement.id)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') e.currentTarget.blur();
                        }}
                        className="field font-semibold text-ink"
                      />
                    </label>

                    <form
                      data-ui-audit-row
                      className="flex items-center gap-2"
                      onSubmit={(e) => {
                        e.preventDefault();
                        handleAddAssembleAttributes(selectedElement.id);
                      }}
                    >
                      <input
                        type="text"
                        enterKeyHint="done"
                        aria-label={`${selectedElement.name} 속성 추가 입력`}
                        placeholder="새 속성 (쉼표로 여러 개)"
                        value={attrDraft}
                        onChange={(e) => setAttrDraft(e.target.value)}
                        className="field flex-1"
                      />
                      <button
                        type="submit"
                        aria-label={`${selectedElement.name} 속성 추가`}
                        disabled={!attrDraft.trim()}
                        className="btn-primary shrink-0 disabled:cursor-not-allowed"
                      >
                        <Plus size={14} aria-hidden="true" />
                        추가
                      </button>
                    </form>

                    {selectedElement.attributes.length > 8 && (
                      <label className="relative">
                        <Search
                          size={14}
                          aria-hidden="true"
                          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted"
                        />
                        <input
                          type="search"
                          aria-label="속성 검색"
                          placeholder="속성 검색"
                          value={attrSearch}
                          onChange={(e) => setAttrSearch(e.target.value)}
                          className="field pl-8"
                        />
                      </label>
                    )}

                    <div className="flex items-center justify-between gap-2 text-2xs text-muted">
                      <span>
                        {attrQuery
                          ? '검색을 지우면 순서를 바꿀 수 있어요'
                          : '손잡이를 끌어 순서를 바꾸고 속성을 눌러 수정해요'}
                      </span>
                      <span className="shrink-0 font-mono">
                        {visibleAttrs.length} / {selectedElement.attributes.length}개
                      </span>
                    </div>

                    {selectedElement.attributes.length === 0 ? (
                      <p className="rounded-xl bg-paper p-4 text-center text-xs text-muted">
                        위 입력란에서 첫 속성을 추가해 보세요
                      </p>
                    ) : visibleAttrs.length === 0 ? (
                      <p className="rounded-xl bg-paper p-4 text-center text-xs text-muted">
                        검색어와 일치하는 속성이 없어요
                      </p>
                    ) : attrQuery ? (
                      <ul aria-label="속성 목록" className="flex flex-col gap-1.5">
                        {visibleAttrs.map((attr) => (
                          <li key={attr}>{renderAttrRow(selectedElement, attr, null)}</li>
                        ))}
                      </ul>
                    ) : (
                      <SortableList
                        label="속성 목록"
                        className="flex flex-col gap-1.5"
                        items={selectedElement.attributes}
                        getItemLabel={(attr) => `${attr} 속성`}
                        onReorder={(next) => handleReorderAttributes(selectedElement.id, next)}
                        renderItem={(attr, handle) => renderAttrRow(selectedElement, attr, handle)}
                      />
                    )}
                  </div>
                ) : (
                  <div className="flex flex-col gap-3">
                    <p className="text-xs leading-relaxed text-muted">
                      <span className="inline-block">만들기 화면의 프롬프트 입력란 위에서</span>{' '}
                      <span className="inline-block">빠르게 조합할 요소와 속성을 관리해요</span>
                    </p>
                    {promptAssemble.length === 0 ? (
                      <p className="rounded-xl bg-paper p-4 text-center text-xs text-muted">
                        아래 버튼으로 첫 요소를 추가해 보세요
                      </p>
                    ) : (
                      <SortableList
                        label="어셈블 요소 목록"
                        className="flex flex-col gap-1.5"
                        items={promptAssemble.map((el) => el.id)}
                        getItemLabel={(id) =>
                          `${promptAssemble.find((el) => el.id === id)?.name || ''} 요소`
                        }
                        onReorder={handleReorderElements}
                        renderItem={(id, handle) => {
                          const el = promptAssemble.find((x) => x.id === id);
                          if (!el) return null;
                          return (
                            <div className="flex items-center gap-1 rounded-xl border border-line bg-white pl-1 pr-2">
                              {handle}
                              <button
                                type="button"
                                aria-label={`${el.name} 요소 편집`}
                                onClick={() => openAssembleElement(el.id)}
                                className="flex min-h-14 min-w-0 flex-1 items-center gap-2 py-2 text-left"
                              >
                                <span className="min-w-0 flex-1">
                                  <span className="flex items-center gap-1.5 text-xs font-semibold text-ink">
                                    <span className="truncate">{el.name}</span>
                                    <span className="chip shrink-0 font-mono">
                                      {el.attributes.length}
                                    </span>
                                  </span>
                                  <span className="mt-0.5 block truncate text-2xs text-muted">
                                    {el.attributes.length
                                      ? el.attributes.join(', ')
                                      : '등록된 속성이 없어요'}
                                  </span>
                                </span>
                                <ChevronRight
                                  size={16}
                                  aria-hidden="true"
                                  className="shrink-0 text-muted"
                                />
                              </button>
                            </div>
                          );
                        }}
                      />
                    )}
                    {addingElement ? (
                      <form
                        data-ui-audit-row
                        className="flex items-center gap-2"
                        onSubmit={(e) => {
                          e.preventDefault();
                          handleAddAssembleElement();
                        }}
                      >
                        <input
                          type="text"
                          autoFocus
                          enterKeyHint="done"
                          aria-label="새 요소 이름"
                          placeholder="요소 이름 (예: 조명)"
                          value={newElementName}
                          onChange={(e) => setNewElementName(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Escape') {
                              setAddingElement(false);
                              setNewElementName('');
                            }
                          }}
                          className="field flex-1"
                        />
                        <button
                          type="submit"
                          disabled={!newElementName.trim()}
                          className="btn-primary shrink-0 disabled:cursor-not-allowed"
                        >
                          추가
                        </button>
                        <IconButton
                          icon={X}
                          className="!h-9 !w-9"
                          label="요소 추가 취소"
                          onClick={() => {
                            setAddingElement(false);
                            setNewElementName('');
                          }}
                        />
                      </form>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setAddingElement(true)}
                        className="flex min-h-11 items-center justify-center gap-1.5 rounded-xl border border-dashed border-line text-xs font-semibold text-muted hover:bg-paper hover:text-ink"
                      >
                        <Plus size={14} aria-hidden="true" />
                        요소 추가
                      </button>
                    )}
                  </div>
                )}
              </Section>
            </div>

            <Modal
              title="속성 일괄 편집"
              open={bulkOpen && !!selectedElement}
              onClose={() => setBulkOpen(false)}
              footer={
                <>
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={() => setBulkOpen(false)}
                  >
                    취소
                  </button>
                  <button
                    type="button"
                    className="btn-primary"
                    onClick={() => selectedElement && handleApplyBulkAttributes(selectedElement.id)}
                  >
                    <Check size={14} aria-hidden="true" />
                    일괄 적용
                  </button>
                </>
              }
            >
              <div className="flex flex-col gap-2">
                <p className="text-xs leading-relaxed text-muted">
                  쉼표, 슬래시 또는 줄바꿈으로 구분하면 적은 순서대로 저장돼요
                </p>
                <textarea
                  aria-label={`${selectedElement?.name || ''} 속성 일괄 편집`}
                  value={bulkText}
                  onChange={(e) => setBulkText(e.target.value)}
                  placeholder="eye-level, low, high, bird-eye"
                  className="field min-h-48 resize-y font-mono leading-6"
                />
              </div>
            </Modal>

            <Modal
              title="요소 삭제"
              open={!!deleteElement}
              onClose={() => setDeleteElement(null)}
              footer={
                <>
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={() => setDeleteElement(null)}
                  >
                    취소
                  </button>
                  <button
                    type="button"
                    className="btn-danger"
                    onClick={() => {
                      if (!deleteElement) return;
                      handleRemoveAssembleElement(deleteElement.id, deleteElement.name);
                      setDeleteElement(null);
                      openAssembleList();
                    }}
                  >
                    <Trash2 size={14} aria-hidden="true" />
                    삭제
                  </button>
                </>
              }
            >
              <p className="text-xs leading-relaxed">
                <strong>{deleteElement?.name}</strong> 요소와 속성{' '}
                {deleteElement?.attributes.length ?? 0}개를 삭제할까요?
              </p>
            </Modal>
          </>
        )}

        {activeTab === 'app' && (
          <>
            <Section title="앱 설치와 업데이트" icon={Smartphone}>
              <div className="flex flex-col gap-4">
                <p className="text-xs leading-relaxed text-muted">
                  홈 화면에 작업실을 두고, 앱처럼 가볍게 열어 보세요
                </p>
                <div data-ui-audit-row className="flex flex-wrap gap-2">
                  <button
                    disabled={installing || busy}
                    className="btn-secondary"
                    onClick={async () => {
                      setInstalling(true);
                      try {
                        if (!(await pwa.install()))
                          notify(
                            pwa.installed
                              ? '이미 앱으로 실행 중이에요'
                              : '브라우저 메뉴의 앱 설치 또는 홈 화면에 추가를 사용해 주세요. HTTPS 연결이 필요해요',
                          );
                      } finally {
                        setInstalling(false);
                      }
                    }}
                  >
                    {installing ? <Spinner /> : <Smartphone size={16} />}
                    {pwa.installed ? '설치된 앱' : '홈 화면에 추가'}
                  </button>
                  {pwa.waiting && (
                    <button className="btn-primary" onClick={pwa.update}>
                      새 버전 적용
                    </button>
                  )}
                </div>
                <p className="text-xs leading-relaxed text-muted">
                  iPhone은 Safari 공유 메뉴에서 ‘홈 화면에 추가’를 선택하세요
                  <br />
                  저장한 입력과 프리셋은 오프라인에서도 열 수 있어요
                </p>
              </div>
            </Section>
            <Section title="화면 유지와 완료 알림" icon={Bell}>
              <div className="flex flex-col gap-4">
                <p className="text-xs leading-relaxed text-muted">
                  생성 중에는 화면이 꺼지지 않도록 유지하고, 앱이 백그라운드일 때 생성이 끝나면
                  알림과 진동으로 알려드려요
                </p>
                <div data-ui-audit-row className="flex flex-wrap items-center gap-2">
                  <button
                    className={notificationsEnabled ? 'btn-primary' : 'btn-secondary'}
                    onClick={() => toggleNotifications()}
                  >
                    <Bell size={16} />
                    {notificationsEnabled ? '완료 알림 켜짐' : '완료 알림 켜기'}
                  </button>
                  <Status>
                    {'wakeLock' in navigator ? '화면 유지 지원됨' : '화면 유지 미지원'}
                  </Status>
                </div>
                <p className="text-xs leading-relaxed text-muted">
                  알림 권한을 허용하면 다른 탭이나 앱을 보는 동안 생성이 끝나도 바로 알 수 있어요
                  <br />
                  설치된 PWA에서는 읽지 않은 완료 개수도 배지로 표시돼요
                </p>
              </div>
            </Section>
            <Section title="이 기기의 데이터" icon={ShieldCheck}>
              <div className="flex flex-col gap-4">
                <div className="flex flex-wrap gap-2">
                  <Status>프리셋 {presets.length}개</Status>
                  <Status>생성 기록 {jobs.length}개</Status>
                  <Status>{online ? '온라인' : '오프라인'}</Status>
                </div>
                <p className="text-xs leading-relaxed text-muted">
                  프롬프트, 설정과 최근 500개 기록을 IndexedDB에 안전하게 보관해요
                  <br />
                  이미지 원본은 ComfyUI 서버에서 불러옵니다
                  <br />
                  <br />
                  브라우저 데이터 삭제에 대비해 중요한 프리셋은 JSON으로 내보내 주세요
                  <br />
                  공유 기기에서는 프롬프트와 서버 주소가 남는 점을 확인해 주세요
                </p>
              </div>
            </Section>
          </>
        )}
      </div>
    </div>
  );
}
