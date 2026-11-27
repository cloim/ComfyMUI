// A minimal MP4 laid out like ComfyUI's SaveVideo output (movflags=use_metadata_tags):
// moov/udta/meta with an mdta handler, a `keys` list and `ilst` values. It has no
// playable frames; tests and the e2e mock use it to check what the gallery index reads.
const u32 = (value) => {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32BE(value);
  return buffer;
};
const box = (type, ...parts) => {
  const body = Buffer.concat(
    parts.map((part) => (typeof part === 'string' ? Buffer.from(part) : part)),
  );
  return Buffer.concat([u32(body.length + 8), Buffer.from(type, 'latin1'), body]);
};

export function mp4WithTags(tags) {
  const entries = Object.entries(tags);
  const keys = box(
    'keys',
    u32(0),
    u32(entries.length),
    ...entries.map(([key]) => {
      const name = Buffer.from(key);
      return Buffer.concat([u32(name.length + 8), Buffer.from('mdta'), name]);
    }),
  );
  const items = entries.map(([, value], i) => {
    const data = box('data', u32(1), u32(0), Buffer.from(String(value)));
    return Buffer.concat([u32(data.length + 8), u32(i + 1), data]);
  });
  const hdlr = box('hdlr', u32(0), u32(0), 'mdta', Buffer.alloc(13));
  const meta = box('meta', u32(0), hdlr, keys, box('ilst', ...items));
  return Buffer.concat([
    box('ftyp', 'isom', u32(0x200), 'isomiso2avc1mp41'),
    box('moov', box('mvhd', Buffer.alloc(100)), box('udta', meta)),
    box('mdat'),
  ]);
}
