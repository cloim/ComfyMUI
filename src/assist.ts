import { request } from './api';
import {
  annotatedImage,
  newId,
  options,
  type ImageRef,
  type ObjectInfo,
  type Workflow,
} from './domain';
import { isVideoFamily } from './models';

// The create screen's helper writes prompts with a Qwen3-VL text encoder that is already
// installed for Krea2 or Qwen 2.1. It runs inside ComfyUI, so it can look at a photo and
// needs no outside AI service. The 4B encoder answers in seconds once loaded.
const ENCODERS = [
  { test: /qwen3[._-]?vl[_ .-]?4b/i, type: 'krea2' },
  { test: /qwen3[._-]?vl[_ .-]?8b/i, type: 'qwen_image' },
];
export type AssistEncoder = { clip: string; type: string };
export function assistEncoder(info: ObjectInfo | null): AssistEncoder | null {
  if (!info?.TextGenerate || !info.PreviewAny) return null;
  const list = options(info, 'CLIPLoader', 'clip_name');
  for (const { test, type } of ENCODERS) {
    const clip = list.find((name) => test.test(name));
    if (clip) return { clip, type };
  }
  return null;
}

// write: an idea in words. remake: a new image like the photo. edit: change the photo
// itself (Qwen 2.1). motion: the photo becomes the first frame of a video (LTX).
export type AssistMode = 'write' | 'remake' | 'edit' | 'motion';
export type AssistRequest = {
  mode: AssistMode;
  idea: string;
  family: string;
  // LoRA trigger words of the selected character or style LoRAs.
  triggers?: string[];
  audio?: boolean;
};

const RULES =
  'The request may be written in Korean or another language: understand it and write in English. Keep every word written in Latin letters exactly as given, with its letter case, because it may be a LoRA trigger word. Output only the final text, with no preamble, headings, quotes, markdown or notes.';
const IMAGE_STYLE =
  'Write one paragraph of natural English prose (60 to 120 words) for a text-to-image model: the main subject first, then their appearance, clothing, pose and expression, the setting, the lighting, the camera framing and lens, and the overall mood. Be concrete and visual.';
const VIDEO_STYLE =
  'Write one paragraph of present-tense English (80 to 150 words) for a text-to-video model. Start with the main action, then describe the movements and gestures in the order they happen, how the camera moves, and how the light and the setting change. Keep it physically plausible and continuous, with no scene cuts.';

export function assistInstruction(r: AssistRequest): string {
  const idea = r.idea.trim();
  const triggers = (r.triggers || []).filter(Boolean);
  const character = triggers.length
    ? ` The main subject is the character "${triggers.join(', ')}": refer to them with exactly these words.`
    : '';
  const sound = r.audio ? ' End with one short sentence about the sounds that are heard.' : '';
  if (r.mode === 'edit')
    return `Look at the photo. Write one or two English sentences that tell an image-editing model how to change this photo. Requested change: ${idea}. State exactly what changes, then state that the person's face and identity, the pose, the framing, the background and the lighting stay the same unless the request changes them. ${RULES}`;
  if (r.mode === 'motion')
    return `Look at the photo: it is the first frame of a video. ${VIDEO_STYLE} Keep the people and the place exactly as they appear in the photo and describe them only briefly.${character}${sound} Requested motion: ${idea || 'natural, subtle motion that suits the scene'}. ${RULES}`;
  if (r.mode === 'remake')
    return `Look at the photo. ${IMAGE_STYLE} Recreate the photo's composition, pose, setting, lighting, framing and mood${character ? ', but the person is a different character: do not describe their face, hair or eye colour from the photo' : ''}.${character}${idea ? ` Apply this change: ${idea}.` : ''} ${RULES}`;
  if (isVideoFamily(r.family))
    return `${VIDEO_STYLE} Describe the subject's appearance and the setting once, briefly.${character}${sound} Request: ${idea}. ${RULES}`;
  return `${IMAGE_STYLE} Keep every detail of the request and fill in what it leaves open.${character} Request: ${idea}. ${RULES}`;
}

// Small models sometimes wrap the answer in quotes or a label; the prompt field gets the
// bare text on one line.
export function cleanAssistText(text: string) {
  const unquote = (v: string) => v.replace(/^["'“”‘’`]+|["'“”‘’`]+$/g, '').trim();
  const label = /^(?:\*\*)?(?:prompt|instruction|edit instruction|final prompt)\s*:(?:\*\*)?\s*/i;
  const flat = text
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
  return unquote(unquote(flat).replace(label, ''));
}

export function buildAssistWorkflow(
  encoder: AssistEncoder,
  instruction: string,
  mode: AssistMode,
  image?: ImageRef,
  seed = Math.floor(Math.random() * 2 ** 32),
): Workflow {
  const w: Workflow = {
    '1': { class_type: 'CLIPLoader', inputs: { clip_name: encoder.clip, type: encoder.type } },
    '3': {
      class_type: 'TextGenerate',
      inputs: {
        clip: ['1', 0],
        prompt: instruction,
        max_length: mode === 'edit' ? 160 : 420,
        // An edit should follow the request closely; prompts may vary from run to run.
        sampling_mode: 'on',
        'sampling_mode.temperature': mode === 'edit' ? 0.3 : 0.7,
        'sampling_mode.top_k': 64,
        'sampling_mode.top_p': 0.95,
        'sampling_mode.min_p': 0.05,
        'sampling_mode.repetition_penalty': 1.05,
        'sampling_mode.seed': seed,
        thinking: false,
      },
    },
    '4': { class_type: 'PreviewAny', inputs: { source: ['3', 0] } },
  };
  if (image) {
    w['2'] = { class_type: 'LoadImage', inputs: { image: annotatedImage(image) } };
    w['3'].inputs.image = ['2', 0];
  }
  return w;
}

type AssistHistory = Record<
  string,
  {
    outputs?: Record<string, { text?: string[] }>;
    status?: { completed?: boolean; status_str?: string; messages?: [string, any][] };
  }
>;

// Runs the helper ahead of queued generations. Its own client id keeps its progress
// events away from the app's socket, so it never shows up as a generation.
export async function runAssist(
  base: string,
  workflow: Workflow,
  { signal, timeout = 240000 }: { signal?: AbortSignal; timeout?: number } = {},
): Promise<string> {
  const id = newId();
  await request(base, '/prompt', {
    method: 'POST',
    signal,
    body: JSON.stringify({
      prompt: workflow,
      prompt_id: id,
      client_id: `comfymui-assist-${id}`,
      front: true,
    }),
  });
  const started = Date.now();
  while (Date.now() - started < timeout) {
    await new Promise((resolve) => setTimeout(resolve, 800));
    if (signal?.aborted) throw new DOMException('cancelled', 'AbortError');
    const history = await request<AssistHistory>(base, `/history/${encodeURIComponent(id)}`, {
      signal,
    }).catch(() => ({}) as AssistHistory);
    const item = history[id];
    if (!item) continue;
    if (item.status?.status_str === 'error') {
      const error = item.status.messages?.find(([type]) => type === 'execution_error')?.[1];
      throw new Error(
        `프롬프트를 쓰지 못했어요${error?.exception_message ? `: ${String(error.exception_message).trim()}` : ''}`,
      );
    }
    if (item.status?.completed) {
      const text = cleanAssistText(item.outputs?.['4']?.text?.[0] || '');
      if (!text) throw new Error('프롬프트를 쓰지 못했어요. 다시 시도해 주세요');
      return text;
    }
  }
  throw new Error('프롬프트 작성이 너무 오래 걸려요. 서버 대기열을 확인해 주세요');
}

// A size close to about one megapixel with the photo's aspect ratio, in multiples of 32.
export function fitImageSize(width: number, height: number, megapixels = 1.05) {
  const ratio = width / height;
  const h = Math.sqrt((megapixels * 1024 * 1024) / ratio);
  const fit = (v: number) => Math.min(2048, Math.max(256, Math.round(v / 32) * 32));
  return { width: fit(h * ratio), height: fit(h) };
}
