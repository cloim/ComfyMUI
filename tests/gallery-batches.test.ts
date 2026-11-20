import { expect, it } from 'vitest';
import { defaults, type Job } from '../src/domain';
import { batchImageId, splitBatches } from '../src/gallery';

const job = (id: string, files: string[], status: Job['status'] = 'complete'): Job => ({
  id,
  createdAt: 1,
  settings: defaults,
  base: '/comfy',
  status,
  progress: 100,
  images: files.map((filename) => ({ filename, subfolder: 'scenario', type: 'output' })),
});

it('lists every image of a batch record on its own', () => {
  const items = splitBatches([
    job('a', ['a_1.png', 'a_2.png', 'a_3.png']),
    job('b', ['b_1.png']),
    job('c', [], 'running'),
  ]);
  expect(items.map((item) => item.id)).toEqual([
    'a#scenario/a_1.png',
    'a#scenario/a_2.png',
    'a#scenario/a_3.png',
    'b',
    'c',
  ]);
  expect(items[1].images).toEqual([{ filename: 'a_2.png', subfolder: 'scenario', type: 'output' }]);
});

it('reads the record and image back from an item id', () => {
  expect(batchImageId('a#scenario/a_2.png')).toEqual({ jobId: 'a', image: 'scenario/a_2.png' });
  expect(batchImageId('b')).toBeNull();
  // Output-folder items name a file, which may itself contain '#'.
  expect(batchImageId('file:scenario/x#1.png@5')).toBeNull();
});
