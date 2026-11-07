import { useId, useMemo, useState } from 'react';
import { Box, RefreshCw, Tags } from 'lucide-react';
import { useStudio } from '../studio';
import { options } from '../domain';
import {
  catalog,
  compatibleAssets,
  families,
  selectModel,
  selectedEntry,
  assetFamily,
  type ModelFamily,
} from '../models';
import { Section, Picker, Field, IconButton, Modal, SelectControl } from './ui';

export default function ModelPanel() {
  const {
    settings: s,
    setSettings,
    info,
    connectionState,
    familyAssignments,
    refreshModels,
    notify,
  } = useStudio();
  const [classify, setClassify] = useState(false);
  const [format, setFormat] = useState('all');
  const panelId = useId();
  const entries = useMemo(() => catalog(info, familyAssignments), [info, familyAssignments]);
  const tabs = families;
  const familyModels = entries.filter((e) => e.family === s.architecture);
  const visible = familyModels.filter((e) => format === 'all' || e.format === format);
  const selected = selectedEntry(s, info, familyAssignments);
  const labels = Object.fromEntries(entries.map((e) => [e.id, e.name]));
  const descriptions = Object.fromEntries(entries.map((e) => [e.id, e.format]));
  const clips = compatibleAssets(info, 'clip', s.architecture, familyAssignments);
  const vaes = compatibleAssets(info, 'vae', s.architecture, familyAssignments);
  function chooseFamily(family: ModelFamily) {
    if (family === s.architecture) return;
    const list = entries.filter((e) => e.family === family);
    const first = list[0];
    setSettings((prev) =>
      first
        ? selectModel(prev, first, info, familyAssignments)
        : {
            ...prev,
            architecture: family,
            model: '',
            modelLoader: 'CheckpointLoaderSimple',
            loras: [],
            clip1: '',
            clip2: '',
            vae: '',
          },
    );
    setFormat('all');
    if (s.loras.length) notify('계열을 바꾸며 LoRA와 인코더를 해당 계열에 맞게 초기화했어요');
  }
  function chooseFormat(value: string) {
    setFormat(value);
    if (selected?.family === s.architecture && (value === 'all' || selected.format === value))
      return;
    const list = familyModels.filter((e) => value === 'all' || e.format === value);
    const first = list[0];
    setSettings((prev) =>
      first ? selectModel(prev, first, info, familyAssignments) : { ...prev, model: '' },
    );
  }
  const ggufCount = entries.filter((e) => e.format === 'GGUF').length;
  return (
    <>
      <Section
        title="모델 계열과 모델"
        icon={Box}
        action={
          <div className="-my-2.5 -mr-2 flex items-center">
            <IconButton
              icon={Tags}
              label="모델과 LoRA 계열 분류"
              onClick={() => setClassify(true)}
            />
            <IconButton
              icon={RefreshCw}
              label="설치 목록 새로고침"
              disabled={connectionState === 'connecting'}
              onClick={refreshModels}
            />
          </div>
        }
      >
        <div
          role="tablist"
          aria-label="모델 계열"
          className="mb-4 grid min-w-0 grid-cols-2 gap-2 pb-2 sm:flex"
        >
          {tabs.map((f, i) => (
            <button
              key={f.id}
              role="tab"
              aria-selected={s.architecture === f.id}
              aria-controls={panelId}
              tabIndex={s.architecture === f.id ? 0 : -1}
              className={`flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-xl border px-3 text-xs font-semibold ${s.architecture === f.id ? 'border-ink bg-ink text-lime' : 'border-line bg-paper text-muted'}`}
              onClick={() => chooseFamily(f.id)}
              onKeyDown={(e) => {
                const delta = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
                let idx =
                  e.key === 'Home'
                    ? 0
                    : e.key === 'End'
                      ? tabs.length - 1
                      : (i + delta + tabs.length) % tabs.length;
                if (!delta && !['Home', 'End'].includes(e.key)) return;
                e.preventDefault();
                chooseFamily(tabs[idx].id);
                (
                  e.currentTarget.parentElement!.querySelectorAll('[role=tab]')[
                    idx
                  ] as HTMLButtonElement
                ).focus();
              }}
            >
              {f.label}
              <span className="font-mono text-[10px] opacity-80">
                {entries.filter((e) => e.family === f.id).length}
              </span>
            </button>
          ))}
        </div>
        <div
          id={panelId}
          role="tabpanel"
          aria-label={`${families.find((f) => f.id === s.architecture)?.label} 모델`}
          className="flex min-w-0 flex-col gap-4"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-muted">
              {familyModels.length}개 모델 <span className="mx-1">|</span> 전체 {entries.length}개
            </p>
            <div className="flex gap-1">
              {['all', '체크포인트', 'Diffusion', 'GGUF']
                .filter(
                  (v) => v === 'all' || familyModels.some((e) => e.format === v) || v === 'GGUF',
                )
                .map((v) => (
                  <button
                    key={v}
                    onClick={() => chooseFormat(v)}
                    aria-pressed={format === v}
                    className={`min-h-9 rounded-lg px-2 text-[11px] ${format === v ? 'bg-stone font-semibold text-ink' : 'text-muted'}`}
                  >
                    {v === 'all' ? '모든 형식' : v}
                  </button>
                ))}
            </div>
          </div>
          {connectionState === 'connecting' ? (
            <div
              className="h-12 animate-pulse rounded-xl bg-stone"
              aria-label="모델 목록을 불러오는 중"
            />
          ) : visible.length ? (
            <Picker
              label="모델"
              value={selected?.id || s.model}
              items={visible.map((e) => e.id)}
              labels={labels}
              descriptions={descriptions}
              onChange={(id) => {
                const entry = entries.find((e) => e.id === id)!;
                setSettings((prev) => selectModel(prev, entry, info, familyAssignments));
              }}
            />
          ) : (
            <div className="rounded-xl bg-paper p-4 text-center text-xs leading-relaxed text-muted">
              {format === 'GGUF'
                ? `이 계열에 등록된 GGUF 파일이 없어요${info?.UnetLoaderGGUF ? ' | GGUF 로더 설치됨' : ' | 서버의 GGUF 로더 설치를 확인해 주세요'}`
                : '이 계열의 모델이 없어요\n다른 탭이나 계열 분류를 확인해 주세요'}
            </div>
          )}
          {selected && (
            <p className="text-[11px] text-muted">
              {selected.format} <span className="mx-1">|</span>{' '}
              {connectionState === 'preview' ? '미리보기 목록' : '서버 설치 목록'}
            </p>
          )}
          {s.model && (!selected || selected.family !== s.architecture) && (
            <p role="status" className="text-xs text-red-700">
              현재 계열에서 모델을 다시 선택해 주세요
            </p>
          )}
          <details
            className="rounded-xl bg-paper p-4"
            open={!s.clip1 || !s.vae || (s.architecture === 'flux' && !s.clip2) || undefined}
          >
            <summary className="cursor-pointer text-xs font-semibold">
              텍스트 인코더와 VAE{' '}
              <span className="ml-1 font-normal text-muted">
                {s.clip1 && s.vae && (s.architecture !== 'flux' || s.clip2)
                  ? '자동 선택됨'
                  : '설치 확인 필요'}
              </span>
            </summary>
            <div className="mt-4 flex flex-col gap-3">
              <Field label={s.architecture === 'flux' ? 'CLIP L' : '텍스트 인코더'}>
                <Picker
                  label={s.architecture === 'flux' ? 'CLIP L' : '텍스트 인코더'}
                  value={s.clip1}
                  items={s.architecture === 'flux' ? clips.filter((v) => /clip_l/i.test(v)) : clips}
                  onChange={(clip1) => setSettings((prev) => ({ ...prev, clip1 }))}
                />
              </Field>
              {s.architecture === 'flux' && (
                <Field label="T5 텍스트 인코더">
                  <Picker
                    label="T5"
                    value={s.clip2}
                    items={clips.filter((v) => /t5/i.test(v))}
                    onChange={(clip2) => setSettings((prev) => ({ ...prev, clip2 }))}
                  />
                </Field>
              )}
              <Field label="VAE">
                <Picker
                  label="VAE"
                  value={s.vae}
                  items={vaes}
                  onChange={(vae) => setSettings((prev) => ({ ...prev, vae }))}
                />
              </Field>
            </div>
          </details>
          <p className="text-[11px] leading-relaxed text-muted">
            폴더와 파일명으로 계열을 분류해요 | 분류 버튼으로 수정할 수 있어요
            {ggufCount === 0 && info?.UnetLoaderGGUF ? ' | 현재 서버의 GGUF 파일 0개' : ''}
          </p>
        </div>
      </Section>
      <Classification open={classify} onClose={() => setClassify(false)} />
    </>
  );
}
function Classification({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { info, familyAssignments, setFamilyAssignments, notify } = useStudio();
  const [kind, setKind] = useState('model'),
    [search, setSearch] = useState('');
  const names =
    kind === 'model'
      ? [...new Set(catalog(info).map((e) => e.name))]
      : kind === 'lora'
        ? options(info, 'LoraLoader', 'lora_name')
        : kind === 'vae'
          ? options(info, 'VAELoader', 'vae_name')
          : [
              ...new Set(
                ['CLIPLoader', 'CLIPLoaderGGUF', 'DualCLIPLoader', 'DualCLIPLoaderGGUF'].flatMap(
                  (n) =>
                    n.startsWith('Dual')
                      ? [...options(info, n, 'clip_name1'), ...options(info, n, 'clip_name2')]
                      : options(info, n, 'clip_name'),
                ),
              ),
            ];
  const filtered = names.filter((n) => n.toLowerCase().includes(search.toLowerCase()));
  return (
    <Modal
      title="계열 분류"
      open={open}
      onClose={onClose}
      footer={
        <button className="btn-primary" onClick={onClose}>
          완료
        </button>
      }
    >
      <div className="flex flex-col gap-4">
        <p className="text-xs leading-relaxed text-muted">
          파일명으로 알기 어려운 모델과 LoRA는 직접 계열을 지정하세요
          <br />
          분류는 이 기기에 저장되며 실제 모델의 호환성을 확인한 뒤 선택해 주세요
        </p>
        <SelectControl
          aria-label="분류 대상"
          value={kind}
          onChange={(e) => {
            setKind(e.target.value);
            setSearch('');
          }}
        >
          <option value="model">모델</option>
          <option value="lora">LoRA</option>
          <option value="clip">텍스트 인코더</option>
          <option value="vae">VAE</option>
        </SelectControl>
        <input
          className="field"
          aria-label="분류 파일 검색"
          placeholder="파일명 검색"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <div className="flex max-h-[45dvh] flex-col gap-3 overflow-y-auto">
          {filtered.map((name) => (
            <label key={name} className="flex flex-col gap-2 rounded-xl bg-paper p-3">
              <span className="text-xs [overflow-wrap:anywhere]">{name}</span>
              <SelectControl
                aria-label={`${name} 계열`}
                value={assetFamily(kind, name, familyAssignments) || ''}
                onChange={(e) => {
                  setFamilyAssignments((prev) => ({
                    ...prev,
                    [`${kind}:${name}`]: e.target.value as ModelFamily,
                  }));
                  notify('계열 분류를 저장했어요');
                }}
              >
                <option value="" disabled>
                  미분류
                </option>
                {families.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.label}
                  </option>
                ))}
              </SelectControl>
            </label>
          ))}
        </div>
        {!filtered.length && (
          <p className="p-4 text-center text-xs text-muted">
            {names.length ? '검색어를 바꿔서 다시 찾아보세요' : '등록된 파일이 없어요'}
          </p>
        )}
      </div>
    </Modal>
  );
}
