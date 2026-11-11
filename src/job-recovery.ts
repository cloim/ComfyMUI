import type { Generation, Job } from './domain';

export type RecoveryKind = 'memory' | 'model' | 'connection' | 'unknown';
export function classifyJobError(message: string): RecoveryKind {
  if (/out of memory|cuda.*memory|메모리.*부족|allocation.*failed/i.test(message)) return 'memory';
  if (
    /not in list|model.*not found|no such file|설치값|노드가 서버에 없습니다|다시 선택/i.test(
      message,
    )
  )
    return 'model';
  if (/network|fetch|timeout|연결|네트워크|작업 번호|전송 중 화면/i.test(message))
    return 'connection';
  return 'unknown';
}

// Lower both dimensions while preserving each family's required alignment.
export function lowerMemorySettings(base: Generation): Generation {
  const step = ['moss', 'qwen21'].includes(base.architecture) ? 32 : 16;
  const fit = (v: number) => Math.max(256, Math.floor((v * 0.75) / step) * step);
  return {
    ...structuredClone(base),
    width: fit(base.width),
    height: fit(base.height),
    batch: 1,
    random: false,
  };
}

export function jobStageLabel(job: Job): string {
  if (job.status === 'submitting') return '요청 전송';
  if (job.status === 'queued') return '서버 대기';
  if (job.status === 'running') {
    if (job.stage === 'saving') return '이미지 변환·저장';
    if (job.stage === 'sampling' || job.progress > 0) return '샘플링';
    return '모델 준비';
  }
  return job.status === 'complete'
    ? '생성 완료'
    : job.status === 'cancelled'
      ? '대기 취소됨'
      : '생성을 다시 확인해 주세요';
}
