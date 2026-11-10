import { useMemo, useState } from 'react';
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
    modelOrder,
    refreshModels,
    notify,
  } = useStudio();
  const [classify, setClassify] = useState(false);
  const entries = useMemo(
    () => catalog(info, familyAssignments, modelOrder),
    [info, familyAssignments, modelOrder],
  );
  const familyModels = entries.filter((e) => e.family === s.architecture);
  const visible = familyModels;
  const selected = selectedEntry(s, info, familyAssignments);
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
    if (s.loras.length) notify('계열을 바꾸며 LoRA와 인코더를 해당 계열에 맞게 초기화했어요');
  }
  return (
    <>
      <Section
        title="모델 계열과 모델"
        icon={Box}
        action={
          <div className="-my-1.5 -mr-1 flex items-center">
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
        <div className="flex min-w-0 flex-col gap-3">
          <div
            data-ui-audit-row
            className="grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)] items-center gap-2"
          >
            <SelectControl
              aria-label="모델 계열"
              value={s.architecture}
              onChange={(e) => chooseFamily(e.target.value as ModelFamily)}
            >
              {families.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.label} ({entries.filter((e) => e.family === f.id).length})
                </option>
              ))}
            </SelectControl>
            {connectionState === 'connecting' ? (
              <div
                className="h-9 animate-pulse rounded-lg bg-stone"
                aria-label="모델 목록을 불러오는 중"
              />
            ) : (
              <SelectControl
                aria-label="모델"
                value={selected?.family === s.architecture ? selected.id : ''}
                disabled={!visible.length}
                onChange={(e) => {
                  const entry = entries.find((x) => x.id === e.target.value);
                  if (entry)
                    setSettings((prev) => selectModel(prev, entry, info, familyAssignments));
                }}
              >
                {(!selected || selected.family !== s.architecture) && (
                  <option value="" disabled>
                    {visible.length ? '모델 선택' : '모델 없음'}
                  </option>
                )}
                {visible.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.name} ({e.format})
                  </option>
                ))}
              </SelectControl>
            )}
          </div>
          {connectionState !== 'connecting' && !visible.length && (
            <p className="text-2xs leading-relaxed text-muted">
              이 계열의 모델이 없어요 | 다른 계열이나 계열 분류를 확인해 주세요
            </p>
          )}
          {s.model && (!selected || selected.family !== s.architecture) && (
            <p role="status" className="text-xs text-red-700">
              현재 계열에서 모델을 다시 선택해 주세요
            </p>
          )}
          <details
            className="rounded-lg bg-paper p-3"
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
            <div className="mt-3 flex flex-col gap-2.5">
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
      <div className="flex flex-col gap-3">
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
        <div className="flex max-h-[45dvh] flex-col gap-2 overflow-y-auto">
          {filtered.map((name) => (
            <label key={name} className="flex flex-col gap-1.5 rounded-lg bg-paper p-2.5">
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
