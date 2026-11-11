import { afterEach, describe, expect, it, vi } from 'vitest';
import { deferredWriter, previewInterval } from '../src/performance';
import { classifyJobError, jobStageLabel, lowerMemorySettings } from '../src/job-recovery';
import { defaults } from '../src/domain';

afterEach(() => vi.useRealTimers());
describe('progress persistence and mobile power policy', () => {
  it('writes the latest progress at bounded intervals and flushes completion immediately', () => {
    vi.useFakeTimers();
    const saved = vi.fn();
    const writer = deferredWriter(saved, 1000);
    for (let progress = 1; progress <= 50; progress++) writer.schedule({ progress });
    expect(saved).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1000);
    expect(saved).toHaveBeenCalledExactlyOnceWith({ progress: 50 });
    writer.schedule({ progress: 60 });
    writer.schedule({ progress: 100 }, true);
    expect(saved).toHaveBeenCalledTimes(2);
    expect(saved).toHaveBeenLastCalledWith({ progress: 100 });
    vi.advanceTimersByTime(2000);
    expect(saved).toHaveBeenCalledTimes(2);
  });
  it('flushes the last value before hiding or leaving the page', () => {
    const saved = vi.fn();
    const writer = deferredWriter(saved, 1000);
    writer.schedule('last edit');
    writer.flush();
    writer.flush();
    expect(saved).toHaveBeenCalledExactlyOnceWith('last edit');
  });
  it('reduces preview work on hidden pages, slow connections, and power saving', () => {
    expect(previewInterval(false, false, false)).toBe(200);
    expect(previewInterval(true, false, false)).toBe(1500);
    expect(previewInterval(false, false, true)).toBe(1500);
    expect(previewInterval(false, true, false)).toBe(5000);
  });
});
describe('actionable job recovery', () => {
  it('uses observed stages instead of implying sampling has started at zero progress', () => {
    const job = { status: 'running', progress: 0 } as any;
    expect(jobStageLabel(job)).toBe('모델 준비');
    expect(jobStageLabel({ ...job, stage: 'sampling' })).toBe('샘플링');
    expect(jobStageLabel({ ...job, stage: 'saving' })).toBe('이미지 변환·저장');
  });
  it('recognizes memory, missing asset and connection errors', () => {
    expect(classifyJobError('CUDA out of memory')).toBe('memory');
    expect(classifyJobError('Value not in list: model')).toBe('model');
    expect(classifyJobError('서버에 연결할 수 없습니다')).toBe('connection');
    expect(classifyJobError('unexpected exception')).toBe('unknown');
  });
  it('reduces the pixel budget, preserves seed/prompt and honors alignment for all families', () => {
    for (const architecture of ['flux', 'krea2', 'moss', 'qwen21'] as const) {
      const base = {
        ...defaults,
        architecture,
        width: 1024,
        height: 1536,
        batch: 4,
        seed: 123,
        positive: 'portrait',
      };
      const next = lowerMemorySettings(base);
      expect(next.width * next.height).toBeLessThan(base.width * base.height);
      expect(next.width % (architecture === 'flux' || architecture === 'krea2' ? 16 : 32)).toBe(0);
      expect(next.batch).toBe(1);
      expect(next.seed).toBe(123);
      expect(next.positive).toBe('portrait');
      expect(base.batch).toBe(4);
    }
  });
});
