import type { ImageRef, Job, ObjectInfo, Workflow } from './domain';
export class ApiError extends Error {
  constructor(
    message: string,
    public status = 0,
  ) {
    super(message);
  }
}
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
export async function request<T>(
  base: string,
  path: string,
  init?: RequestInit,
  decode?: (response: Response) => Promise<T>,
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${base}${path}`, {
      ...init,
      headers: {
        ...(init?.body && !(typeof FormData !== 'undefined' && init.body instanceof FormData)
          ? { 'Content-Type': 'application/json' }
          : {}),
        ...init?.headers,
      },
      signal: init?.signal
        ? AbortSignal.any([init.signal, AbortSignal.timeout(15000)])
        : AbortSignal.timeout(15000),
      cache: 'no-store',
    });
  } catch {
    throw new ApiError(
      '서버에 연결할 수 없습니다. 주소와 네트워크, CORS 설정을 확인하고 다시 시도해 주세요',
    );
  }
  if (response.ok && decode) return decode(response);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail =
      typeof body.error === 'string' ? body.error : body.error?.message || response.statusText;
    const nodes = body.node_errors
      ? Object.entries(body.node_errors)
          .map(([id, v]) => `${id}: ${JSON.stringify(v)}`)
          .join('\n')
      : '';
    throw new ApiError(
      `${detail || '요청 실패'} (${response.status})${nodes ? '\n' + nodes : ''}`,
      response.status,
    );
  }
  return body;
}
export function fetchInfo(base: string, signal?: AbortSignal, refresh = false) {
  const params = new URLSearchParams();
  if (base === '/comfy') {
    if (typeof DecompressionStream !== 'undefined') params.set('packed', '1');
    if (refresh) params.set('refresh', '1');
  }
  return request<ObjectInfo>(
    base,
    `/object_info${params.size ? '?' + params : ''}`,
    { signal },
    async (response) => {
      if (response.headers.get('Content-Type') === 'application/gzip' && response.body) {
        return new Response(response.body.pipeThrough(new DecompressionStream('gzip'))).json();
      }
      return response.json();
    },
  );
}

export async function checkConnection(base: string, signal?: AbortSignal) {
  const queue = await request<Queue>(base, '/queue', {
    signal: signal
      ? AbortSignal.any([signal, AbortSignal.timeout(1000)])
      : AbortSignal.timeout(1000),
  });
  if (!Array.isArray(queue?.queue_running) || !Array.isArray(queue?.queue_pending))
    throw new ApiError('ComfyUI 서버 응답을 확인해 주세요');
}
// extra_pnginfo entries are written into saved PNGs by ComfyUI's SaveImage node.
export const submit = (
  base: string,
  prompt: Workflow,
  client_id: string,
  pngInfo?: Record<string, unknown>,
  requestToken?: string,
  promptId?: string,
) =>
  request<{ prompt_id: string }>(base, '/prompt', {
    method: 'POST',
    body: JSON.stringify({
      prompt,
      client_id,
      ...(promptId && { prompt_id: promptId }),
      extra_data: {
        ...(pngInfo ? { extra_pnginfo: pngInfo } : {}),
        ...(requestToken ? { comfymui_request_id: requestToken } : {}),
      },
    }),
  });
export type HistoryItem = {
  outputs: Record<string, { images?: ImageRef[]; videos?: ImageRef[]; gifs?: ImageRef[] }>;
  status?: {
    completed: boolean;
    status_str: string;
    messages?: [string, Record<string, unknown>][];
  };
};
export function completedJobPatch(item: HistoryItem, video?: true): Partial<Job> | undefined {
  if (item.status?.status_str === 'error') {
    return {
      status: 'error',
      error: JSON.stringify(item.status.messages || '서버 생성 오류'),
    };
  }
  const finishedAt = Date.now();
  const files = Object.values(item.outputs || {})
    .flatMap((node) =>
      video
        ? [...(node.videos || []), ...(node.gifs || []), ...(node.images || [])]
        : node.images || [],
    )
    .filter((file) =>
      video
        ? file.type === 'output' && /\.mp4$/i.test(file.filename)
        : !/\.mp4$/i.test(file.filename),
    )
    .map((file) => ({ ...file, v: finishedAt }));
  if (files.length) {
    return {
      status: 'complete',
      progress: 100,
      error: undefined,
      ...(video ? { videos: files } : { images: files }),
    };
  }
  if (item.status?.completed) {
    return {
      status: 'error',
      error: video
        ? '생성은 끝났지만 MP4 파일이 없습니다. SaveVideo 출력을 확인해 주세요'
        : '생성은 끝났지만 이미지 출력이 없습니다. SaveImage 출력을 확인해 주세요',
    };
  }
}

export async function uploadImage(
  base: string,
  file: File,
  subfolder: string,
  id: string,
): Promise<ImageRef> {
  const extension = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }[file.type];
  if (!extension || file.size > 20 * 1024 * 1024) {
    throw new Error('20MB 이하의 JPG, PNG 또는 WebP 이미지를 선택해 주세요');
  }
  const body = new FormData();
  body.set('image', file, `${id}.${extension}`);
  body.set('subfolder', subfolder);
  body.set('type', 'input');
  const uploaded = await request<{ name?: string; subfolder?: string; type?: string }>(
    base,
    '/upload/image',
    { method: 'POST', body },
  );
  if (!uploaded.name || uploaded.type !== 'input')
    throw new Error('업로드한 이미지를 확인해 주세요');
  return { filename: uploaded.name, subfolder: uploaded.subfolder || '', type: uploaded.type };
}
export type Queue = {
  queue_running: [number, string, ...unknown[]][];
  queue_pending: [number, string, ...unknown[]][];
};
function imageParams(ref: ImageRef) {
  const params = new URLSearchParams({
    filename: ref.filename,
    subfolder: ref.subfolder,
    type: ref.type,
  });
  if (ref.v) params.set('v', String(ref.v));
  return params;
}
export function imageUrl(base: string, ref: ImageRef) {
  return `${base}/view?${imageParams(ref)}`;
}
export function thumbnailUrl(base: string, ref: ImageRef) {
  if (base === '/comfy') {
    return `/comfy/thumb?${imageParams(ref)}`;
  }
  return imageUrl(base, ref);
}
export function websocketUrl(base: string, clientId: string) {
  const u = new URL(`${base}/ws`, location.href);
  u.protocol = u.protocol === 'https:' ? 'wss:' : 'ws:';
  u.searchParams.set('clientId', clientId);
  return u.href;
}
