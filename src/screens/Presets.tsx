import { useState, useRef, useId } from 'react';
import {
  Bookmark,
  Copy,
  Pencil,
  Trash2,
  Upload,
  Download,
  Search,
  Plus,
  ArrowUpRight,
  SlidersHorizontal,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { useStudio } from '../studio';
import { families } from '../models';
import { importPresets, downloadJson, newId, parseSettings, type Preset } from '../domain';
import { Empty, IconButton, Modal, Spinner, FieldError } from '../components/ui';
export const presetColors = {
  sage: 'bg-[#e5eadc] text-[#4c6443]',
  sand: 'bg-[#f1e4d2] text-[#81623b]',
  rose: 'bg-[#eddfda] text-[#916858]',
};
export default function Presets() {
  const { presets, setPresets, setSettings, notify } = useStudio();
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Preset | null>(null);
  const [editing, setEditing] = useState<Preset | null>(null);
  const [remove, setRemove] = useState<Preset | null>(null);
  const [importing, setImporting] = useState(false);
  const shown = presets.filter((p) =>
    `${p.name} ${p.description}`.toLocaleLowerCase().includes(search.toLocaleLowerCase()),
  );
  async function load(file?: File) {
    if (!file) return;
    setImporting(true);
    try {
      if (file.size > 2_000_000) throw new Error('2MB 이하 파일을 선택해 주세요');
      const imported = importPresets(await file.text());
      if (presets.length + imported.length > 100)
        throw new Error('프리셋은 최대 100개까지 보관할 수 있어요');
      setPresets((all) => [...all, ...imported]);
      notify(`${imported.length}개 프리셋을 새 항목으로 가져왔어요`);
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setImporting(false);
    }
  }
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-none flex-col gap-3 px-4 py-4 sm:px-5 lg:px-6">
        <div data-ui-audit-row className="flex flex-wrap items-center justify-between gap-3">
          <label className="relative min-w-0 flex-1 sm:max-w-80">
            <Search
              size={15}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted"
            />
            <input
              aria-label="프리셋 검색"
              className="field pl-10"
              placeholder="프리셋 검색"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </label>
          <div className="flex gap-2">
            <label
              className={`btn-secondary cursor-pointer ${importing ? 'pointer-events-none opacity-50' : ''}`}
            >
              {importing ? <Spinner /> : <Upload size={16} />}
              <span className="hidden sm:inline">가져오기</span>
              <input
                disabled={importing}
                aria-label="프리셋 JSON 가져오기"
                className="sr-only"
                type="file"
                accept=".json,application/json"
                onChange={(e) => {
                  void load(e.target.files?.[0]);
                  e.target.value = '';
                }}
              />
            </label>
            <IconButton
              icon={Download}
              className="!h-9 !w-9"
              label="전체 프리셋 내보내기"
              disabled={!presets.length}
              onClick={() => downloadJson('comfymui-presets.json', { version: 1, presets })}
            />
          </div>
        </div>
        <p className="text-xs text-muted">{shown.length}개 프리셋 | 기기에 저장됨</p>
      </div>
      <div
        data-ui-audit-scroll-root
        className="min-h-0 flex-1 overflow-y-auto px-4 pb-6 sm:px-5 lg:px-6"
      >
        {shown.length ? (
          <div
            data-ui-audit-card-group
            className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3"
          >
            {shown.map((p) => (
              <article
                key={p.id}
                data-ui-audit-card
                data-ui-audit-card-type="preset-card"
                className="flex h-full min-w-0 flex-col justify-between rounded-xl border border-line bg-white p-4"
              >
                <button className="text-left" onClick={() => setSelected(p)}>
                  <span
                    className={`mb-5 flex h-14 w-14 items-center justify-center rounded-2xl ${presetColors[p.color as keyof typeof presetColors] || presetColors.sage}`}
                  >
                    <Bookmark size={24} />
                  </span>
                  <h2 className="text-sm font-semibold [overflow-wrap:anywhere]">{p.name}</h2>
                  <p className="mt-2 line-clamp-2 min-h-10 text-xs leading-5 text-muted">
                    {p.description || '나만의 생성 설정'}
                  </p>
                </button>
                <div className="mt-4 flex flex-wrap gap-1.5">
                  <span className="chip">
                    {p.settings.workflow
                      ? 'API 워크플로'
                      : families.find((f) => f.id === p.settings.architecture)?.label}
                  </span>
                  <span className="chip font-mono">
                    {p.settings.width} × {p.settings.height}
                  </span>
                  <span className="chip">LoRA {p.settings.loras.length}</span>
                </div>
                <div
                  data-ui-audit-row
                  className="mt-4 flex items-center justify-between border-t border-line pt-3"
                >
                  <Link
                    className="flex min-h-9 items-center gap-1 text-xs font-semibold text-olive"
                    to="/create"
                    onClick={() => {
                      setSettings(structuredClone(p.settings));
                      notify(`${p.name} 프리셋을 적용했어요`);
                    }}
                  >
                    적용하기
                    <ArrowUpRight size={15} />
                  </Link>
                  <div className="-mr-1.5 flex items-center">
                    <IconButton
                      icon={Pencil}
                      label={`${p.name} 수정`}
                      onClick={() => setEditing(p)}
                    />
                    <IconButton
                      icon={Copy}
                      label={`${p.name} 복제`}
                      onClick={() => {
                        if (presets.length >= 100) {
                          notify('프리셋은 최대 100개까지 보관할 수 있어요');
                          return;
                        }
                        setPresets((all) => [
                          ...all,
                          {
                            ...structuredClone(p),
                            id: newId(),
                            name: (p.name + ' 복사본').slice(0, 80),
                            updatedAt: Date.now(),
                          },
                        ]);
                        notify('프리셋을 복제했어요');
                      }}
                    />
                    <IconButton
                      icon={Trash2}
                      danger
                      label={`${p.name} 삭제`}
                      onClick={() => setRemove(p)}
                    />
                  </div>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <Empty
            icon={Bookmark}
            title={search ? '다른 검색어로 찾아보세요' : '좋아하는 설정을 남겨 보세요'}
            description={
              search
                ? '이름과 설명에서 프리셋을 찾아요'
                : '모델, 프롬프트와 세부 설정을 한 번에 저장하고 다시 사용할 수 있어요'
            }
          >
            <Link to="/create" className="btn-primary">
              <Plus size={17} />
              생성 화면으로
            </Link>
          </Empty>
        )}
      </div>
      {editing && <PresetEditor existing={editing} open onClose={() => setEditing(null)} />}
      <Modal
        title="프리셋 상세"
        open={Boolean(selected)}
        onClose={() => setSelected(null)}
        footer={
          selected && (
            <>
              <button
                className="btn-secondary"
                onClick={() =>
                  downloadJson('comfymui-preset.json', { version: 1, presets: [selected] })
                }
              >
                <Download size={15} />
                내보내기
              </button>
              <Link
                className="btn-primary"
                to="/create"
                onClick={() => {
                  setSettings(structuredClone(selected.settings));
                  setSelected(null);
                  notify('프리셋을 적용했어요');
                }}
              >
                적용하기
              </Link>
            </>
          )
        }
      >
        {selected && (
          <div className="flex flex-col gap-4">
            <h3 className="text-base font-semibold [overflow-wrap:anywhere]">{selected.name}</h3>
            <p className="text-xs leading-relaxed text-muted">{selected.description}</p>
            <Snapshot preset={selected} />
            <p className="text-xs leading-relaxed text-muted">
              설정을 바꾸려면 적용한 뒤 생성 화면에서 수정하고
              <br />
              기존 프리셋 수정에서 현재 설정으로 교체해 주세요
            </p>
          </div>
        )}
      </Modal>
      <Modal
        title="프리셋을 삭제할까요?"
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
                setPresets((all) => all.filter((p) => p.id !== remove?.id));
                setRemove(null);
                notify('프리셋을 삭제했어요');
              }}
            >
              삭제
            </button>
          </>
        }
      >
        <p className="text-xs leading-relaxed text-muted">
          <strong>{remove?.name}</strong> 프리셋을 기기에서 삭제합니다
          <br />
          보관하려면 먼저 내보내 주세요
        </p>
      </Modal>
    </div>
  );
}
export function PresetEditor({
  existing,
  open,
  onClose,
}: {
  existing?: Preset;
  open: boolean;
  onClose: () => void;
}) {
  const { settings, presets, setPresets, notify } = useStudio();
  const [name, setName] = useState(existing?.name || '');
  const [description, setDescription] = useState(existing?.description || '');
  const [color, setColor] = useState(existing?.color || 'sage');
  const [replace, setReplace] = useState(false);
  const [error, setError] = useState('');
  const nameInput = useRef<HTMLInputElement>(null);
  const errorId = useId();
  function save() {
    try {
      if (!name.trim()) throw new Error('프리셋 이름을 입력해 주세요');
      if (!existing && presets.length >= 100)
        throw new Error('프리셋은 최대 100개까지 보관할 수 있어요');
      const snapshot = parseSettings(existing && !replace ? existing.settings : settings);
      const preset = {
        id: existing?.id || newId(),
        name: name.trim(),
        description,
        color,
        updatedAt: Date.now(),
        settings: snapshot,
      };
      setPresets((all) =>
        existing ? all.map((p) => (p.id === existing.id ? preset : p)) : [preset, ...all],
      );
      notify(existing ? '프리셋을 수정했어요' : '프리셋에 저장했어요');
      onClose();
    } catch (e) {
      if (!name.trim()) {
        setError((e as Error).message);
        nameInput.current?.focus();
      } else notify((e as Error).message);
    }
  }
  return (
    <Modal
      title={existing ? '프리셋 수정' : '프리셋 저장'}
      open={open}
      onClose={onClose}
      footer={
        <>
          <button className="btn-secondary" onClick={onClose}>
            취소
          </button>
          <button className="btn-primary" onClick={save}>
            저장
          </button>
        </>
      }
    >
      <div className="flex flex-col gap-5">
        <label className="flex flex-col gap-2 text-xs font-semibold">
          이름
          <input
            ref={nameInput}
            aria-invalid={Boolean(error)}
            aria-describedby={error ? errorId : undefined}
            aria-label="프리셋 이름"
            className="field"
            maxLength={80}
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setError('');
            }}
            placeholder="예: 부드러운 숲의 아침"
          />
        </label>
        <label className="flex flex-col gap-2 text-xs font-semibold">
          설명
          <textarea
            aria-label="프리셋 설명"
            className="field min-h-20"
            maxLength={300}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="어떤 장면에 어울리나요?"
          />
        </label>
        <div className="flex gap-3">
          {Object.keys(presetColors).map((c, i) => (
            <button
              key={c}
              aria-label={`${['그린', '샌드', '로즈'][i]} 프리셋 색상`}
              aria-pressed={c === color}
              onClick={() => setColor(c)}
              className={`flex h-9 w-9 items-center justify-center rounded-lg border-2 ${c === color ? 'border-ink' : 'border-transparent'} ${presetColors[c as keyof typeof presetColors]}`}
            >
              <Bookmark size={18} />
            </button>
          ))}
        </div>
        {existing && (
          <label className="flex items-start gap-3 rounded-xl bg-stone p-4 text-xs leading-relaxed">
            <input
              className="mt-0.5 h-5 w-5 shrink-0 accent-olive"
              type="checkbox"
              checked={replace}
              onChange={(e) => setReplace(e.target.checked)}
            />
            <span>
              저장된 생성 설정을 <strong>현재 생성 화면의 설정으로 교체</strong>
              <br />
              선택 후 저장하면 기존 설정을 덮어씁니다
            </span>
          </label>
        )}
        <div className="rounded-xl bg-paper p-4">
          <p className="mb-3 flex items-center gap-2 text-xs font-semibold">
            <SlidersHorizontal size={14} />
            함께 저장할 설정
          </p>
          <Snapshot
            preset={{ settings: existing && !replace ? existing.settings : settings } as Preset}
          />
        </div>
        <FieldError anchor={nameInput} message={error} id={errorId} />
      </div>
    </Modal>
  );
}
function Snapshot({ preset: { settings: s } }: { preset: Preset }) {
  return (
    <div className="flex flex-col gap-2 text-xs leading-relaxed text-muted">
      <p className="[overflow-wrap:anywhere]">
        {s.workflow
          ? `API 워크플로 | ${Object.keys(s.workflow).length}개 노드`
          : s.model || '모델을 선택해 주세요'}
      </p>
      <p>
        {s.width} × {s.height} | {s.batch}장 | LoRA {s.loras.length}
      </p>
      <p>
        {s.steps} steps | CFG {s.cfg} | {s.sampler}
      </p>
      <p className="line-clamp-3">{s.positive}</p>
    </div>
  );
}
