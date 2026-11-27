import type { Generation, Workflow } from './domain';

// Video settings of the create screen. Values missing from older settings use these.
export const videoDefaults = { seconds: 6, fps: 24, audio: true, frameStrength: 1 };
export const ltxSizes = [
  { name: 'HD 가로', ratio: '16:9', w: 1280, h: 720 },
  { name: 'HD 세로', ratio: '9:16', w: 720, h: 1280 },
  { name: 'FHD 가로', ratio: '16:9', w: 1920, h: 1080 },
  { name: 'FHD 세로', ratio: '9:16', w: 1080, h: 1920 },
  { name: '정사각', ratio: '1:1', w: 768, h: 768 },
  { name: '빠른 확인', ratio: '16:9', w: 768, h: 432 },
];
export const ltxFrameRates = [16, 24, 25, 30] as const;

export function videoOptions(s: Generation) {
  return {
    seconds: s.seconds ?? videoDefaults.seconds,
    fps: s.fps ?? videoDefaults.fps,
    audio: s.audio ?? videoDefaults.audio,
    frameStrength: s.frameStrength ?? videoDefaults.frameStrength,
  };
}

// A video size closest to an image size: same aspect ratio, 256~1920px, multiples of 8.
export function fitVideoSize(width: number, height: number) {
  const scale = Math.min(1, 1920 / Math.max(width, height));
  const fit = (v: number) => Math.min(1920, Math.max(256, Math.round((v * scale) / 8) * 8));
  return { width: fit(width), height: fit(height) };
}

export function ltxFrames(seconds: number, fps: number) {
  return Math.max(9, Math.round((seconds * fps - 1) / 8) * 8 + 1);
}

export function validateVideo(s: Generation) {
  const { seconds, fps, frameStrength } = videoOptions(s);
  if (![s.width, s.height].every((size) => size >= 256 && size <= 1920))
    throw new Error('영상의 너비와 높이는 256~1920px로 입력해 주세요');
  if (!Number.isFinite(seconds) || seconds < 1 || seconds > 20)
    throw new Error('영상 길이는 1~20초로 입력해 주세요');
  if (!ltxFrameRates.some((rate) => rate === fps)) throw new Error('FPS를 다시 선택해 주세요');
  if (s.cfg < 1 || s.cfg > 10) throw new Error('영상 CFG는 1~10으로 입력해 주세요');
  if (!Number.isFinite(frameStrength) || frameStrength < 0 || frameStrength > 1)
    throw new Error('첫 프레임 강도는 0~1로 입력해 주세요');
}

// LTX 2.5 samples video and audio latents together; `source` is the first frame as a
// LoadImage path and `modelNode` the loader of the selected model.
export function buildLtxWorkflow(
  s: Generation,
  modelNode: Workflow[string],
  source?: string,
): Workflow {
  const { seconds, fps, audio, frameStrength } = videoOptions(s);
  const { width, height, steps, cfg } = s;
  const latentWidth = Math.ceil(width / 32) * 32;
  const latentHeight = Math.ceil(height / 32) * 32;
  const crop = width !== latentWidth || height !== latentHeight;
  const frames = ltxFrames(seconds, fps);
  const videoLatent = source ? ['21', 0] : ['8', 0];
  const vae = ['3', 0];
  const negative = s.negative.trim();
  const w: Workflow = {
    '1': modelNode,
    '2': { class_type: 'CLIPLoader', inputs: { clip_name: s.clip1, type: 'ltxv' } },
    '3': { class_type: 'VAELoader', inputs: { vae_name: s.vae } },
    '4': { class_type: 'VAELoader', inputs: { vae_name: s.audioVae } },
    '5': { class_type: 'CLIPTextEncode', inputs: { text: s.positive.trim(), clip: ['2', 0] } },
    // A negative prompt only takes effect when CFG is above 1.
    '6':
      cfg > 1 && negative
        ? { class_type: 'CLIPTextEncode', inputs: { text: negative, clip: ['2', 0] } }
        : { class_type: 'ConditioningZeroOut', inputs: { conditioning: ['5', 0] } },
    '7': {
      class_type: 'LTXVConditioning',
      inputs: { positive: ['5', 0], negative: ['6', 0], frame_rate: fps },
    },
    '8': {
      class_type: 'EmptyLTXVLatentVideo',
      inputs: { width: latentWidth, height: latentHeight, length: frames, batch_size: 1 },
    },
    '9': {
      class_type: 'LTXVEmptyLatentAudio',
      inputs: { frames_number: frames, frame_rate: fps, batch_size: 1, audio_vae: ['4', 0] },
    },
    '10': {
      class_type: 'LTXVConcatAVLatent',
      inputs: { video_latent: videoLatent, audio_latent: ['9', 0] },
    },
    '14': { class_type: 'LTXVSeparateAVLatent', inputs: { av_latent: ['13', 0] } },
    '11': { class_type: 'KSamplerSelect', inputs: { sampler_name: s.sampler } },
    '12':
      steps === 8
        ? {
            class_type: 'ManualSigmas',
            inputs: { sigmas: '1, 0.99375, 0.9875, 0.98125, 0.975, 0.909375, 0.725, 0.421875, 0' },
          }
        : {
            class_type: 'LTXVScheduler',
            inputs: {
              steps,
              max_shift: 2.05,
              base_shift: 0.95,
              stretch: true,
              terminal: 0.1,
              latent: videoLatent,
            },
          },
    '13': {
      class_type: 'SamplerCustom',
      inputs: {
        model: ['1', 0],
        add_noise: true,
        noise_seed: s.seed,
        cfg,
        positive: ['7', 0],
        negative: ['7', 1],
        sampler: ['11', 0],
        sigmas: ['12', 0],
        latent_image: ['10', 0],
      },
    },
    '15': {
      class_type: 'VAEDecodeTiled',
      inputs: {
        samples: ['14', 0],
        vae,
        tile_size: 256,
        overlap: 64,
        temporal_size: 32,
        temporal_overlap: 8,
      },
    },
    ...(audio && {
      '16': {
        class_type: 'LTXVAudioVAEDecode',
        inputs: { samples: ['14', 1], audio_vae: ['4', 0] },
      },
    }),
    '17': {
      class_type: 'CreateVideo',
      inputs: { images: [crop ? '22' : '15', 0], ...(audio && { audio: ['16', 0] }), fps },
    },
    '18': {
      class_type: 'SaveVideo',
      inputs: { video: ['17', 0], filename_prefix: 'video/ComfyMUI', format: 'mp4', codec: 'h264' },
    },
    ...(source && {
      '19': { class_type: 'LoadImage', inputs: { image: source } },
      '20': {
        class_type: 'ImageScale',
        inputs: {
          image: ['19', 0],
          upscale_method: 'bicubic',
          width: latentWidth,
          height: latentHeight,
          crop: 'center',
        },
      },
      '21': {
        class_type: 'LTXVImgToVideoInplace',
        inputs: {
          vae,
          image: ['20', 0],
          latent: ['8', 0],
          strength: frameStrength,
          bypass: false,
        },
      },
    }),
    ...(crop && {
      '22': {
        class_type: 'ImageScale',
        inputs: { image: ['15', 0], upscale_method: 'bicubic', width, height, crop: 'center' },
      },
    }),
  };
  // LoRAs patch only the video model, as in the other single-encoder families.
  let model = '1';
  s.loras.forEach((l, i) => {
    const id = String(100 + i);
    w[id] = {
      class_type: 'LoraLoaderModelOnly',
      inputs: { model: [model, 0], lora_name: l.name, strength_model: l.model },
    };
    model = id;
  });
  w['13'].inputs.model = [model, 0];
  return w;
}
