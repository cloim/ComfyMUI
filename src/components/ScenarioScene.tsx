import { useRef } from 'react';
import {
  Check,
  CircleAlert,
  Image,
  ImagePlus,
  LoaderCircle,
  Scan,
  Upload,
  UserRound,
  WandSparkles,
} from 'lucide-react';
import { thumbnailUrl } from '../api';
import { DraftInput, DraftTextarea } from './DraftField';
import type { Job } from '../domain';
import type { ModelEntry } from '../models';
import {
  characterReferences,
  charactersMissingImages,
  featuredImage,
  mentionsCharacter,
  promptContextKey,
  promptStale,
  sceneTitle,
  uncastCharacters,
  type Scenario,
  type Scene,
  type SceneImage,
} from '../scenario';
import { FieldError, SelectControl } from './ui';

const viewLabels = { face: '얼굴', body: '전신', extra: '추가' };

export function ScenarioScene({
  project,
  scene,
  index,
  job,
  action,
  draft,
  checked,
  message,
  editModels,
  defaultEditModel,
  onChange,
  onConvert,
  onUpload,
  onGenerate,
  onCheck,
  onPreview,
  onOpenCharacter,
}: {
  project: Scenario;
  scene: Scene;
  index: number;
  job?: Job;
  action: string | null;
  draft?: string;
  checked: boolean;
  message?: string;
  editModels: ModelEntry[];
  defaultEditModel?: ModelEntry;
  onChange: (patch: Partial<Scene>) => void;
  onConvert: () => void;
  onUpload: (file: File) => void;
  onGenerate: () => void;
  onCheck: () => void;
  onPreview: (image: SceneImage) => void;
  onOpenCharacter: (id: string) => void;
}) {
  const generateRow = useRef<HTMLDivElement>(null);
  const promptContext = promptContextKey(project, scene);
  const promptChanged = promptStale(project, scene);
  const uncast = uncastCharacters(project, scene);
  const references = characterReferences(project, scene);
  const missing = charactersMissingImages(project, scene);
  const error =
    message || (job?.status === 'error' ? job.error || '생성 설정을 확인해 주세요.' : '');
  const errorId = `scene-error-${scene.id}`;
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
  const isEdit = scene.mode === 'edit';
  const cast = project.characters.filter((c) => scene.characters.includes(c.id));
  const extrasOnOffer = cast.flatMap((c) =>
    (c.extras || []).map((image, i) => ({ character: c, image, label: `추가 ${i + 1}` })),
  );
  const chosenExtras = new Set(scene.extraRefs || []);

  return (
    <div className="scenario-scene-editor">
      <fieldset disabled={disabled} className="scenario-scene-form">
        <div className="scenario-row scenario-scene-top">
          <label className="scenario-field grow">
            <span>씬 이름</span>
            <DraftInput
              className="field"
              maxLength={80}
              value={scene.title}
              placeholder={`씬 ${index + 1}`}
              onValueChange={(title) => onChange({ title })}
            />
          </label>
          <div className="scenario-field">
            <span id={`mode-${scene.id}`}>생성 방식</span>
            <div className="scenario-mode" role="group" aria-labelledby={`mode-${scene.id}`}>
              <button
                type="button"
                aria-pressed={!isEdit}
                onClick={() => onChange({ mode: 'create' })}
              >
                새로 생성
              </button>
              <button
                type="button"
                aria-pressed={isEdit}
                onClick={() => onChange({ mode: 'edit' })}
              >
                이미지로 이어 만들기
              </button>
            </div>
          </div>
        </div>
        <p className="scenario-hint scenario-mode-hint">
          {isEdit
            ? '이전 컷과 캐릭터의 정면 이미지를 참고해 편집 모델로 만들어요.'
            : '기본 모델과 캐릭터 LoRA로 장면을 새로 만들어요.'}
        </p>

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
                    {selected ? (
                      <Check size={14} aria-hidden="true" />
                    ) : (
                      character.face && (
                        <img
                          className="scenario-cast-avatar"
                          src={thumbnailUrl(character.face.base, character.face.image)}
                          alt=""
                        />
                      )
                    )}
                    {character.name.trim() || `캐릭터 ${i + 1}`}
                  </button>
                );
              })}
            </div>
            {uncast.length > 0 ? (
              <div className="scenario-stale">
                <p className="scenario-hint scenario-attention">
                  장면 묘사에 나온 {uncast.map((c) => c.name.trim()).join(', ')}이(가) 등장 캐릭터로
                  선택되지 않았어요. 선택해야 LoRA, 트리거 단어와 캐릭터 묘사가 반영돼요.
                </p>
                <button
                  type="button"
                  className="btn-secondary scenario-touch"
                  onClick={() =>
                    onChange({ characters: [...scene.characters, ...uncast.map((c) => c.id)] })
                  }
                >
                  등장 캐릭터로 선택
                </button>
              </div>
            ) : (
              !isEdit && (
                <p className="scenario-hint">
                  선택한 캐릭터의 LoRA, 트리거 단어와 묘사가 적용돼요. 장면 묘사에 이름을 쓰면
                  자동으로 선택돼요.
                </p>
              )
            )}
          </div>
        )}

        <label className="scenario-field">
          <span>장면 묘사</span>
          <DraftTextarea
            className="field scenario-description"
            rows={4}
            maxLength={8000}
            value={scene.description}
            placeholder="예: 카페 창가에서 우산을 든 사람들을 바라본다."
            onValueChange={(description) => {
              // A character named for the first time joins the cast. One the user removed
              // stays removed while the name was already there.
              const added = project.characters
                .filter(
                  (c) =>
                    !scene.characters.includes(c.id) &&
                    !mentionsCharacter(scene.description, c) &&
                    mentionsCharacter(description, c),
                )
                .map((c) => c.id);
              onChange(
                added.length
                  ? { description, characters: [...new Set([...scene.characters, ...added])] }
                  : { description },
              );
            }}
          />
        </label>

        {isEdit && (
          <section className="scenario-subcard" aria-label="이어 만들기 참조">
            <div className="scenario-row">
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
            {pinned ? (
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
                  <strong>&lt;image1&gt;</strong>{' '}
                  {referenceChanged ? '이전 컷 참조 중' : '이 이미지에 참조를 고정했어요'}
                  <br />
                  공통 화면 비율에 맞춰 중앙을 사용해요
                </p>
              </div>
            ) : (
              !previousCuts.length && (
                <p className="scenario-hint">
                  앞 씬에서 대표 컷을 고르거나 사진을 업로드해 주세요.
                </p>
              )
            )}

            {cast.length > 0 && (
              <div className="scenario-field">
                <span>캐릭터 참조</span>
                {references.length > 0 && (
                  <ul className="scenario-refs" aria-label="함께 보내는 캐릭터 이미지">
                    {references.map(({ character, image, view, tag }) => (
                      <li key={tag}>
                        <button
                          type="button"
                          aria-label={`${character.name.trim()} ${viewLabels[view]} 크게 보기`}
                          onClick={() => onPreview(image)}
                        >
                          <img src={thumbnailUrl(image.base, image.image)} alt="" />
                        </button>
                        <span>
                          <strong>{tag}</strong>
                          {character.name.trim() || '캐릭터'} {viewLabels[view]}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
                {missing.map((c) => (
                  <div key={c.id} className="scenario-stale">
                    <p className="scenario-hint scenario-attention">
                      <CircleAlert size={13} aria-hidden="true" className="inline align-[-2px]" />{' '}
                      {c.name.trim() || '이름 없는 캐릭터'}의{' '}
                      {[!c.face && '얼굴', !c.body && '전신'].filter(Boolean).join('·')} 정면
                      이미지가 필요해요.
                    </p>
                    <button
                      type="button"
                      className="btn-secondary scenario-touch"
                      onClick={() => onOpenCharacter(c.id)}
                    >
                      <UserRound size={15} aria-hidden="true" /> 캐릭터 설정 열기
                    </button>
                  </div>
                ))}
                {extrasOnOffer.length > 0 && (
                  <div className="scenario-extra-picks" role="group" aria-label="추가 참조 이미지">
                    {extrasOnOffer.map(({ character, image, label }) => {
                      const on = chosenExtras.has(image.id);
                      return (
                        <button
                          type="button"
                          key={image.id}
                          aria-pressed={on}
                          aria-label={`${character.name.trim()} ${label} 참조에 추가`}
                          onClick={() =>
                            onChange({
                              extraRefs: on
                                ? (scene.extraRefs || []).filter((id) => id !== image.id)
                                : [...(scene.extraRefs || []), image.id],
                            })
                          }
                        >
                          <img src={thumbnailUrl(image.base, image.image)} alt="" />
                          {on && <Check size={13} aria-hidden="true" />}
                        </button>
                      );
                    })}
                    <span className="scenario-hint">
                      <ImagePlus size={13} aria-hidden="true" className="inline align-[-2px]" />{' '}
                      추가 이미지는 골라서 함께 보낼 수 있어요
                    </span>
                  </div>
                )}
              </div>
            )}

            <label className="scenario-field">
              <span>편집 모델</span>
              <SelectControl
                aria-label="이 씬의 편집 모델"
                value={scene.editModelId || ''}
                onChange={(e) => onChange({ editModelId: e.target.value || undefined })}
              >
                <option value="">
                  공통 설정 기본값
                  {defaultEditModel ? ` (${defaultEditModel.name.split(/[\\/]/).at(-1)})` : ''}
                </option>
                {editModels.map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    {entry.name}
                  </option>
                ))}
              </SelectControl>
            </label>
          </section>
        )}

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
          <div className="scenario-stale">
            <p className="scenario-hint scenario-attention">
              묘사 또는 공통 설정이 바뀌었어요. 이 프롬프트를 유지하거나 다시 작성할 수 있어요.
            </p>
            <button
              type="button"
              className="btn-secondary scenario-touch"
              onClick={() => onChange({ promptContext })}
            >
              이 프롬프트 유지
            </button>
          </div>
        )}
        <DraftTextarea
          className="field scenario-prompt"
          rows={4}
          value={scene.prompt}
          maxLength={8000}
          aria-labelledby={`prompt-${scene.id}`}
          placeholder="AI 프롬프트가 여기에 표시돼요. 직접 입력할 수도 있어요."
          onValueChange={(prompt) => onChange({ prompt, promptContext, promptSource: 'manual' })}
        />
        {draft && (
          <div className="scenario-draft">
            <p className="font-bold">AI가 새로 작성한 프롬프트</p>
            <p className="scenario-draft-text">{draft}</p>
            <button
              type="button"
              className="btn-secondary scenario-touch"
              onClick={() => onChange({ prompt: draft, promptContext, promptSource: 'ai' })}
            >
              이 프롬프트 적용
            </button>
          </div>
        )}
        <div ref={generateRow} className="scenario-generate-row" data-ui-audit-row>
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
              aria-describedby={error ? errorId : undefined}
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
      <FieldError anchor={generateRow} message={error} id={errorId} />

      <div className="scenario-results">
        {scene.candidates.length > 0 ? (
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
        ) : (
          <div className="scenario-results-empty">
            <Image size={24} strokeWidth={1.5} aria-hidden="true" />
            <p>
              {pending
                ? job?.status === 'running'
                  ? `생성 중 ${job.progress}%`
                  : '생성 대기 중이에요'
                : '생성한 후보가 여기에 표시돼요. 마음에 드는 컷을 대표 컷으로 골라 주세요.'}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
