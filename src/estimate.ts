import type { Job } from './domain';

export type EstimateResult = {
  remainingSeconds: number;
  queueAheadCount: number;
};

export function getJobDurationMs(job: Job): number | null {
  if (job.status !== 'complete') return null;
  if (job.completedAt && job.startedAt && job.completedAt > job.startedAt) {
    return job.completedAt - job.startedAt;
  }
  if (job.completedAt && job.createdAt && job.completedAt > job.createdAt) {
    return job.completedAt - job.createdAt;
  }
  return null;
}

export function calculateRemainingEstimate(
  historyJobs: Job[],
  currentJob: Job,
  queueAheadCount = 0,
): EstimateResult | null {
  if (!currentJob || currentJob.status === 'complete' || currentJob.status === 'cancelled') {
    return null;
  }

  const targetArch = currentJob.settings.architecture;
  // 동일 아키텍처이면서 완료된 표본 필터링
  const samples = historyJobs.filter((j) => {
    if (j.id === currentJob.id) return false;
    if (j.status !== 'complete') return false;
    if (j.settings.architecture !== targetArch) return false;
    const dur = getJobDurationMs(j);
    // 1초 이상 10분 이하 유효 범위
    return dur !== null && dur >= 1000 && dur <= 600000;
  });

  // 표본이 2건 미만이면 표시하지 않음
  if (samples.length < 2) {
    return null;
  }

  // 각 표본의 단위 작업량(steps * width * height) 대비 소요 초 계산
  const targetComplexity =
    (currentJob.settings.steps || 20) *
    (currentJob.settings.width || 512) *
    (currentJob.settings.height || 512);

  const secPerUnitList = samples.map((s) => {
    const durMs = getJobDurationMs(s)!;
    const complexity =
      (s.settings.steps || 20) * (s.settings.width || 512) * (s.settings.height || 512);
    return durMs / 1000 / Math.max(1, complexity);
  });

  const avgSecPerUnit =
    secPerUnitList.reduce((acc, val) => acc + val, 0) / secPerUnitList.length;

  const totalEstimatedSeconds = Math.max(
    2,
    Math.round(avgSecPerUnit * targetComplexity),
  );

  // 진행률 반영: 100% 진행에 가까울수록 잔여 시간 감소
  const currentProgress = Math.min(99, Math.max(0, currentJob.progress || 0));
  const remainingSeconds = Math.max(
    1,
    Math.round(totalEstimatedSeconds * (1 - currentProgress / 100)),
  );

  return {
    remainingSeconds,
    queueAheadCount,
  };
}
