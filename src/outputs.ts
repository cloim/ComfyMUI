import type { ImageRef } from './domain';

export type OutputDeleteResult = { deleted: string[]; missing: string[]; failed: string[] };

export function outputKey(image: ImageRef) {
  return image.subfolder ? `${image.subfolder}/${image.filename}` : image.filename;
}

// Deletes image files in the ComfyUI output folder through the app server (server.mjs).
export async function deleteOutputFiles(images: ImageRef[]): Promise<OutputDeleteResult> {
  let response: Response;
  try {
    response = await fetch('/api/outputs/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ files: images }),
      signal: AbortSignal.timeout(20000),
    });
  } catch {
    throw new Error('앱 서버에 연결할 수 없어 이미지 파일을 삭제하지 못했어요');
  }
  // An app server started before this feature has no delete route.
  if (response.status === 404) {
    throw new Error(
      '앱 서버가 이전 버전이라 이미지 파일을 삭제할 수 없어요\n앱 서버를 재시작해 주세요',
    );
  }
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(body?.error?.message || '이미지 파일을 삭제하지 못했어요');
  }
  return {
    deleted: body.deleted || [],
    missing: body.missing || [],
    failed: body.failed || [],
  };
}
