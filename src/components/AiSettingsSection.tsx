import { useEffect, useId, useRef, useState } from 'react';
import { Bot, Check, Info, ListRestart, Save } from 'lucide-react';
import { useStudioSelector } from '../studio';
import { listAiModels, loadAiSettings, saveAiSettings, type AiSettings } from '../ai-settings';
import { FieldError, Section, Spinner, Status } from './ui';

// OpenAI-compatible text model for the scenario AI prompt.
export function AiSettingsSection() {
  const notify = useStudioSelector((s) => s.notify);
  const [saved, setSaved] = useState<AiSettings | null>(null);
  const [loadError, setLoadError] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [model, setModel] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [clearKey, setClearKey] = useState(false);
  const [models, setModels] = useState<string[] | null>(null);
  const [checking, setChecking] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const addressInput = useRef<HTMLInputElement>(null);
  const listId = useId();

  function apply(next: AiSettings) {
    setSaved(next);
    setBaseUrl(next.baseUrl);
    setModel(next.model);
    setApiKey('');
    setClearKey(false);
  }

  useEffect(() => {
    let alive = true;
    loadAiSettings()
      .then((next) => alive && apply(next))
      .catch((e: Error) => alive && setLoadError(e.message));
    return () => {
      alive = false;
    };
  }, []);

  async function handleCheck() {
    setError('');
    setChecking(true);
    try {
      const list = await listAiModels(baseUrl.trim(), clearKey ? undefined : apiKey.trim());
      setModels(list);
      if (!model.trim() && list.length === 1) setModel(list[0]);
    } catch (e) {
      setModels(null);
      setError((e as Error).message);
    } finally {
      setChecking(false);
    }
  }

  async function handleSave() {
    setError('');
    setSaving(true);
    try {
      const next = await saveAiSettings({
        baseUrl: baseUrl.trim(),
        model: model.trim(),
        ...(clearKey ? { apiKey: '' } : apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
      });
      apply(next);
      notify(next.source === 'saved' ? 'AI 연결 설정을 저장했어요' : '저장한 AI 연결을 지웠어요');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  const status =
    saved?.source === 'saved'
      ? '설정됨'
      : saved?.source === 'env'
        ? '서버 환경변수 사용 중'
        : saved
          ? '설정 필요'
          : '불러오는 중';
  const busy = !saved || checking || saving;

  return (
    <Section
      title="AI 연결"
      icon={Bot}
      action={
        <div className="-my-1 flex items-center">
          <Status>
            <span
              className={`h-1.5 w-1.5 rounded-full ${saved && saved.source !== 'none' ? 'bg-olive' : 'bg-amber-500'}`}
            />
            {status}
          </Status>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        <p className="text-xs leading-relaxed text-muted">
          시나리오의 AI 프롬프트 작성과 만들기의 프롬프트 번역에 사용할 OpenAI 호환 텍스트 모델을
          연결해 주세요
        </p>
        {loadError && (
          <p role="alert" className="rounded-xl bg-red-50 p-3 text-xs text-red-700">
            {loadError}
          </p>
        )}
        <label className="flex flex-col gap-2 text-xs font-semibold">
          API 주소
          <input
            ref={addressInput}
            type="text"
            inputMode="url"
            aria-label="AI API 주소"
            aria-invalid={Boolean(error)}
            aria-describedby={error ? 'ai-settings-error' : undefined}
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            className="field font-mono"
            value={baseUrl}
            disabled={!saved}
            onChange={(e) => {
              setBaseUrl(e.target.value);
              setModels(null);
            }}
            placeholder="https://api.openai.com/v1"
          />
          <span className="font-normal text-muted">
            <code>/chat/completions</code> 앞까지의 주소예요. 보통 <code>/v1</code>로 끝나요
          </span>
        </label>
        <div className="flex flex-col gap-2 text-xs font-semibold">
          <label htmlFor={`${listId}-key`}>API 키</label>
          <input
            id={`${listId}-key`}
            type="password"
            aria-label="AI API 키"
            autoComplete="off"
            spellCheck={false}
            className="field font-mono"
            value={apiKey}
            disabled={!saved || clearKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder={
              clearKey
                ? '저장하면 키를 지워요'
                : saved?.hasKey
                  ? '저장된 키 사용 중 · 바꾸려면 새 키 입력'
                  : '필요한 경우에만 입력 (로컬 서버는 비워 두세요)'
            }
          />
          {saved?.hasKey && (
            <span className="flex items-center gap-2 font-normal text-muted">
              <input
                type="checkbox"
                id={`${listId}-clear`}
                checked={clearKey}
                onChange={(e) => {
                  setClearKey(e.target.checked);
                  if (e.target.checked) setApiKey('');
                }}
              />
              <label htmlFor={`${listId}-clear`}>저장된 키 지우기</label>
            </span>
          )}
        </div>
        <label className="flex flex-col gap-2 text-xs font-semibold">
          모델
          <input
            type="text"
            aria-label="AI 텍스트 모델"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            className="field font-mono"
            list={models?.length ? listId : undefined}
            value={model}
            disabled={!saved}
            onChange={(e) => setModel(e.target.value)}
            placeholder="gpt-4o-mini"
          />
          {models && models.length > 0 && (
            <datalist id={listId}>
              {models.map((m) => (
                <option key={m} value={m} />
              ))}
            </datalist>
          )}
        </label>
        {models && (
          <div
            role="status"
            className="flex flex-col gap-2 rounded-xl bg-lime/20 p-4 text-xs text-olive"
          >
            <p className="flex items-center gap-2 font-semibold">
              <Check size={16} />
              {models.length
                ? `서버에 연결했어요 · 모델 ${models.length}개`
                : '서버에 연결했지만 모델 목록이 비어 있어요'}
            </p>
            {models.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {models.slice(0, 24).map((m) => (
                  <button
                    key={m}
                    type="button"
                    aria-pressed={model === m}
                    onClick={() => setModel(m)}
                    className={`chip font-mono ${model === m ? 'bg-ink text-lime' : ''}`}
                  >
                    {m}
                  </button>
                ))}
                {models.length > 24 && (
                  <span className="self-center text-muted">모델 입력란에서 더 찾을 수 있어요</span>
                )}
              </div>
            )}
          </div>
        )}
        <div data-ui-audit-row className="flex flex-wrap gap-2">
          <button
            type="button"
            className="btn-primary"
            disabled={busy}
            onClick={() => void handleSave()}
          >
            {saving ? <Spinner /> : <Save size={16} />}저장
          </button>
          <button
            type="button"
            className="btn-secondary"
            disabled={busy || !baseUrl.trim()}
            onClick={() => void handleCheck()}
          >
            {checking ? <Spinner /> : <ListRestart size={16} />}연결 확인 및 모델 불러오기
          </button>
        </div>
        <FieldError anchor={addressInput} message={error} id="ai-settings-error" />
        <div className="flex items-start gap-3 rounded-xl bg-paper p-4">
          <Info size={17} className="mt-0.5 shrink-0 text-muted" />
          <p className="text-xs leading-relaxed text-muted">
            OpenAI, OpenRouter, Ollama, LM Studio, vLLM처럼 OpenAI 호환 API를 제공하는 서버를 쓸 수
            있어요
            <br />
            같은 PC의 서버는 앱 서버를 Windows에서 직접 실행하면{' '}
            <code>http://127.0.0.1:포트/v1</code>, Docker 컨테이너로 실행하면{' '}
            <code>http://host.docker.internal:포트/v1</code>로 입력하세요
            <br />
            <br />
            API 키는 앱 서버에만 저장되고 브라우저에는 다시 표시되지 않아요
            <br />
            AI 프롬프트를 만들 때 장면 묘사, 화풍과 캐릭터 묘사가 이 서버로 전송돼요
            <br />
            프롬프트를 번역할 때는 입력한 프롬프트가 이 서버로 전송돼요
            <br />
            주소를 비우고 저장하면 저장한 연결을 지워요
          </p>
        </div>
      </div>
    </Section>
  );
}
