import { useMemo, useRef, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  Check,
  ChevronLeft,
  Clapperboard,
  Film,
  Image,
  Layers2,
  List,
  LoaderCircle,
  Plus,
  SlidersHorizontal,
  Trash2,
} from 'lucide-react';
import { imageUrl, thumbnailUrl } from '../api';
import { HeaderActions } from '../components/HeaderActions';
import { ImageViewer } from '../components/ImageViewer';
import { ScenarioScene } from '../components/ScenarioScene';
import { ScenarioSettings, type CharacterImageTarget } from '../components/ScenarioSettings';
import { IconButton, Modal, SelectControl } from '../components/ui';
import { DraftInput } from '../components/DraftField';
import { reorderQueue, type Job } from '../domain';
import { catalog, isVideoFamily, selectModel } from '../models';
import {
  CHARACTER_SHOTS,
  characterJobId,
  characterShotGeneration,
  characterShotPromptInput,
  convertScenarioPrompt,
  featuredImage,
  newScenario,
  newScene,
  promptStale,
  scenarioPromptInput,
  sceneGeneration,
  sceneRevision,
  sceneTitle,
  uploadSceneReference,
  type CharacterSlot,
  type Scenario as ScenarioRecord,
  type Scene,
  type SceneImage,
} from '../scenario';
import { useStudioSelector } from '../studio';
import './scenario.css';

type Scope = 'all' | 'missing' | 'changed';
type Tab = 'settings' | 'scenes' | 'board';
const tabs: { id: Tab; label: string; icon: typeof Film }[] = [
  { id: 'settings', label: '공통 설정', icon: SlidersHorizontal },
  { id: 'scenes', label: '씬 편집', icon: Layers2 },
  { id: 'board', label: '스토리보드', icon: Film },
];
const scopes: Record<Scope, string> = {
  all: '전체 씬',
  missing: '이미지 없는 씬',
  changed: '수정한 씬',
};
const pending = (job?: Job) =>
  Boolean(job && ['submitting', 'queued', 'running'].includes(job.status));

const OPEN_SCENARIO_KEY = 'cm-scenario-open';
function readOpenScenario() {
  try {
    return sessionStorage.getItem(OPEN_SCENARIO_KEY) || '';
  } catch {
    return '';
  }
}
function writeOpenScenario(id: string) {
  try {
    if (id) sessionStorage.setItem(OPEN_SCENARIO_KEY, id);
    else sessionStorage.removeItem(OPEN_SCENARIO_KEY);
  } catch {
    /* Private browsing can restrict session storage. */
  }
}

export default function Scenario() {
  const {
    scenarios,
    setScenarios,
    settings,
    scenarioAction,
    runScenarioAction,
    jobs,
    generate,
    checkSubmission,
    info,
    familyAssignments,
    modelOrder,
    connectionState,
    connection,
    notify,
  } = useStudioSelector((s) => ({
    scenarios: s.scenarios,
    setScenarios: s.setScenarios,
    settings: s.settings,
    scenarioAction: s.scenarioAction,
    runScenarioAction: s.runScenarioAction,
    jobs: s.jobs,
    generate: s.generate,
    checkSubmission: s.checkSubmission,
    info: s.info,
    familyAssignments: s.familyAssignments,
    modelOrder: s.modelOrder,
    connectionState: s.connectionState,
    connection: s.connection,
    notify: s.notify,
  }));
  // The open scenario is kept for this browser tab, so a reload returns to it. Without one
  // the saved scenarios are listed.
  const [projectId, setProjectIdState] = useState(() => readOpenScenario());
  const setProjectId = (id: string) => {
    setProjectIdState(id);
    writeOpenScenario(id);
  };
  const [sceneId, setSceneId] = useState('');
  const [characterId, setCharacterId] = useState('');
  // A new scenario starts with its common settings; one with scenes opens on its scenes.
  const [tab, setTab] = useState<Tab>(() =>
    scenarios.find((item) => item.id === projectId)?.scenes.length ? 'scenes' : 'settings',
  );
  const [scope, setScope] = useState<Scope>('all');
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [checked, setChecked] = useState('');
  const [preview, setPreview] = useState<SceneImage | null>(null);
  const [remove, setRemove] = useState<'project' | 'scene' | null>(null);
  const editor = useRef<HTMLDivElement>(null);
  // Scenes are still images, so video families are left out.
  const entries = useMemo(
    () =>
      catalog(info, familyAssignments, modelOrder).filter((entry) => !isVideoFamily(entry.family)),
    [info, familyAssignments, modelOrder],
  );
  const latest = useMemo(() => {
    const map = new Map<string, Job>();
    for (const job of jobs) {
      if (job.scenario && !map.has(job.scenario.sceneId)) map.set(job.scenario.sceneId, job);
    }
    return map;
  }, [jobs]);
  const project = scenarios.find((item) => item.id === projectId);

  function openProject(id: string) {
    const next = scenarios.find((item) => item.id === id);
    setProjectId(id);
    setSceneId('');
    setTab(next?.scenes.length ? 'scenes' : 'settings');
  }
  const scene = project?.scenes.find((item) => item.id === sceneId) || project?.scenes[0];
  const index = project && scene ? project.scenes.indexOf(scene) : -1;
  const working = Boolean(scenarioAction);
  const editModels = entries.filter((entry) => entry.family === 'qwen21');
  const editModel = project?.editModelId
    ? editModels.find((entry) => entry.id === project.editModelId)
    : editModels.find(
        (entry) =>
          entry.name === project?.settings.model && entry.loader === project.settings.modelLoader,
      ) || editModels[0];
  // An edit scene may pick its own model; otherwise the scenario's default applies.
  const editModelFor = (target: Scene) =>
    (target.editModelId && editModels.find((entry) => entry.id === target.editModelId)) ||
    editModel;

  function createProject() {
    const draft = newScenario(settings);
    const model =
      entries.find(
        (entry) => entry.name === settings.model && entry.loader === settings.modelLoader,
      ) ||
      entries.find((entry) => entry.family === settings.architecture) ||
      entries[0];
    if (model) draft.settings = selectModel(draft.settings, model, info, familyAssignments);
    setScenarios((items) => [draft, ...items]);
    setProjectId(draft.id);
    setSceneId('');
    setTab('settings');
  }

  function updateProject(id: string, update: (value: ScenarioRecord) => ScenarioRecord) {
    setScenarios((items) => items.map((item) => (item.id === id ? update(item) : item)));
  }

  function updateScene(id: string, patch: Partial<Scene>) {
    if (!project) return;
    updateProject(project.id, (item) => ({
      ...item,
      scenes: item.scenes.map((entry) => (entry.id === id ? { ...entry, ...patch } : entry)),
    }));
    if ('prompt' in patch || 'description' in patch || 'mode' in patch || 'characters' in patch)
      setDrafts((items) => ({ ...items, [id]: '' }));
    setErrors((items) => (items[id] ? { ...items, [id]: '' } : items));
  }

  function openScene(id: string) {
    setSceneId(id);
    setTab('scenes');
    requestAnimationFrame(() => editor.current?.scrollIntoView({ block: 'nearest' }));
  }

  function addScene() {
    if (!project) return;
    const next = newScene();
    updateProject(project.id, (item) => ({ ...item, scenes: [...item.scenes, next] }));
    openScene(next.id);
  }

  function changeOrder(offset: number) {
    if (!project) return;
    updateProject(project.id, (item) => ({
      ...item,
      scenes: reorderQueue(item.scenes, index, index + offset),
    }));
  }

  function confirmRemove() {
    if (!project) return;
    if (remove === 'scene' && scene) {
      updateProject(project.id, (item) => ({
        ...item,
        scenes: item.scenes.filter(({ id }) => id !== scene.id),
      }));
      setSceneId(project.scenes[index + 1]?.id || project.scenes[index - 1]?.id || '');
    } else {
      setScenarios((items) => items.filter(({ id }) => id !== project.id));
      setProjectId('');
      setSceneId('');
    }
    setRemove(null);
  }

  async function convert(target: Scene) {
    if (!project) return;
    await runScenarioAction('prompt:' + target.id, async () => {
      setErrors((items) => ({ ...items, [target.id]: '' }));
      try {
        const input = scenarioPromptInput(project, target);
        const prompt = await convertScenarioPrompt(input);
        if (target.prompt.trim()) {
          setDrafts((items) => ({ ...items, [target.id]: prompt }));
        } else {
          updateScene(target.id, {
            prompt,
            promptContext: JSON.stringify(input),
            promptSource: 'ai',
          });
        }
      } catch (error) {
        setErrors((items) => ({ ...items, [target.id]: (error as Error).message }));
      }
    });
  }

  async function upload(target: Scene, file: File) {
    await runScenarioAction('upload:' + target.id, async () => {
      try {
        updateScene(target.id, { reference: await uploadSceneReference(connection.base, file) });
      } catch (error) {
        setErrors((items) => ({ ...items, [target.id]: (error as Error).message }));
      }
    });
  }

  async function uploadCharacterImage(id: string, target: CharacterImageTarget, file: File) {
    if (!project) return;
    const projectKey = project.id;
    await runScenarioAction(`character:${id}:${target}`, async () => {
      try {
        const image = await uploadSceneReference(connection.base, file);
        updateProject(projectKey, (item) => ({
          ...item,
          characters: item.characters.map((c) =>
            c.id !== id
              ? c
              : target === 'extra'
                ? { ...c, extras: [...(c.extras || []), image] }
                : { ...c, [target]: image },
          ),
        }));
        setErrors(({ [id]: _done, ...rest }) => rest);
      } catch (error) {
        setErrors((items) => ({ ...items, [id]: (error as Error).message }));
      }
    });
  }

  // Renders a character's front image with the base model and LoRA. The finished image
  // fills the slot through collectSceneResults.
  async function generateCharacterImage(id: string, slot: CharacterSlot) {
    const character = project?.characters.find((c) => c.id === id);
    if (!project || !character) return;
    if (connectionState !== 'connected') {
      notify('ComfyUI 서버 연결을 확인해 주세요');
      return;
    }
    await runScenarioAction(`shot:${id}:${slot}`, async () => {
      try {
        let prompt: string;
        try {
          prompt = await convertScenarioPrompt(characterShotPromptInput(project, character, slot));
        } catch {
          // Without the AI writer the fixed English shot description still works.
          prompt = CHARACTER_SHOTS[slot].fallback;
        }
        const input = characterShotGeneration(
          project,
          character,
          slot,
          prompt,
          info,
          familyAssignments,
          connection.base,
        );
        const ok = await generate(input, { sceneId: characterJobId(id, slot), revision: '' });
        if (!ok) throw new Error('모델 설치 목록과 생성 설정을 확인한 후 다시 시도해 주세요');
        setErrors(({ [id]: _done, ...rest }) => rest);
      } catch (error) {
        setErrors((items) => ({ ...items, [id]: (error as Error).message }));
      }
    });
  }

  function openCharacter(id: string) {
    setCharacterId(id);
    setTab('settings');
  }

  async function submit(targets: Scene[], bulk: boolean) {
    if (!project || !targets.length) return;
    if (connectionState !== 'connected') {
      notify('ComfyUI 서버 연결을 확인해 주세요');
      return;
    }
    await runScenarioAction(bulk ? 'batch' : 'generate:' + targets[0].id, async () => {
      let submitted = 0;
      let failed = 0;
      for (const target of targets) {
        setErrors((items) => ({ ...items, [target.id]: '' }));
        try {
          let prepared = target;
          const stale = bulk && promptStale(project, target);
          // A manual prompt is the user's own wording: bulk runs never rewrite it.
          if (stale && target.promptSource !== 'ai')
            throw new Error(
              '장면 묘사 또는 공통 설정이 바뀌었어요. 직접 입력한 프롬프트를 유지하거나 고친 뒤 생성해 주세요',
            );
          if (!target.prompt.trim() || stale) {
            const input = scenarioPromptInput(project, target);
            const prompt = await convertScenarioPrompt(input);
            const patch = {
              prompt,
              promptContext: JSON.stringify(input),
              promptSource: 'ai' as const,
            };
            updateScene(target.id, patch);
            prepared = { ...target, ...patch };
          }
          const input = sceneGeneration(
            project,
            bulk ? { ...prepared, count: 1 } : prepared,
            editModelFor(prepared),
            info,
            familyAssignments,
            connection.base,
          );
          const ok = await generate(input, {
            sceneId: target.id,
            revision: sceneRevision(project, prepared),
          });
          if (!ok) throw new Error('모델 설치 목록과 생성 설정을 확인한 후 다시 시도해 주세요');
          submitted++;
        } catch (error) {
          failed++;
          setErrors((items) => ({ ...items, [target.id]: (error as Error).message }));
          // The other scenes can use prompts and references that are already available.
        }
      }
      if (bulk || submitted) {
        notify(
          [
            submitted ? `${submitted}개 씬을 생성 대기열에 등록했어요` : '',
            failed ? `${failed}개 씬의 설정을 확인해 주세요` : '',
          ]
            .filter(Boolean)
            .join('\n'),
        );
      }
    });
  }

  const targets =
    project?.scenes.filter((target) => {
      const job = latest.get(target.id);
      if (
        pending(job) ||
        job?.submissionUncertain ||
        !(target.prompt.trim() || target.description.trim())
      )
        return false;
      if (scope === 'missing') return !target.candidates.length;
      if (scope === 'changed')
        return (
          target.candidates.length > 0 && target.renderedRevision !== sceneRevision(project, target)
        );
      return true;
    }) || [];
  const chosenCount = project?.scenes.filter((item) => item.featuredId).length || 0;

  return (
    <div className="scenario-page">
      <HeaderActions>
        <IconButton
          icon={Plus}
          label="새 시나리오 만들기"
          className="scenario-touch"
          disabled={working}
          onClick={createProject}
        />
      </HeaderActions>
      {!project && scenarios.length > 0 ? (
        <section className="scenario-list" aria-labelledby="scenario-list-title">
          <div className="scenario-list-head">
            <div>
              <h2 id="scenario-list-title">
                저장된 시나리오 <span className="scenario-tab-count">{scenarios.length}</span>
              </h2>
              <p className="scenario-hint">변경 내용은 자동으로 저장돼요.</p>
            </div>
            <button
              type="button"
              className="btn-primary scenario-touch"
              disabled={working}
              onClick={createProject}
            >
              <Plus size={16} aria-hidden="true" /> 새 시나리오
            </button>
          </div>
          <ul className="scenario-list-grid" aria-label="시나리오 목록">
            {scenarios.map((item) => {
              const cuts = item.scenes.flatMap((s) => {
                const cut = featuredImage(s);
                return cut ? [cut] : [];
              });
              const cover = cuts[0];
              const name = item.title.trim() || '이름 없는 시나리오';
              return (
                <li key={item.id}>
                  <button
                    type="button"
                    className="scenario-list-card"
                    aria-label={`${name} 열기`}
                    onClick={() => openProject(item.id)}
                  >
                    <span className="scenario-board-image">
                      {cover ? (
                        <img src={thumbnailUrl(cover.base, cover.image)} alt="" loading="lazy" />
                      ) : (
                        <Clapperboard size={22} strokeWidth={1.6} aria-hidden="true" />
                      )}
                    </span>
                    <span className="scenario-list-meta">
                      <strong>{name}</strong>
                      <span className="scenario-list-facts">
                        <span>씬 {item.scenes.length}개</span>
                        <span>대표 컷 {cuts.length}개</span>
                        <span>캐릭터 {item.characters.length}명</span>
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      ) : !project ? (
        <div className="scenario-start">
          <Clapperboard size={36} strokeWidth={1.5} aria-hidden="true" />
          <p>공통 모델과 화풍을 정하고, 씬을 추가해 스토리보드를 만들어 보세요.</p>
          <button type="button" className="btn-primary scenario-touch" onClick={createProject}>
            <Plus size={16} aria-hidden="true" /> 시나리오 만들기
          </button>
        </div>
      ) : (
        <>
          <div className="scenario-bar">
            <button
              type="button"
              className="btn-secondary scenario-touch scenario-back"
              onClick={() => {
                setProjectId('');
                setSceneId('');
              }}
            >
              <ChevronLeft size={16} aria-hidden="true" />
              <span>시나리오 목록</span>
            </button>
            <DraftInput
              className="field scenario-name"
              aria-label="시나리오 이름"
              value={project.title}
              maxLength={80}
              disabled={working}
              placeholder="시나리오 이름"
              onValueChange={(title) => updateProject(project.id, (p) => ({ ...p, title }))}
            />
            <p className="scenario-bar-facts">
              <span>씬 {project.scenes.length}개</span>
              <span>대표 컷 {chosenCount}개</span>
              <span>캐릭터 {project.characters.length}명</span>
            </p>
            <IconButton
              icon={Trash2}
              danger
              label="이 시나리오 삭제"
              className="scenario-touch"
              disabled={working || project.scenes.some((item) => pending(latest.get(item.id)))}
              onClick={() => setRemove('project')}
            />
          </div>
          <div role="tablist" aria-label="시나리오 작업" className="scenario-tabs">
            {tabs.map((item, i) => (
              <button
                key={item.id}
                type="button"
                role="tab"
                id={`scenario-tab-${item.id}`}
                aria-selected={tab === item.id}
                aria-controls="scenario-tabpanel"
                tabIndex={tab === item.id ? 0 : -1}
                onClick={() => setTab(item.id)}
                onKeyDown={(e) => {
                  const delta = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
                  if (!delta && !['Home', 'End'].includes(e.key)) return;
                  e.preventDefault();
                  const next =
                    e.key === 'Home'
                      ? 0
                      : e.key === 'End'
                        ? tabs.length - 1
                        : (i + delta + tabs.length) % tabs.length;
                  setTab(tabs[next].id);
                  (
                    e.currentTarget.parentElement!.querySelectorAll('[role=tab]')[
                      next
                    ] as HTMLButtonElement
                  ).focus();
                }}
              >
                <item.icon size={15} aria-hidden="true" />
                <span>{item.label}</span>
                {item.id === 'scenes' && project.scenes.length > 0 && (
                  <span className="scenario-tab-count">{project.scenes.length}</span>
                )}
                {item.id === 'board' && project.scenes.length > 0 && (
                  <span className="scenario-tab-count">
                    <span className="sr-only">대표 컷 </span>
                    {chosenCount}/{project.scenes.length}
                  </span>
                )}
              </button>
            ))}
          </div>
          <div
            id="scenario-tabpanel"
            role="tabpanel"
            aria-labelledby={`scenario-tab-${tab}`}
            className="scenario-workspace"
          >
            {tab === 'settings' && (
              <ScenarioSettings
                key={project.id}
                scenario={project}
                entries={entries}
                info={info}
                assignments={familyAssignments}
                editModel={editModel}
                loading={connectionState === 'connecting'}
                disabled={working}
                action={scenarioAction}
                errors={errors}
                shotJobs={latest}
                selectedCharacter={characterId}
                onSelectCharacter={setCharacterId}
                onCharacterImage={(id, target, file) => void uploadCharacterImage(id, target, file)}
                onGenerateCharacterImage={(id, slot) => void generateCharacterImage(id, slot)}
                onPreview={setPreview}
                onChange={(patch) => {
                  updateProject(project.id, (item) => ({ ...item, ...patch }));
                  setDrafts({});
                }}
              />
            )}
            {tab === 'board' &&
              (project.scenes.length > 0 ? (
                <ol className="scenario-board" aria-label="스토리보드" data-ui-audit-card-group>
                  {project.scenes.map((item, i) => {
                    const cut = featuredImage(item);
                    return (
                      <li key={item.id} data-ui-audit-card>
                        <button
                          type="button"
                          className="scenario-board-cut"
                          onClick={() => openScene(item.id)}
                        >
                          <span className="scenario-board-image">
                            {cut ? (
                              <img src={thumbnailUrl(cut.base, cut.image)} alt="" loading="lazy" />
                            ) : (
                              <Image size={22} strokeWidth={1.6} aria-hidden="true" />
                            )}
                          </span>
                          <span className="scenario-board-caption">
                            <span className="scenario-scene-number">
                              {String(i + 1).padStart(2, '0')}
                            </span>
                            <span>
                              {sceneTitle(item)}
                              <small>
                                {cut
                                  ? '씬 열기'
                                  : item.candidates.length
                                    ? '대표 컷 선택'
                                    : '첫 컷 만들기'}
                              </small>
                            </span>
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ol>
              ) : (
                <div className="scenario-empty">
                  <Film size={26} strokeWidth={1.5} aria-hidden="true" />
                  <h3>아직 씬이 없어요</h3>
                  <p>씬을 추가하고 대표 컷을 고르면 여기에서 순서대로 볼 수 있어요</p>
                </div>
              ))}
            {tab === 'scenes' && (
              <div className="scenario-edit-layout">
                <div className="scenario-rail">
                  {project.scenes.length > 0 && (
                    <ol className="scenario-scene-list" aria-label="씬 순서">
                      {project.scenes.map((item, i) => {
                        const featured = featuredImage(item);
                        const job = latest.get(item.id);
                        let state = item.candidates.length ? '대표 컷 선택' : '작성 중';
                        if (featured) state = '대표 컷 선택됨';
                        if (job?.status === 'error' || errors[item.id]) state = '확인 필요';
                        if (pending(job)) state = job?.status === 'running' ? '생성 중' : '대기 중';
                        return (
                          <li key={item.id}>
                            <button
                              type="button"
                              aria-current={scene?.id === item.id || undefined}
                              onClick={() => openScene(item.id)}
                            >
                              <span className="scenario-scene-thumb">
                                {featured ? (
                                  <img
                                    src={thumbnailUrl(featured.base, featured.image)}
                                    alt=""
                                    loading="lazy"
                                  />
                                ) : (
                                  <Image size={16} strokeWidth={1.6} aria-hidden="true" />
                                )}
                                <span className="scenario-scene-number">
                                  {String(i + 1).padStart(2, '0')}
                                </span>
                              </span>
                              <span className="scenario-scene-meta">
                                <span className="scenario-list-title">{sceneTitle(item)}</span>
                                <small data-state={state}>
                                  {item.mode === 'edit' ? '이어 만들기' : '새로 생성'} · {state}
                                </small>
                              </span>
                            </button>
                          </li>
                        );
                      })}
                    </ol>
                  )}
                  {project.scenes.length > 0 && (
                    <div className="scenario-order" aria-label="선택한 씬 관리" role="group">
                      <IconButton
                        icon={ArrowUp}
                        label="씬을 위로 이동"
                        className="scenario-touch"
                        disabled={working || index <= 0}
                        onClick={() => changeOrder(-1)}
                      />
                      <IconButton
                        icon={ArrowDown}
                        label="씬을 아래로 이동"
                        className="scenario-touch"
                        disabled={working || index >= project.scenes.length - 1}
                        onClick={() => changeOrder(1)}
                      />
                      <IconButton
                        icon={Trash2}
                        danger
                        label="선택한 씬 삭제"
                        className="scenario-touch"
                        disabled={working || pending(scene ? latest.get(scene.id) : undefined)}
                        onClick={() => setRemove('scene')}
                      />
                    </div>
                  )}
                </div>
                <div ref={editor} className="scenario-editor" key={scene?.id || 'empty'}>
                  {scene ? (
                    <ScenarioScene
                      project={project}
                      scene={scene}
                      index={index}
                      job={latest.get(scene.id)}
                      action={scenarioAction}
                      draft={drafts[scene.id]}
                      checked={checked === latest.get(scene.id)?.id}
                      message={errors[scene.id]}
                      onChange={(patch) => updateScene(scene.id, patch)}
                      onConvert={() => void convert(scene)}
                      onUpload={(file) => void upload(scene, file)}
                      onGenerate={() => void submit([scene], false)}
                      onCheck={() => {
                        const job = latest.get(scene.id);
                        if (!job) return;
                        void runScenarioAction('check:' + scene.id, async () => {
                          try {
                            if (!(await checkSubmission(job))) setChecked(job.id);
                          } catch (error) {
                            setErrors((items) => ({
                              ...items,
                              [scene.id]: (error as Error).message,
                            }));
                          }
                        });
                      }}
                      onPreview={setPreview}
                      editModels={editModels}
                      defaultEditModel={editModel}
                      onOpenCharacter={openCharacter}
                    />
                  ) : (
                    <div className="scenario-empty">
                      <Image size={26} strokeWidth={1.5} aria-hidden="true" />
                      <h3>첫 씬을 추가해 보세요</h3>
                      <p>장면을 한두 문장으로 적으면 AI 프롬프트로 바꿀 수 있어요</p>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
          {tab !== 'settings' && (
            <div className="scenario-footer">
              <button
                type="button"
                className="btn-secondary scenario-touch"
                disabled={working}
                onClick={addScene}
              >
                <Plus size={16} aria-hidden="true" /> 씬 추가
              </button>
              {project.scenes.length > 0 && (
                <div className="scenario-batch" data-ui-audit-row>
                  <SelectControl
                    aria-label="일괄 생성 범위"
                    value={scope}
                    disabled={working}
                    onChange={(e) => setScope(e.target.value as Scope)}
                  >
                    {Object.entries(scopes).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </SelectControl>
                  <button
                    type="button"
                    className="btn-primary scenario-touch"
                    aria-busy={scenarioAction === 'batch' || undefined}
                    disabled={working || !targets.length}
                    onClick={() => void submit(targets, true)}
                  >
                    {scenarioAction === 'batch' ? (
                      <LoaderCircle size={15} className="animate-spin" aria-hidden="true" />
                    ) : (
                      <Check size={15} aria-hidden="true" />
                    )}
                    {scenarioAction === 'batch' ? '등록 중' : `${targets.length}개 씬 생성`}
                  </button>
                </div>
              )}
            </div>
          )}
          {preview && (
            <ImageViewer
              src={imageUrl(preview.base, preview.image)}
              open
              onClose={() => setPreview(null)}
            />
          )}
          {remove && (
            <Modal
              open
              title={remove === 'scene' ? '이 씬을 삭제할까요?' : '이 시나리오를 삭제할까요?'}
              onClose={() => setRemove(null)}
              footer={
                <>
                  <button
                    type="button"
                    className="btn-secondary scenario-touch"
                    onClick={() => setRemove(null)}
                  >
                    취소
                  </button>
                  <button
                    type="button"
                    className="btn-danger scenario-touch"
                    onClick={confirmRemove}
                  >
                    삭제
                  </button>
                </>
              }
            >
              <p>작성한 내용과 컷 선택을 삭제합니다. 생성한 이미지 파일은 기록에 남아요.</p>
            </Modal>
          )}
        </>
      )}
    </div>
  );
}
