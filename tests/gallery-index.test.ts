import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { closeGalleryIndexes, invalidateGallery, listGallery } from '../gallery.mjs';

const folders: string[] = [];
async function folder() {
  const dir = await mkdtemp(join(tmpdir(), 'comfymui-gallery-'));
  folders.push(dir);
  return dir;
}
function png(positive: string) {
  const text = Buffer.from(`comfymui\0${JSON.stringify({ positive, seed: 42 })}`, 'latin1');
  const chunk = Buffer.alloc(text.length + 12);
  chunk.writeUInt32BE(text.length);
  chunk.write('tEXt', 4);
  text.copy(chunk, 8);
  const end = Buffer.alloc(12);
  end.write('IEND', 4);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk, end]);
}
afterEach(async () => {
  closeGalleryIndexes();
  await Promise.all(folders.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('gallery index', () => {
  it('reuses a clean snapshot and preserves metadata objects for unchanged files on reconciliation', async () => {
    const dir = await folder();
    await writeFile(join(dir, 'first.png'), png('first'));
    const first = await listGallery(dir);
    expect(first[0].settings.positive).toBe('first');
    expect(await listGallery(dir)).toBe(first);
    const refreshed = await listGallery(dir, { force: true });
    expect(refreshed[0]).toBe(first[0]);
    await writeFile(join(dir, 'first.png'), png('changed prompt'));
    expect((await listGallery(dir, { force: true }))[0].settings.positive).toBe('changed prompt');
  });

  it('indexes additions and removals from notifications, with explicit invalidation available', async () => {
    const dir = await folder();
    await listGallery(dir);
    await writeFile(join(dir, 'new.png'), png('new'));
    await vi.waitFor(
      async () =>
        expect((await listGallery(dir)).map((item: { filename: string }) => item.filename)).toEqual(
          ['new.png'],
        ),
      { timeout: 3500 },
    );
    await writeFile(join(dir, 'new.png'), png('new metadata'));
    await vi.waitFor(
      async () => expect((await listGallery(dir))[0]?.settings?.positive).toBe('new metadata'),
      { timeout: 3500 },
    );
    await unlink(join(dir, 'new.png'));
    await vi.waitFor(async () => expect(await listGallery(dir)).toEqual([]), { timeout: 3500 });
    invalidateGallery(dir);
    expect(await listGallery(dir)).toEqual([]);
  });

  it('removes nested records when a deleted directory has an image-like name', async () => {
    const dir = await folder();
    await mkdir(join(dir, 'set.png'));
    await writeFile(join(dir, 'set.png', 'child.png'), png('nested'));
    expect(await listGallery(dir)).toHaveLength(1);
    await rm(join(dir, 'set.png'), { recursive: true });
    await vi.waitFor(async () => expect(await listGallery(dir)).toEqual([]), { timeout: 3500 });
  });

  it('keeps concurrent forced refreshes consistent with deletion', async () => {
    const dir = await folder();
    await writeFile(join(dir, 'keep.png'), png('keep'));
    await writeFile(join(dir, 'remove.png'), png('remove'));
    await listGallery(dir);
    await unlink(join(dir, 'remove.png'));
    const results = await Promise.all(
      Array.from({ length: 4 }, () => listGallery(dir, { force: true })),
    );
    for (const items of results)
      expect(items.map((item: { filename: string }) => item.filename)).toEqual(['keep.png']);
  });

  it('keeps roots isolated and reconciles nested directories and coalesced requests', async () => {
    const a = await folder();
    const b = await folder();
    await mkdir(join(a, 'nested'));
    await writeFile(join(a, 'nested', 'a.png'), png('a'));
    await writeFile(join(b, 'b.webp'), Buffer.from('image'));
    const [one, two] = await Promise.all([listGallery(a), listGallery(a)]);
    expect(one).toBe(two);
    expect(one[0].subfolder).toBe('nested');
    expect((await listGallery(b))[0].filename).toBe('b.webp');
    expect((await listGallery(a))[0].filename).toBe('a.png');
    await rm(join(a, 'nested'), { recursive: true });
    expect(await listGallery(a, { force: true })).toEqual([]);
  });
});
