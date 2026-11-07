import { describe, it, expect } from 'vitest';
import { calculateRemainingEstimate, getJobDurationMs } from '../src/estimate';
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
