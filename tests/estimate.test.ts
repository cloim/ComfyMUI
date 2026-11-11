import { describe, it, expect } from 'vitest';
import { calculateRemainingEstimate, getJobDurationMs, jobsAhead } from '../src/estimate';
import type { Job } from '../src/domain';
import { defaults } from '../src/domain';

function makeJob(partial: Partial<Job>): Job {
  return {
    id: 'job-' + Math.random(),
    createdAt: Date.now(),
    base: 'http://localhost:8188',
    preview: false,
    status: 'complete',
    progress: 100,
    images: [],
    settings: { ...defaults },
    ...partial,
  };
}

describe('calculateRemainingEstimate', () => {
  it('ignores queue time, different servers/models and failed jobs', () => {
    const current = makeJob({ status: 'running' });
    const sample = makeJob({ startedAt: 1000, completedAt: 11000 });
    expect(getJobDurationMs(makeJob({ createdAt: 1, completedAt: 11000 }))).toBeNull();
    expect(
      calculateRemainingEstimate(
        [sample, { ...sample, id: 'other', base: 'another-server' }],
        current,
      ),
    ).toBeNull();
    expect(
      calculateRemainingEstimate(
        [
          sample,
          { ...sample, id: 'other', settings: { ...sample.settings, model: 'other-model' } },
        ],
        current,
      ),
    ).toBeNull();
    expect(
      calculateRemainingEstimate([sample, { ...sample, id: 'failed', status: 'error' }], current),
    ).toBeNull();
  });
  it('scales by batch size and supplies an uncertainty range and sample count', () => {
    const sample = makeJob({
      startedAt: 1000,
      completedAt: 11000,
      settings: { ...defaults, batch: 1 },
    });
    const current = makeJob({
      status: 'queued',
      progress: 80,
      settings: { ...defaults, batch: 2 },
    });
    const result = calculateRemainingEstimate([sample, { ...sample, id: 'second' }], current)!;
    expect(result.remainingSeconds).toBe(20);
    expect(result.minSeconds).toBeLessThan(20);
    expect(result.maxSeconds).toBeGreaterThan(20);
    expect(result.sampleCount).toBe(2);
    expect(result.confidence).toBe('low');
  });
  it('counts only the running and earlier queued jobs of the same server', () => {
    const current = makeJob({ id: 'current', status: 'queued', createdAt: 20 });
    const earlier = makeJob({ id: 'earlier', status: 'queued', createdAt: 10 });
    const later = makeJob({ id: 'later', status: 'queued', createdAt: 30 });
    const running = makeJob({ id: 'running', status: 'running' });
    expect(
      jobsAhead([current, earlier, later, running, { ...earlier, base: 'other' }], current).map(
        (j) => j.id,
      ),
    ).toEqual(['earlier', 'running']);
    expect(jobsAhead([current], running)).toEqual([]);
  });
  it('returns null when there are fewer than 2 completed samples for the architecture', () => {
    const current = makeJob({
      id: 'current',
      status: 'running',
      progress: 30,
      settings: { ...defaults, architecture: 'flux' },
    });

    // 0 samples
    expect(calculateRemainingEstimate([], current, 0)).toBeNull();

    // 1 sample only
    const sample1 = makeJob({
      status: 'complete',
      startedAt: 1000,
      completedAt: 11000, // 10s
      settings: { ...defaults, architecture: 'flux' },
    });
    expect(calculateRemainingEstimate([sample1], current, 0)).toBeNull();

    // 2 samples but different architecture
    const diffArchSample = makeJob({
      status: 'complete',
      startedAt: 1000,
      completedAt: 11000,
      settings: { ...defaults, architecture: 'krea2' },
    });
    expect(calculateRemainingEstimate([sample1, diffArchSample], current, 0)).toBeNull();
  });

  it('calculates remaining seconds and queue count when 2 or more samples exist', () => {
    const sample1 = makeJob({
      status: 'complete',
      startedAt: 1000,
      completedAt: 11000, // 10s
      settings: { ...defaults, architecture: 'flux', steps: 20, width: 512, height: 512 },
    });
    const sample2 = makeJob({
      status: 'complete',
      startedAt: 2000,
      completedAt: 14000, // 12s
      settings: { ...defaults, architecture: 'flux', steps: 20, width: 512, height: 512 },
    });

    const current = makeJob({
      id: 'current',
      status: 'running',
      progress: 50, // 50%
      settings: { ...defaults, architecture: 'flux', steps: 20, width: 512, height: 512 },
    });

    const result = calculateRemainingEstimate([sample1, sample2], current, 2);
    expect(result).not.toBeNull();
    // 평균 11초에서 50% 완료이므로 약 5~6초 남음
    expect(result?.remainingSeconds).toBeGreaterThanOrEqual(4);
    expect(result?.remainingSeconds).toBeLessThanOrEqual(8);
    expect(result?.queueAheadCount).toBe(2);
  });
});
