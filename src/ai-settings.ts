// OpenAI-compatible text model used by the scenario AI prompt. The app server keeps the
// connection; the API key is write-only from the browser's point of view.
export type AiSettings = {
  baseUrl: string;
  model: string;
  hasKey: boolean;
  source: 'saved' | 'env' | 'none';
};

export type AiSettingsUpdate = {
  baseUrl: string;
  model: string;
  // Omitted keeps the current key; an empty string removes it.
  apiKey?: string;
};

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      ...init,
      headers: init?.body ? { 'Content-Type': 'application/json' } : undefined,
      signal: AbortSignal.timeout(20000),
    });
  } catch {
    throw new Error('앱 서버에 연결할 수 없어요');
  }
  const result = await response.json().catch(() => null);
  if (response.status === 404) throw new Error('앱 서버를 최신 버전으로 업데이트해 주세요');
  if (!response.ok) throw new Error(result?.error?.message || 'AI 연결 설정을 확인해 주세요');
  return result as T;
}

export const loadAiSettings = () => call<AiSettings>('/api/settings/ai');

export const saveAiSettings = (update: AiSettingsUpdate) =>
  call<AiSettings>('/api/settings/ai', { method: 'PUT', body: JSON.stringify(update) });

export async function listAiModels(baseUrl: string, apiKey?: string) {
  const result = await call<{ models: string[] }>('/api/settings/ai/models', {
    method: 'POST',
    body: JSON.stringify(apiKey ? { baseUrl, apiKey } : { baseUrl }),
  });
  return result.models;
}
