import { useState } from 'react';
import {
  Box,
  CircleAlert,
  CircleCheck,
  ImagePlus,
  LoaderCircle,
  Palette,
  Plus,
  Scan,
  Trash2,
  Upload,
  UserRound,
  Users,
  WandSparkles,
  X,
} from 'lucide-react';
import { thumbnailUrl } from '../api';
import { newId, type Job, type ObjectInfo } from '../domain';
import {
  compatibleAssets,
  imageFamilies,
  selectModel,
  type FamilyAssignments,
  type ModelEntry,
} from '../models';
import {
  CHARACTER_SHOTS,
  RATIO_PRESETS,
  STYLE_PRESETS,
  loraFamily,
  parseRatio,
  ratioPreset,
  ratioSize,
  type Character,
  type CharacterSlot,
  type Scenario,
  type SceneImage,
} from '../scenario';
import { IconButton, SelectControl } from './ui';
import { DraftInput, DraftTextarea } from './DraftField';

const familyLabels: Record<string, string> = {
  flux: 'Flux1.D',
  krea2: 'Krea2',
  moss: 'MOSS',
  qwen21: 'Qwen2.1',
};
const fileName = (path: string) => path.split(/[\\/]/).at(-1) || path;
const pending = (job?: Job) =>
  Boolean(job && ['submitting', 'queued', 'running'].includes(job.status));

export type CharacterImageTarget = CharacterSlot | 'extra';

export function ScenarioSettings({
  scenario,
  onChange,
  entries,
  info,
  assignments,
  editModel,
  loading,
  disabled,
  action,
  errors,
  shotJobs,
  selectedCharacter,
  onSelectCharacter,
  onCharacterImage,
  onGenerateCharacterImage,
  onPreview,
}: {
  scenario: Scenario;
  onChange: (patch: Partial<Scenario>) => void;
  entries: ModelEntry[];
  info: ObjectInfo | null;
  assignments: FamilyAssignments;
  editModel?: ModelEntry;
  loading: boolean;
  disabled: boolean;
  // The running scenario action, such as `character:<id>:face` for an upload.
  action: string | null;
  errors: Record<string, string>;
  // Latest job that renders a character image, by `character:<id>:<slot>`.
  shotJobs: Map<string, Job>;
  selectedCharacter: string;
  onSelectCharacter: (id: string) => void;
  onCharacterImage: (id: string, target: CharacterImageTarget, file: File) => void;
  onGenerateCharacterImage: (id: string, slot: CharacterSlot) => void;
  onPreview: (image: SceneImage) => void;
}) {
  const { settings, characters } = scenario;
  const [notice, setNotice] = useState('');
  const [customRatio, setCustomRatio] = useState<string | null>(null);
  const installed = entries.find(
    (entry) => entry.name === settings.model && entry.loader === settings.modelLoader,
  );
  const editModels = entries.filter((entry) => entry.family === 'qwen21');
  const preset = ratioPreset(settings.width, settings.height);
  const styleId =
    scenario.styleId ||
    STYLE_PRESETS.find((item) => item.text === scenario.style.trim())?.id ||
    (scenario.style.trim() ? 'custom' : '');
  const character = characters.find((c) => c.id === selectedCharacter) || characters[0];
  const characterIndex = character ? characters.indexOf(character) : -1;

  const updateCharacter = (id: string, patch: Partial<Character>) =>
    onChange({ characters: characters.map((c) => (c.id === id ? { ...c, ...patch } : c)) });

  function chooseLora(target: Character, name: string) {
    const family = name ? loraFamily(info, name, assignments) : null;
    const next = characters.map((c) => (c.id === target.id ? { ...c, lora: name } : c));
    if (!family || family === settings.architecture) {
      onChange({ characters: next });
      setNotice('');
      return;
    }
    // The LoRA decides the model family; the first installed model of it becomes the base.
    const entry = entries.find((item) => item.family === family);
    if (!entry) {
      onChange({ characters: next });
      setNotice(`이 LoRA에 맞는 ${familyLabels[family]} 계열 모델이 설치되어 있지 않아요`);
      return;
    }
    onChange({
      characters: next,
      settings: selectModel(settings, entry, info, assignments),
    });
    setNotice(`기본 모델을 ${familyLabels[family]} 계열의 ${fileName(entry.name)}(으)로 바꿨어요`);
  }

  function addCharacter() {
    const id = newId();
    onChange({
      characters: [
        ...characters,
        { id, name: '', lora: '', description: '', trigger: '', strength: 0.8, extras: [] },
      ],
    });
    onSelectCharacter(id);
  }

  return (
    <fieldset disabled={disabled} className="scenario-settings">
      <section className="scenario-card" aria-labelledby="scenario-look-title">
        <h2 id="scenario-look-title" className="scenario-card-title">
          <Palette size={15} aria-hidden="true" /> 화풍과 화면
        </h2>
        <div className="scenario-card-body">
          <label className="scenario-field">
            <span>화풍</span>
            <SelectControl
              aria-label="화풍"
              value={styleId}
              onChange={(e) => {
                const choice = STYLE_PRESETS.find((item) => item.id === e.target.value);
                onChange(
                  choice
                    ? { style: choice.text, styleId: choice.id }
                    : { styleId: e.target.value, style: e.target.value ? scenario.style : '' },
                );
              }}
            >
              <option value="">지정 안 함</option>
              {STYLE_PRESETS.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
              <option value="custom">직접 입력</option>
            </SelectControl>
          </label>
          {styleId && (
            <label className="scenario-field">
              <span>
                화풍 묘사 <small>고쳐 쓰면 직접 입력으로 바뀌어요</small>
              </span>
              <DraftTextarea
                className="field"
                rows={2}
                maxLength={3000}
                value={scenario.style}
                placeholder="예: 빛바랜 필름 색감과 낮은 채도"
                onValueChange={(style) => onChange({ style, styleId: 'custom' })}
              />
            </label>
          )}
          <div className="scenario-ratio">
            <label className="scenario-field">
              <span>화면 비율</span>
              <SelectControl
                aria-label="화면 비율"
                value={customRatio !== null ? 'custom' : `${settings.width}x${settings.height}`}
                onChange={(e) => {
                  if (e.target.value === 'custom') {
                    setCustomRatio('');
                    return;
                  }
                  const [width, height] = e.target.value.split('x').map(Number);
                  setCustomRatio(null);
                  onChange({ settings: { ...settings, width, height } });
                }}
              >
                {!preset && (
                  <option value={`${settings.width}x${settings.height}`}>
                    직접 입력 {settings.width} × {settings.height}
                  </option>
                )}
                {RATIO_PRESETS.map(({ ratio, label }) => {
                  const size = ratioSize(...(ratio.split(':').map(Number) as [number, number]));
                  return (
                    <option key={ratio} value={`${size.width}x${size.height}`}>
                      {label}
                    </option>
                  );
                })}
                <option value="custom">직접 입력…</option>
              </SelectControl>
            </label>
            <span
              className="scenario-ratio-frame"
              aria-hidden="true"
              style={{ aspectRatio: `${settings.width} / ${settings.height}` }}
            />
          </div>
          {customRatio !== null && (
            <form
              className="scenario-ratio-custom"
              onSubmit={(e) => {
                e.preventDefault();
                const ratio = parseRatio(customRatio);
                if (!ratio) return;
                onChange({ settings: { ...settings, ...ratioSize(ratio.w, ratio.h) } });
                setCustomRatio(null);
              }}
            >
              <label className="scenario-field grow">
                <span>
                  직접 입력 비율 <small>가로:세로, 최대 4:1</small>
                </span>
                <input
                  className="field"
                  aria-label="직접 입력 비율"
                  value={customRatio}
                  placeholder="예: 5:4 또는 2.39:1"
                  inputMode="decimal"
                  autoFocus
                  onChange={(e) => setCustomRatio(e.target.value)}
                />
              </label>
              <button
                type="submit"
                className="btn-primary scenario-touch self-end"
                disabled={!parseRatio(customRatio)}
              >
                적용
              </button>
            </form>
          )}
          <p className="scenario-hint">
            {settings.width} × {settings.height}px
            {preset ? ` · ${preset.label}` : ''}
          </p>
        </div>
      </section>

      <section className="scenario-card" aria-labelledby="scenario-model-title">
        <h2 id="scenario-model-title" className="scenario-card-title">
          <Box size={15} aria-hidden="true" /> 모델
        </h2>
        <div className="scenario-card-body">
          <label className="scenario-field">
            <span>
              기본 모델 <small>새로 생성</small>
            </span>
            {loading ? (
              <span role="status" className="scenario-model-loading">
                설치 모델 확인 중
              </span>
            ) : (
              <SelectControl
                aria-label="기본 모델"
                value={installed?.id || ''}
                title={installed?.name}
                onChange={(e) => {
                  const entry = entries.find((item) => item.id === e.target.value);
                  if (entry)
                    onChange({ settings: selectModel(settings, entry, info, assignments) });
                  setNotice('');
                }}
              >
                <option value="" disabled>
                  {entries.length ? '설치된 모델 선택' : '연결 설정을 확인해 주세요'}
                </option>
                {Object.entries(familyLabels).map(([family, name]) => {
                  const models = entries.filter((entry) => entry.family === family);
                  return (
                    models.length > 0 && (
                      <optgroup key={family} label={name}>
                        {models.map((entry) => (
                          <option key={entry.id} value={entry.id}>
                            {entry.name}
                          </option>
                        ))}
                      </optgroup>
                    )
                  );
                })}
              </SelectControl>
            )}
          </label>
          <label className="scenario-field">
            <span>
              편집 모델 <small>이어 만들기 기본값</small>
            </span>
            <SelectControl
              aria-label="편집 모델"
              value={editModel?.id || ''}
              title={editModel?.name}
              disabled={!editModels.length}
              onChange={(e) => onChange({ editModelId: e.target.value })}
            >
              <option value="" disabled>
                설치된 Qwen2.1 선택
              </option>
              {editModels.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.name}
                </option>
              ))}
            </SelectControl>
          </label>
          {notice ? (
            <p role="status" className="scenario-hint scenario-attention">
              {notice}
            </p>
          ) : (
            <p className="scenario-hint">
              캐릭터 LoRA를 고르면 그 LoRA에 맞는 계열의 모델로 기본 모델이 바뀌어요. 씬마다 다른
              편집 모델을 고를 수도 있어요.
            </p>
          )}
        </div>
      </section>

      <section
        className="scenario-card scenario-wide scenario-characters"
        aria-labelledby="scenario-cast-title"
      >
        <div className="scenario-card-head">
          <h2 id="scenario-cast-title" className="scenario-card-title">
            <Users size={15} aria-hidden="true" /> 캐릭터
            {characters.length > 0 && (
              <span className="scenario-tab-count">{characters.length}</span>
            )}
          </h2>
          <button
            type="button"
            className="btn-secondary scenario-touch"
            disabled={characters.length >= 20}
            onClick={addCharacter}
          >
            <Plus size={15} aria-hidden="true" /> 캐릭터 추가
          </button>
        </div>
        {characters.length === 0 ? (
          <div className="scenario-empty">
            <UserRound size={26} strokeWidth={1.5} aria-hidden="true" />
            <h3>등장인물을 추가해 보세요</h3>
            <p>
              새로 생성하는 씬에는 캐릭터 LoRA와 묘사가, 이미지로 이어 만드는 씬에는 얼굴·전신 정면
              이미지가 쓰여요.
            </p>
          </div>
        ) : (
          <div className="scenario-master-detail">
            <ul className="scenario-character-list" aria-label="캐릭터 목록">
              {characters.map((c, i) => {
                const ready = Boolean(c.face && c.body);
                return (
                  <li key={c.id}>
                    <button
                      type="button"
                      aria-current={c.id === character?.id || undefined}
                      onClick={() => onSelectCharacter(c.id)}
                    >
                      <span className="scenario-avatar">
                        {c.face ? (
                          <img src={thumbnailUrl(c.face.base, c.face.image)} alt="" />
                        ) : (
                          <UserRound size={18} aria-hidden="true" />
                        )}
                      </span>
                      <span className="scenario-character-meta">
                        <strong>{c.name.trim() || `캐릭터 ${i + 1}`}</strong>
                        <small>{c.lora ? fileName(c.lora) : 'LoRA 없음'}</small>
                        <small data-ready={ready}>
                          {ready ? '이어 만들기 가능' : '정면 이미지 필요'}
                        </small>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
            {character && (
              <CharacterEditor
                key={character.id}
                character={character}
                index={characterIndex}
                scenario={scenario}
                info={info}
                assignments={assignments}
                action={action}
                error={errors[character.id]}
                shotJobs={shotJobs}
                onUpdate={(patch) => updateCharacter(character.id, patch)}
                onLora={(name) => chooseLora(character, name)}
                onRemove={() => {
                  const rest = characters.filter((c) => c.id !== character.id);
                  onChange({ characters: rest });
                  onSelectCharacter(rest[Math.max(0, characterIndex - 1)]?.id || '');
                }}
                onImage={(target, file) => onCharacterImage(character.id, target, file)}
                onGenerate={(slot) => onGenerateCharacterImage(character.id, slot)}
                onPreview={onPreview}
              />
            )}
          </div>
        )}
      </section>
    </fieldset>
  );
}

function CharacterEditor({
  character,
  index,
  scenario,
  info,
  assignments,
  action,
  error,
  shotJobs,
  onUpdate,
  onLora,
  onRemove,
  onImage,
  onGenerate,
  onPreview,
}: {
  character: Character;
  index: number;
  scenario: Scenario;
  info: ObjectInfo | null;
  assignments: FamilyAssignments;
  action: string | null;
  error?: string;
  shotJobs: Map<string, Job>;
  onUpdate: (patch: Partial<Character>) => void;
  onLora: (name: string) => void;
  onRemove: () => void;
  onImage: (target: CharacterImageTarget, file: File) => void;
  onGenerate: (slot: CharacterSlot) => void;
  onPreview: (image: SceneImage) => void;
}) {
  const family = character.lora ? loraFamily(info, character.lora, assignments) : null;
  const mismatch = Boolean(character.lora) && family !== scenario.settings.architecture;
  const extras = character.extras || [];
  return (
    <div className="scenario-character-editor">
      <div className="scenario-row">
        <label className="scenario-field grow">
          <span>캐릭터 {index + 1} 이름</span>
          <DraftInput
            className="field"
            value={character.name}
            maxLength={80}
            placeholder="이름"
            onValueChange={(name) => onUpdate({ name })}
          />
        </label>
        <IconButton
          icon={Trash2}
          danger
          label={`캐릭터 ${index + 1} 삭제`}
          className="scenario-touch self-end"
          onClick={onRemove}
        />
      </div>

      <div className="scenario-field">
        <span>
          참조 이미지 <small>얼굴·전신 정면은 이미지로 이어 만들기에 필요해요</small>
        </span>
        <div className="scenario-slots">
          {(['face', 'body'] as const).map((slot) => {
            const job = shotJobs.get(`character:${character.id}:${slot}`);
            return (
              <ImageSlot
                key={slot}
                label={CHARACTER_SHOTS[slot].label}
                required
                shape={slot}
                image={character[slot] || null}
                uploading={action === `character:${character.id}:${slot}`}
                generating={
                  pending(job) || action === `shot:${character.id}:${slot}`
                    ? job?.status === 'running'
                      ? `${job.progress}%`
                      : '대기 중'
                    : null
                }
                generateLabel={character.lora ? 'LoRA로 생성' : '묘사로 생성'}
                canGenerate={Boolean(character.lora || character.description.trim())}
                onUpload={(file) => onImage(slot, file)}
                onGenerate={() => onGenerate(slot)}
                onRemove={() => onUpdate({ [slot]: null })}
                onPreview={onPreview}
              />
            );
          })}
          {extras.map((image, i) => (
            <ImageSlot
              key={image.id}
              label={`추가 이미지 ${i + 1}`}
              shape="extra"
              image={image}
              onRemove={() => onUpdate({ extras: extras.filter((item) => item.id !== image.id) })}
              onPreview={onPreview}
            />
          ))}
          {extras.length < 6 && (
            <label
              className="scenario-slot scenario-slot-add"
              data-shape="extra"
              aria-busy={action === `character:${character.id}:extra` || undefined}
            >
              {action === `character:${character.id}:extra` ? (
                <LoaderCircle size={18} className="animate-spin" aria-hidden="true" />
              ) : (
                <ImagePlus size={18} aria-hidden="true" />
              )}
              <span>추가 이미지</span>
              <input
                type="file"
                aria-label="추가 이미지 업로드"
                accept="image/jpeg,image/png,image/webp"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = '';
                  if (file) onImage('extra', file);
                }}
              />
            </label>
          )}
        </div>
        {error && (
          <p role="alert" className="scenario-hint scenario-attention">
            {error}
          </p>
        )}
      </div>

      <label className="scenario-field">
        <span>캐릭터 묘사</span>
        <DraftTextarea
          className="field"
          rows={3}
          maxLength={1000}
          value={character.description}
          placeholder="예: 짧은 검은 머리, 연한 회색 코트"
          onValueChange={(description) => onUpdate({ description })}
        />
      </label>

      <label className="scenario-field">
        <span>
          캐릭터 LoRA <small>새로 생성하는 씬에 쓰여요</small>
        </span>
        <SelectControl
          aria-label="캐릭터 LoRA"
          value={character.lora}
          onChange={(e) => onLora(e.target.value)}
        >
          <option value="">LoRA 없이 묘사만 사용</option>
          {character.lora && !family && (
            <option value={character.lora}>{fileName(character.lora)} (계열 확인 필요)</option>
          )}
          {imageFamilies.map(({ id }) => {
            const names = compatibleAssets(info, 'lora', id, assignments);
            return (
              names.length > 0 && (
                <optgroup key={id} label={familyLabels[id]}>
                  {names.map((name) => (
                    <option key={name} value={name}>
                      {fileName(name)}
                    </option>
                  ))}
                </optgroup>
              )
            );
          })}
        </SelectControl>
      </label>
      {mismatch && (
        <p className="scenario-hint scenario-attention">
          {family ? `${familyLabels[family]} 계열 LoRA예요. ` : ''}지금 기본 모델 계열(
          {familyLabels[scenario.settings.architecture]})과 달라서 새로 생성하는 씬에 쓸 수 없어요.
        </p>
      )}
      {character.lora && (
        <div className="scenario-lora-controls">
          <label className="scenario-field">
            <span>트리거 단어</span>
            <DraftInput
              className="field"
              value={character.trigger}
              maxLength={250}
              placeholder="예: omz"
              onValueChange={(trigger) => onUpdate({ trigger })}
            />
          </label>
          <label className="scenario-field">
            <span>LoRA 강도</span>
            <input
              className="field"
              type="number"
              min={-2}
              max={2}
              step={0.05}
              value={character.strength}
              onChange={(e) => {
                if (e.target.value !== '' && e.target.validity.valid)
                  onUpdate({ strength: e.target.valueAsNumber });
              }}
            />
          </label>
        </div>
      )}
    </div>
  );
}

function ImageSlot({
  label,
  required,
  shape,
  image,
  uploading,
  generating,
  generateLabel,
  canGenerate,
  onUpload,
  onGenerate,
  onRemove,
  onPreview,
}: {
  label: string;
  required?: boolean;
  shape: CharacterSlot | 'extra';
  image: SceneImage | null;
  uploading?: boolean;
  // Progress text while a generated image is on its way.
  generating?: string | null;
  generateLabel?: string;
  canGenerate?: boolean;
  onUpload?: (file: File) => void;
  onGenerate?: () => void;
  onRemove: () => void;
  onPreview: (image: SceneImage) => void;
}) {
  const busy = uploading || Boolean(generating);
  return (
    <div className="scenario-slot" data-shape={shape} data-filled={Boolean(image)}>
      <div className="scenario-slot-head">
        <span>{label}</span>
        {required &&
          (image ? (
            <CircleCheck size={14} className="text-olive" aria-label="등록됨" />
          ) : (
            <CircleAlert size={14} className="text-[#a26a12]" aria-label="필요" />
          ))}
      </div>
      <div className="scenario-slot-image">
        {busy ? (
          <span className="scenario-slot-busy" role="status">
            <LoaderCircle size={18} className="animate-spin" aria-hidden="true" />
            {uploading ? '올리는 중' : `생성 ${generating}`}
          </span>
        ) : image ? (
          <button type="button" aria-label={`${label} 크게 보기`} onClick={() => onPreview(image)}>
            <img src={thumbnailUrl(image.base, image.image)} alt="" />
            <Scan size={14} aria-hidden="true" />
          </button>
        ) : (
          <UserRound size={28} strokeWidth={1.4} aria-hidden="true" />
        )}
        {image && !busy && (
          <button
            type="button"
            className="scenario-slot-remove"
            aria-label={`${label} 삭제`}
            onClick={onRemove}
          >
            <X size={12} aria-hidden="true" />
          </button>
        )}
      </div>
      {onUpload && (
        <div className="scenario-slot-actions">
          <label className="scenario-slot-action" aria-disabled={busy || undefined}>
            <Upload size={13} aria-hidden="true" />
            {image ? '바꾸기' : '업로드'}
            <input
              type="file"
              aria-label={`${label} 업로드`}
              accept="image/jpeg,image/png,image/webp"
              disabled={busy}
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = '';
                if (file) onUpload(file);
              }}
            />
          </label>
          {onGenerate && (
            <button
              type="button"
              className="scenario-slot-action"
              aria-label={`${label} ${generateLabel}`}
              title={canGenerate ? undefined : '캐릭터 LoRA나 묘사를 먼저 입력해 주세요'}
              disabled={busy || !canGenerate}
              onClick={onGenerate}
            >
              <WandSparkles size={13} aria-hidden="true" />
              {generateLabel}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
