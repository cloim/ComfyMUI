import type { Job } from './domain';

export type EstimateResult = {
  remainingSeconds: number;
  minSeconds: number;
  maxSeconds: number;
  queueAheadCount: number;
  sampleCount: number;
  confidence: 'low' | 'medium';
};

export function getJobDurationMs(job: Job): number | null {
  // Queue time must not inflate the measured generation duration.
  if (job.status !== 'complete' || !job.startedAt || !job.completedAt) return null;
  const duration = job.completedAt - job.startedAt;
  return duration > 0 ? duration : null;
}

export function jobsAhead(jobs: Job[], current: Job): Job[] {
  if (current.status !== 'queued') return [];
  return jobs.filter(
    (job) =>
      job.id !== current.id &&
      job.base === current.base &&
      job.preview === current.preview &&
      (job.status === 'running' || (job.status === 'queued' && job.createdAt < current.createdAt)),
  );
}

export function calculateRemainingEstimate(
  historyJobs: Job[],
  currentJob: Job,
  queueAheadCount = 0,
): EstimateResult | null {
  if (
    !['submitting', 'queued', 'running'].includes(currentJob.status) ||
    currentJob.settings.workflow ||
    currentJob.settings.upscale
  )
    return null;
  const target = currentJob.settings;
  const samples = historyJobs
    .filter((job) => {
      const duration = getJobDurationMs(job);
      const s = job.settings;
      return (
        job.id !== currentJob.id &&
        job.base === currentJob.base &&
        job.preview === currentJob.preview &&
        !s.workflow &&
        !s.upscale &&
        s.architecture === target.architecture &&
        s.model === target.model &&
        s.modelLoader === target.modelLoader &&
        s.sampler === target.sampler &&
        s.scheduler === target.scheduler &&
        s.clip1 === target.clip1 &&
        s.clip2 === target.clip2 &&
        duration !== null &&
        duration >= 1000 &&
        duration <= 3600000
      );
    })
    .sort((a, b) => (b.completedAt || 0) - (a.completedAt || 0))
    .slice(0, 20);
  if (samples.length < 2) return null;
  const work = (job: Job) =>
    Math.max(1, job.settings.steps * job.settings.width * job.settings.height * job.settings.batch);
  const rates = samples
    .map((job) => getJobDurationMs(job)! / 1000 / work(job))
    .sort((a, b) => a - b);
  const median =
    rates.length % 2
      ? rates[Math.floor(rates.length / 2)]
      : (rates[rates.length / 2 - 1] + rates[rates.length / 2]) / 2;
  const q1 = rates[Math.floor((rates.length - 1) * 0.25)];
  const q3 = rates[Math.ceil((rates.length - 1) * 0.75)];
  const progress =
    currentJob.status === 'running' ? Math.min(99, Math.max(0, currentJob.progress)) / 100 : 0;
  const unitsLeft = work(currentJob) * (1 - progress);
  return {
    remainingSeconds: Math.max(1, Math.round(median * unitsLeft)),
    minSeconds: Math.max(1, Math.floor(Math.min(q1, median * 0.8) * unitsLeft)),
    maxSeconds: Math.max(2, Math.ceil(Math.max(q3, median * 1.25) * unitsLeft)),
    queueAheadCount,
    sampleCount: samples.length,
    confidence: samples.length >= 5 ? 'medium' : 'low',
  };
}
