import type { ImageRef, ObjectInfo, Workflow } from './domain';
export function normalizeBase(input: string) {
  const v = input.trim().replace(/\/+$/, '');
  if (v === '/comfy') return v;
  const url = new URL(v);
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new Error('http 또는 https 서버 주소를 입력해 주세요');
  if (location.protocol === 'https:' && url.protocol === 'http:')
    throw new Error('HTTPS 앱에서는 /comfy 연결 또는 HTTPS 서버 주소를 사용해 주세요');
  return v;
}
export async function request<T>(base: string, path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${base}${path}`, {
      ...init,
      headers: { 'Content-Type': 'application/json', ...init?.headers },
      signal: AbortSignal.timeout(15000),
      cache: 'no-store',
    });
  } catch {
    throw new Error(
      '서버에 연결할 수 없습니다. 주소와 네트워크, CORS 설정을 확인하고 다시 시도해 주세요',
    );
  }
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail =
      typeof body.error === 'string' ? body.error : body.error?.message || response.statusText;
    const nodes = body.node_errors
      ? Object.entries(body.node_errors)
          .map(([id, v]) => `${id}: ${JSON.stringify(v)}`)
          .join('\n')
      : '';
    throw new Error(`${detail || '요청 실패'} (${response.status})${nodes ? '\n' + nodes : ''}`);
  }
  return body;
}
export const fetchInfo = (base: string) => request<ObjectInfo>(base, '/object_info');
export const submit = (base: string, prompt: Workflow, client_id: string) =>
  request<{ prompt_id: string }>(base, '/prompt', {
    method: 'POST',
    body: JSON.stringify({ prompt, client_id }),
  });
export type HistoryItem = {
  outputs: Record<string, { images?: ImageRef[] }>;
  status?: {
    completed: boolean;
    status_str: string;
    messages?: [string, Record<string, unknown>][];
  };
};
export type Queue = {
  queue_running: [number, string, ...unknown[]][];
  queue_pending: [number, string, ...unknown[]][];
};
export function imageUrl(base: string, ref: ImageRef) {
  return `${base}/view?${new URLSearchParams(ref)}`;
}
export function websocketUrl(base: string, clientId: string) {
  const u = new URL(`${base}/ws`, location.href);
  u.protocol = u.protocol === 'https:' ? 'wss:' : 'ws:';
  u.searchParams.set('clientId', clientId);
  return u.href;
}
