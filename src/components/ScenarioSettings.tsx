import { Plus, SlidersHorizontal, Trash2 } from 'lucide-react';
import { newId, type ObjectInfo } from '../domain';
import { compatibleAssets, selectModel, type FamilyAssignments, type ModelEntry } from '../models';
import type { Scenario } from '../scenario';
import { IconButton, SelectControl } from './ui';

const ratios = [
  { label: '정사각 1:1', width: 1024, height: 1024 },
  { label: '세로 3:4', width: 768, height: 1024 },
  { label: '가로 4:3', width: 1024, height: 768 },
  { label: '와이드 16:9', width: 1024, height: 576 },
];

const familyLabels = { flux: 'Flux1.D', krea2: 'Krea2', moss: 'MOSS', qwen21: 'Qwen2.1' };

export function ScenarioSettings({
  scenario,
  onChange,
  entries,
  info,
  assignments,
  editModel,
  loading,
  disabled,
}: {
  scenario: Scenario;
  onChange: (patch: Partial<Scenario>) => void;
  entries: ModelEntry[];
  info: ObjectInfo | null;
  assignments: FamilyAssignments;
  editModel?: ModelEntry;
  loading: boolean;
  disabled: boolean;
}) {
  const { settings, characters } = scenario;
  const installed = entries.find(
    (entry) => entry.name === settings.model && entry.loader === settings.modelLoader,
  );
  const loras = compatibleAssets(info, 'lora', settings.architecture, assignments);
  const editModels = entries.filter((entry) => entry.family === 'qwen21');
  const size = `${settings.width}x${settings.height}`;
  const label = (path: string) => path.split(/[\\/]/).at(-1) || path;
  const updateCharacter = (id: string, patch: Partial<Scenario['characters'][number]>) =>
    onChange({ characters: characters.map((c) => (c.id === id ? { ...c, ...patch } : c)) });
  return (
    <details
      className="scenario-panel scenario-settings"
      open={!scenario.scenes.length || undefined}
    >
      <summary>
        <SlidersHorizontal size={17} aria-hidden="true" />
        <span>공통 설정</span>
        <small>{installed ? familyLabels[installed.family] : '모델 선택'}</small>
      </summary>
      <fieldset disabled={disabled} className="scenario-settings-content">
        <label className="scenario-field">
          <span>기본 모델</span>
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
                if (entry) onChange({ settings: selectModel(settings, entry, info, assignments) });
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
          <span>화면 비율</span>
          <SelectControl
            aria-label="화면 비율"
            value={size}
            onChange={(e) => {
              const selected = ratios.find(
                (ratio) => `${ratio.width}x${ratio.height}` === e.target.value,
              );
              if (selected)
                onChange({
                  settings: { ...settings, width: selected.width, height: selected.height },
                });
            }}
          >
            {!ratios.some((ratio) => `${ratio.width}x${ratio.height}` === size) && (
              <option value={size}>
                {settings.width} × {settings.height}
              </option>
            )}
            {ratios.map(({ label, width, height }) => (
              <option key={label} value={`${width}x${height}`}>
                {label}
              </option>
            ))}
          </SelectControl>
        </label>
        <label className="scenario-field">
          <span>편집 모델</span>
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
        <label className="scenario-field scenario-wide">
          <span>
            공통 화풍 <small>선택</small>
          </span>
          <textarea
            className="field"
            rows={2}
            maxLength={3000}
            value={scenario.style}
            placeholder="예: 빛바랜 필름 색감과 낮은 채도"
            onChange={(e) => onChange({ style: e.target.value })}
          />
        </label>
        <div className="scenario-wide scenario-characters">
          <div className="scenario-section-title">
            <h3>캐릭터</h3>
            <button
              type="button"
              className="btn-secondary scenario-touch"
              disabled={characters.length >= 20}
              onClick={() =>
                onChange({
                  characters: [
                    ...characters,
                    {
                      id: newId(),
                      name: '',
                      lora: '',
                      description: '',
                      trigger: '',
                      strength: 0.8,
                    },
                  ],
                })
              }
            >
              <Plus size={15} aria-hidden="true" /> 캐릭터 추가
            </button>
          </div>
          {characters.map((character, index) => (
            <div className="scenario-character" key={character.id}>
              <div className="scenario-section-title">
                <label className="scenario-field grow">
                  <span>캐릭터 {index + 1} 이름</span>
                  <input
                    className="field"
                    value={character.name}
                    maxLength={80}
                    placeholder="이름"
                    onChange={(e) => updateCharacter(character.id, { name: e.target.value })}
                  />
                </label>
                <IconButton
                  icon={Trash2}
                  danger
                  label={`캐릭터 ${index + 1} 삭제`}
                  className="scenario-touch self-end"
                  onClick={() =>
                    onChange({ characters: characters.filter((c) => c.id !== character.id) })
                  }
                />
              </div>
              <label className="scenario-field">
                <span>캐릭터 묘사</span>
                <textarea
                  className="field"
                  rows={2}
                  maxLength={1000}
                  value={character.description}
                  placeholder="예: 짧은 검은 머리, 연한 회색 코트"
                  onChange={(e) => updateCharacter(character.id, { description: e.target.value })}
                />
              </label>
              <label className="scenario-field">
                <span>캐릭터 LoRA</span>
                <SelectControl
                  aria-label="캐릭터 LoRA"
                  value={character.lora}
                  onChange={(e) => updateCharacter(character.id, { lora: e.target.value })}
                >
                  <option value="">LoRA 없이 묘사만 사용</option>
                  {character.lora && !loras.includes(character.lora) && (
                    <option value={character.lora}>
                      {label(character.lora)} (현재 계열과 다름)
                    </option>
                  )}
                  {loras.map((name) => (
                    <option key={name} value={name}>
                      {label(name)}
                    </option>
                  ))}
                </SelectControl>
              </label>
              {character.lora && (
                <div className="scenario-lora-controls">
                  <label className="scenario-field">
                    <span>트리거 단어</span>
                    <input
                      className="field"
                      value={character.trigger}
                      maxLength={250}
                      onChange={(e) => updateCharacter(character.id, { trigger: e.target.value })}
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
                          updateCharacter(character.id, { strength: e.target.valueAsNumber });
                      }}
                    />
                  </label>
                </div>
              )}
            </div>
          ))}
        </div>
      </fieldset>
    </details>
  );
}
