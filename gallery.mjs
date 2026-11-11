// Gallery index built from the ComfyUI output folder. Each image is described by the
// generation data ComfyUI stores in the PNG (the API prompt, and ComfyMUI settings when
// the app made it), so the folder itself is the history.
import { open, readdir, lstat } from 'node:fs/promises';
import { watch } from 'node:fs';
import { extname, join, resolve, relative, sep } from 'node:path';
import { inflateSync } from 'node:zlib';

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp']);
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const MAX_DEPTH = 4;
const MAX_FILES = 5000;
const MAX_TEXT_CHUNK = 8 * 1024 * 1024;

// Reads tEXt/iTXt chunks that come before the image data.
export async function readPngText(path) {
  const file = await open(path, 'r');
  try {
    const signature = Buffer.alloc(8);
    await file.read(signature, 0, 8, 0);
    if (!signature.equals(PNG_SIGNATURE)) return {};
    const out = {};
    let position = 8;
    for (let i = 0; i < 256; i++) {
      const head = Buffer.alloc(8);
      const { bytesRead } = await file.read(head, 0, 8, position);
      if (bytesRead < 8) break;
      const length = head.readUInt32BE(0);
      const type = head.toString('latin1', 4, 8);
      if (type === 'IDAT' || type === 'IEND') break;
      if ((type === 'tEXt' || type === 'iTXt') && length <= MAX_TEXT_CHUNK) {
        const body = Buffer.alloc(length);
        await file.read(body, 0, length, position + 8);
        const keyEnd = body.indexOf(0);
        if (keyEnd > 0) {
          const key = body.toString('latin1', 0, keyEnd);
          if (type === 'tEXt') {
            out[key] = body.toString('latin1', keyEnd + 1);
          } else {
            const compressed = body[keyEnd + 1] === 1;
            const languageEnd = body.indexOf(0, keyEnd + 3);
            const translatedEnd = body.indexOf(0, languageEnd + 1);
            const raw = body.subarray(translatedEnd + 1);
            out[key] = (compressed ? inflateSync(raw) : raw).toString('utf8');
          }
        }
      }
      position += 12 + length;
    }
    return out;
  } finally {
    await file.close();
  }
}

const SAMPLERS = ['KSampler', 'KSamplerAdvanced'];
const MODEL_LOADERS = {
  CheckpointLoaderSimple: 'ckpt_name',
  UNETLoader: 'unet_name',
  UnetLoaderGGUF: 'unet_name',
  UnetLoaderGGUFAdvanced: 'unet_name',
  GGUFLoaderKJ: 'model_name',
};

// Follows conditioning links back to the prompt text (through guidance or zero-out nodes).
function promptText(prompt, link, depth = 0) {
  if (!Array.isArray(link) || depth > 6) return null;
  const node = prompt[link[0]];
  if (!node) return null;
  if (typeof node.inputs?.text === 'string') return node.inputs.text;
  if (node.class_type === 'ConditioningZeroOut') return '';
  for (const value of Object.values(node.inputs || {})) {
    const text = promptText(prompt, value, depth + 1);
    if (text !== null) return text;
  }
  return null;
}

// Compact generation summary from a ComfyUI API prompt.
export function summarizePrompt(prompt) {
  if (!prompt || typeof prompt !== 'object') return null;
  const nodes = Object.values(prompt).filter((n) => n && typeof n === 'object');
  const summary = { loras: [] };
  const sampler = nodes.find((n) => SAMPLERS.includes(n.class_type));
  if (sampler) {
    const i = sampler.inputs || {};
    Object.assign(summary, {
      seed: i.seed ?? i.noise_seed,
      steps: i.steps,
      cfg: i.cfg,
      sampler: i.sampler_name,
      scheduler: i.scheduler,
      denoise: i.denoise,
    });
    const positive = promptText(prompt, i.positive);
    const negative = promptText(prompt, i.negative);
    if (positive !== null) summary.positive = positive;
    if (negative !== null) summary.negative = negative;
  }
  for (const node of nodes) {
    const i = node.inputs || {};
    const field = MODEL_LOADERS[node.class_type];
    if (field && typeof i[field] === 'string' && !summary.model) {
      summary.model = i[field];
      summary.modelLoader = node.class_type;
    }
    if (node.class_type === 'CLIPLoader') {
      summary.clip1 = i.clip_name;
      summary.clipType = i.type;
    }
    if (node.class_type === 'DualCLIPLoader') {
      summary.clip1 = i.clip_name1;
      summary.clip2 = i.clip_name2;
      summary.clipType = i.type;
    }
    if (node.class_type === 'VAELoader') summary.vae = i.vae_name;
    if (node.class_type === 'FluxGuidance') summary.guidance = i.guidance;
    if (/Empty.*LatentImage/.test(node.class_type)) {
      summary.width = i.width;
      summary.height = i.height;
    }
    if (node.class_type === 'LoraLoader' || node.class_type === 'LoraLoaderModelOnly') {
      summary.loras.push({
        name: i.lora_name,
        model: i.strength_model ?? 1,
        clip: i.strength_clip ?? i.strength_model ?? 1,
      });
    }
  }
  return summary;
}

function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function describe(path) {
  if (extname(path).toLowerCase() !== '.png') return {};
  const text = await readPngText(path).catch(() => ({}));
  const settings = text.comfymui ? parseJson(text.comfymui) : null;
  const summary = text.prompt ? summarizePrompt(parseJson(text.prompt)) : null;
  const requestToken = text.comfymui_request_id ? parseJson(text.comfymui_request_id) : null;
  return {
    ...(typeof requestToken === 'string' ? { requestToken } : {}),
    ...(settings && typeof settings === 'object' ? { settings } : {}),
    ...(summary ? { summary } : {}),
    ...(text.prompt ? {} : { external: true }),
  };
}

async function walk(dir, subfolder, depth, found) {
  if (depth > MAX_DEPTH || found.length >= MAX_FILES) return;
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.name.startsWith('.') || found.length >= MAX_FILES) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      await walk(path, subfolder ? `${subfolder}/${entry.name}` : entry.name, depth + 1, found);
    } else if (entry.isFile() && IMAGE_EXTENSIONS.has(extname(entry.name).toLowerCase())) {
      found.push({ path, filename: entry.name, subfolder });
    }
  }
}

const indexes = new Map();
const MAX_INDEXES = 8;

function createIndex(dir) {
  if (indexes.size >= MAX_INDEXES) {
    const [oldDir, old] = indexes.entries().next().value;
    old.watcher?.close();
    indexes.delete(oldDir);
  }
  const index = {
    entries: new Map(),
    items: [],
    dirty: new Set(),
    full: true,
    checkedAt: 0,
    pending: null,
    watcher: null,
  };
  try {
    index.watcher = watch(dir, { recursive: true }, (_event, filename) => {
      if (!filename) {
        index.full = true;
        return;
      }
      const path = resolve(dir, String(filename));
      const rel = relative(dir, path);
      if (
        !rel ||
        rel.startsWith(`..${sep}`) ||
        rel === '..' ||
        rel.split(sep).some((part) => part.startsWith('.'))
      )
        return;
      index.dirty.add(path);
    });
    index.watcher.unref();
    index.watcher.on('error', () => {
      index.watcher?.close();
      index.watcher = null;
      index.full = true;
    });
  } catch {
    /* Reconcile by TTL when recursive watching is unavailable. */
  }
  indexes.set(dir, index);
  return index;
}

// Explicit refresh and app-owned deletes reconcile immediately. File notifications
// handle external writes; a periodic full scan repairs missed OS events.
export function invalidateGallery(dir) {
  const index = indexes.get(resolve(dir));
  if (index) index.full = true;
}

export function closeGalleryIndexes() {
  for (const index of indexes.values()) index.watcher?.close();
  indexes.clear();
}

async function describeEntry(entry, previous) {
  let info;
  try {
    info = await lstat(entry.path);
  } catch {
    return null;
  }
  if (!info.isFile() || info.isSymbolicLink()) return null;
  const mtime = Math.round(info.mtimeMs);
  if (previous && previous.mtime === mtime && previous.size === info.size) return previous;
  return {
    filename: entry.filename,
    subfolder: entry.subfolder,
    type: 'output',
    mtime,
    size: info.size,
    ...(await describe(entry.path)),
  };
}

async function scanIndex(dir, index) {
  const found = [];
  await walk(dir, '', 0, found);
  const next = new Map();
  for (let i = 0; i < found.length; i += 16) {
    const batch = await Promise.all(
      found
        .slice(i, i + 16)
        .map(async (entry) => [
          entry.path,
          await describeEntry(entry, index.entries.get(entry.path)),
        ]),
    );
    for (const [path, item] of batch) if (item) next.set(path, item);
  }
  index.entries = next;
  index.checkedAt = Date.now();
}

async function updatePaths(dir, index, paths) {
  for (const path of paths) {
    const rel = relative(dir, path);
    const parents = rel.split(sep).slice(0, -1);
    let parent = dir;
    let symlink = false;
    for (const part of parents) {
      parent = join(parent, part);
      try {
        if ((await lstat(parent)).isSymbolicLink()) {
          symlink = true;
          break;
        }
      } catch {
        break;
      }
    }
    if (symlink) {
      index.entries.delete(path);
      continue;
    }
    let info;
    try {
      info = await lstat(path);
    } catch {
      /* A removed file or folder. */
    }
    if (
      info?.isDirectory() ||
      info?.isSymbolicLink() ||
      (!info &&
        (!IMAGE_EXTENSIONS.has(extname(path).toLowerCase()) ||
          [...index.entries.keys()].some((key) => key.startsWith(path + sep))))
    ) {
      index.full = true;
      continue;
    }
    if (rel.split(sep).length - 1 > MAX_DEPTH || !IMAGE_EXTENSIONS.has(extname(path).toLowerCase()))
      continue;
    const parts = rel.split(sep);
    const filename = parts.pop();
    const entry = await describeEntry(
      { path, filename, subfolder: parts.join('/') },
      index.entries.get(path),
    );
    if (entry && (index.entries.has(path) || index.entries.size < MAX_FILES))
      index.entries.set(path, entry);
    else index.entries.delete(path);
  }
}

export async function listGallery(dir, { force = false } = {}) {
  dir = resolve(dir);
  const index = indexes.get(dir) || createIndex(dir);
  // Touch the LRU order without opening another watcher.
  indexes.delete(dir);
  indexes.set(dir, index);
  while (index.pending) await index.pending;
  if (force) index.full = true;
  const ttl = index.watcher ? 30_000 : 2_000;
  if (!index.full && !index.dirty.size && Date.now() - index.checkedAt < ttl) return index.items;
  index.pending = (async () => {
    const paths = [...index.dirty];
    index.dirty.clear();
    if (index.full || Date.now() - index.checkedAt >= ttl) {
      index.full = false;
      await scanIndex(dir, index);
    } else {
      await updatePaths(dir, index, paths);
      if (index.full) {
        index.full = false;
        await scanIndex(dir, index);
      }
    }
    const items = [...index.entries.values()].sort((a, b) => b.mtime - a.mtime);
    if (items.length !== index.items.length || items.some((item, i) => item !== index.items[i]))
      index.items = items;
  })();
  try {
    await index.pending;
  } finally {
    index.pending = null;
  }
  return index.items;
}
