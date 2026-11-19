import { Check, Image, LoaderCircle, Scan, Upload, WandSparkles } from 'lucide-react';
import { thumbnailUrl } from '../api';
import type { Job } from '../domain';
import {
  featuredImage,
  scenarioPromptInput,
  sceneTitle,
  type Scenario,
  type Scene,
  type SceneImage,
} from '../scenario';
import { SelectControl } from './ui';

export function ScenarioScene({
  project,
  scene,
  index,
  job,
  action,
  draft,
  checked,
  message,
  onChange,
  onConvert,
  onUpload,
  onGenerate,
  onCheck,
  onPreview,
}: {
  project: Scenario;
  scene: Scene;
  index: number;
  job?: Job;
  action: string | null;
  draft?: string;
  checked: boolean;
  message?: string;
  onChange: (patch: Partial<Scene>) => void;
  onConvert: () => void;
  onUpload: (file: File) => void;
  onGenerate: () => void;
  onCheck: () => void;
  onPreview: (image: SceneImage) => void;
}) {
  const promptContext = JSON.stringify(scenarioPromptInput(project, scene));
  const promptChanged = Boolean(scene.prompt && scene.promptContext !== promptContext);
  const previousCuts = project.scenes.slice(0, index).flatMap((source, i) => {
    const image = featuredImage(source);
    return image
      ? [{ ...image, sceneId: source.id, label: `씬 ${i + 1} | ${sceneTitle(source)}` }]
      : [];
  });
  const pinned = scene.reference;
  const sourceScene = project.scenes.find(({ id }) => id === pinned?.sceneId);
  const referenceChanged =
    pinned?.sceneId && (!sourceScene || featuredImage(sourceScene)?.id !== pinned.id);
  const current = pinned && previousCuts.some((image) => image.id === pinned.id);
  const pending = job && ['submitting', 'queued', 'running'].includes(job.status);
  const disabled = Boolean(action);
  const isConverting = action === 'prompt:' + scene.id;
  return (
    <div className="scenario-panel scenario-scene-editor">
      <fieldset disabled={disabled} className="scenario-editor-fields">
        <label className="scenario-field">
          <span>씬 이름</span>
          <input
            className="field"
            maxLength={80}
            value={scene.title}
            placeholder={`씬 ${index + 1}`}
            onChange={(e) => onChange({ title: e.target.value })}
          />
        </label>
        <div className="scenario-mode" role="group" aria-label="생성 방식">
          <button
            type="button"
            aria-pressed={scene.mode === 'create'}
            onClick={() => onChange({ mode: 'create' })}
          >
            새로 생성
          </button>
          <button
            type="button"
            aria-pressed={scene.mode === 'edit'}
            onClick={() => onChange({ mode: 'edit' })}
          >
            이미지로 이어 만들기
          </button>
        </div>
        {scene.mode === 'edit' && (
          <div className="scenario-reference">
            <div className="scenario-section-title">
              <label className="scenario-field grow">
                <span>참조 이미지</span>
                <SelectControl
                  aria-label="참조 이미지"
                  value={pinned?.id || ''}
                  onChange={(event) => {
                    const next = previousCuts.find(({ id }) => id === event.target.value);
                    onChange({ reference: next || null });
                  }}
                >
                  <option value="">참조 이미지 선택</option>
                  {pinned && !current && (
                    <option value={pinned.id}>
                      {pinned.sceneId ? '고정한 이전 컷' : '업로드한 이미지'}
                    </option>
                  )}
                  {previousCuts.map((image) => (
                    <option key={image.id} value={image.id}>
                      {image.label}
                    </option>
                  ))}
                </SelectControl>
              </label>
              <label
                className="btn-secondary scenario-touch scenario-upload self-end"
                aria-busy={action === 'upload:' + scene.id || undefined}
              >
                {action === 'upload:' + scene.id ? (
                  <LoaderCircle size={15} className="animate-spin" aria-hidden="true" />
                ) : (
                  <Upload size={15} aria-hidden="true" />
                )}
                업로드
                <input
                  type="file"
                  aria-label="참조 이미지 업로드"
                  accept="image/png,image/jpeg,image/webp"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) onUpload(file);
                    e.target.value = '';
                  }}
                />
              </label>
            </div>
            {pinned && (
              <div className="scenario-reference-preview">
                <button
                  type="button"
                  className="scenario-reference-image"
                  aria-label="참조 이미지 크게 보기"
                  onClick={() => onPreview(pinned)}
                >
                  <img src={thumbnailUrl(pinned.base, pinned.image)} alt="" />
                </button>
                <p>
                  {referenceChanged ? '이전 컷 참조 중' : '이 이미지에 참조를 고정했어요'}
                  <br />
                  공통 화면 비율에 맞춰 중앙을 사용해요
                </p>
              </div>
            )}
            {!pinned && !previousCuts.length && (
              <p className="scenario-hint">앞 씬에서 대표 컷을 고르거나 사진을 업로드해 주세요.</p>
            )}
          </div>
        )}
        {project.characters.length > 0 && (
          <div className="scenario-field">
            <span id={`cast-${scene.id}`}>등장 캐릭터</span>
            <div className="scenario-cast" role="group" aria-labelledby={`cast-${scene.id}`}>
              {project.characters.map((character, i) => {
                const selected = scene.characters.includes(character.id);
                return (
                  <button
                    type="button"
                    key={character.id}
                    aria-pressed={selected}
                    onClick={() =>
                      onChange({
                        characters: selected
                          ? scene.characters.filter((id) => id !== character.id)
                          : [...scene.characters, character.id],
                      })
                    }
                  >
                    {selected && <Check size={14} aria-hidden="true" />}
                    {character.name.trim() || `캐릭터 ${i + 1}`}
                  </button>
                );
              })}
            </div>
          </div>
        )}
        <label className="scenario-field">
          <span>장면 묘사</span>
          <textarea
            className="field scenario-description"
            rows={4}
            maxLength={8000}
            value={scene.description}
            placeholder="예: 카페 창가에서 우산을 든 사람들을 바라본다."
            onChange={(e) => onChange({ description: e.target.value })}
          />
        </label>
        <div className="scenario-section-title scenario-prompt-heading">
          <span id={`prompt-${scene.id}`}>생성 프롬프트</span>
          <button
            type="button"
            className="btn-secondary scenario-touch"
            aria-busy={isConverting || undefined}
            disabled={!scene.description.trim()}
            onClick={onConvert}
          >
            {isConverting ? (
              <LoaderCircle size={15} className="animate-spin" aria-hidden="true" />
            ) : (
              <WandSparkles size={15} aria-hidden="true" />
            )}
            {isConverting ? '만드는 중' : scene.prompt.trim() ? 'AI로 다시 작성' : 'AI로 만들기'}
          </button>
        </div>
        {promptChanged && (
          <p className="scenario-hint scenario-attention">
            묘사 또는 공통 설정이 바뀌었어요. 이 프롬프트를 유지하거나 다시 작성할 수 있어요.
          </p>
        )}
        <textarea
          className="field scenario-prompt"
          rows={3}
          value={scene.prompt}
          maxLength={8000}
          aria-labelledby={`prompt-${scene.id}`}
          placeholder="AI 프롬프트가 여기에 표시돼요. 직접 입력할 수도 있어요."
          onChange={(e) => onChange({ prompt: e.target.value, promptContext })}
        />
        {draft && (
          <div className="scenario-draft">
            <p className="font-bold">AI가 새로 작성한 프롬프트</p>
            <p className="scenario-draft-text">{draft}</p>
            <button
              type="button"
              className="btn-secondary scenario-touch"
              onClick={() => onChange({ prompt: draft, promptContext })}
            >
              이 프롬프트 적용
            </button>
          </div>
        )}
        <div className="scenario-generate-row" data-ui-audit-row>
          <SelectControl
            aria-label="후보 장 수"
            value={scene.count}
            onChange={(e) => onChange({ count: Number(e.target.value) })}
          >
            {[1, 2, 3, 4].map((count) => (
              <option key={count} value={count}>
                후보 {count}장
              </option>
            ))}
          </SelectControl>
          {job?.submissionUncertain && !checked ? (
            <button
              type="button"
              className="btn-secondary scenario-touch"
              aria-busy={action === 'check:' + scene.id || undefined}
              onClick={onCheck}
            >
              {action === 'check:' + scene.id && (
                <LoaderCircle size={15} className="animate-spin" aria-hidden="true" />
              )}
              서버 작업 확인
            </button>
          ) : (
            <button
              type="button"
              className="btn-primary scenario-touch"
              aria-busy={Boolean(pending) || action === 'generate:' + scene.id || undefined}
              disabled={Boolean(pending) || !(scene.description.trim() || scene.prompt.trim())}
              onClick={onGenerate}
            >
              {pending || action === 'generate:' + scene.id ? (
                <LoaderCircle size={16} className="animate-spin" aria-hidden="true" />
              ) : (
                <Image size={16} aria-hidden="true" />
              )}
              {job?.status === 'running'
                ? `생성 중 ${job.progress}%`
                : pending
                  ? '대기 중'
                  : job?.submissionUncertain
                    ? '확인 후 다시 생성'
                    : scene.candidates.length
                      ? '이 씬 다시 생성'
                      : '이 씬 생성'}
            </button>
          )}
        </div>
      </fieldset>
      {(message || job?.status === 'error') && (
        <p role="status" className="scenario-error">
          {message || job?.error || '생성 설정을 확인해 주세요.'}
        </p>
      )}
      {scene.candidates.length > 0 && (
        <section className="scenario-candidates" aria-label="생성 후보">
          <div className="scenario-section-title">
            <h3>
              생성 후보 <small>{scene.candidates.length}장</small>
            </h3>
            {!scene.featuredId && <span className="scenario-hint">대표 컷을 골라 주세요</span>}
          </div>
          <div className="scenario-candidate-grid" data-ui-audit-card-group>
            {[...scene.candidates].reverse().map((candidate, i) => {
              const featured = candidate.id === scene.featuredId;
              const label = `후보 ${scene.candidates.length - i}`;
              return (
                <div
                  key={candidate.id}
                  className="scenario-candidate"
                  data-featured={featured}
                  data-ui-audit-card
                >
                  <button
                    type="button"
                    className="scenario-candidate-image"
                    aria-label={`${label} 크게 보기`}
                    onClick={() => onPreview(candidate)}
                  >
                    <img
                      loading="lazy"
                      src={thumbnailUrl(candidate.base, candidate.image)}
                      alt=""
                    />
                    <Scan size={15} aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    className="scenario-candidate-pick"
                    aria-label={`${label} 대표 컷으로 선택`}
                    aria-pressed={featured}
                    onClick={() => onChange({ featuredId: candidate.id })}
                  >
                    {featured ? (
                      <>
                        <Check size={15} aria-hidden="true" /> 대표 컷
                      </>
                    ) : (
                      '대표 컷 선택'
                    )}
                  </button>
                </div>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}
