import { describe, expect, it } from 'vitest';
import { reorderQueue, type QueueItem, defaults } from '../src/domain';

describe('Client generation queue utilities', () => {
  it('correctly reorders items in queue', () => {
    const item1: QueueItem = { id: '1', createdAt: 100, settings: { ...defaults, seed: 1 } };
    const item2: QueueItem = { id: '2', createdAt: 200, settings: { ...defaults, seed: 2 } };
    const item3: QueueItem = { id: '3', createdAt: 300, settings: { ...defaults, seed: 3 } };

    const initial = [item1, item2, item3];

    // Move first to last
    const moved1 = reorderQueue(initial, 0, 2);
    expect(moved1.map((i) => i.id)).toEqual(['2', '3', '1']);

    // Move last to first
    const moved2 = reorderQueue(initial, 2, 0);
    expect(moved2.map((i) => i.id)).toEqual(['3', '1', '2']);

    // Move middle to next
    const moved3 = reorderQueue(initial, 1, 2);
    expect(moved3.map((i) => i.id)).toEqual(['1', '3', '2']);
  });

  it('safely handles out of range indices', () => {
    const list = [{ id: 'a' }, { id: 'b' }];
    expect(reorderQueue(list, -1, 1)).toBe(list);
    expect(reorderQueue(list, 0, 5)).toBe(list);
    expect(reorderQueue(list, 1, 1)).toBe(list);
  });
});
