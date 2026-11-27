import { annotatedImage, options, type ImageRef, type ObjectInfo, type Workflow } from './domain';

export const REDGRAFT_NAME = 'LTX 2.5 REDGraft';
export const LTX_FPS = 24;
export const ltxSizes = [
  { label: '가로', width: 480, height: 320 },
  { label: '세로', width: 320, height: 480 },
  { label: '정사각형', width: 384, height: 384 },
] as const;
export const ltxFrameCounts = [49, 73, 97] as const;

export type LtxInput = {
  prompt: string;
  size: (typeof ltxSizes)[number];
  frames: (typeof ltxFrameCounts)[number];
};

const assetSpecs = [
  ['model', 'UNETLoader', 'unet_name', 'REDGraft-ltx25-sulphur2-int8-convrot-ComfyMCP.safetensors'],
  [
    'encoder',
    'CLIPLoader',
    'clip_name',
    'gemma4-12b-with-proj-ltx-2.5-comfy-int8-convrot.safetensors',
  ],
  ['videoVae', 'VAELoader', 'vae_name', 'ltx-2.5-video-vae-conv-bf16.safetensors'],
  ['audioVae', 'VAELoader', 'vae_name', 'ltx-2.5-audio-vae-bf16.safetensors'],
] as const;

type LtxAssets = Record<(typeof assetSpecs)[number][0], string>;

export function ltxModels(info: ObjectInfo | null) {
  const models = {} as LtxAssets;
  const missing: string[] = [];
  for (const [key, loader, field, filename] of assetSpecs) {
    const installed = options(info, loader, field).find(
      (name) => name.split(/[\\/]/).pop() === filename,
    );
    if (installed) models[key] = installed;
    else missing.push(filename);
  }
  return { models: missing.length ? null : models, missing };
}

export function buildLtxWorkflow(
  input: LtxInput,
  models: LtxAssets,
  seed: number,
  filenamePrefix: string,
  source?: ImageRef,
): Workflow {
  const { width, height } = input.size;
  const frames = input.frames;
  return {
    '1': {
      class_type: 'UNETLoader',
      inputs: { unet_name: models.model, weight_dtype: 'default' },
    },
    '2': {
      class_type: 'CLIPLoader',
      inputs: { clip_name: models.encoder, type: 'ltxv' },
    },
    '3': { class_type: 'VAELoader', inputs: { vae_name: models.videoVae } },
    '4': { class_type: 'VAELoader', inputs: { vae_name: models.audioVae } },
    '5': { class_type: 'CLIPTextEncode', inputs: { text: input.prompt.trim(), clip: ['2', 0] } },
    '6': { class_type: 'ConditioningZeroOut', inputs: { conditioning: ['5', 0] } },
    '7': {
      class_type: 'LTXVConditioning',
      inputs: { positive: ['5', 0], negative: ['6', 0], frame_rate: LTX_FPS },
    },
    '8': {
      class_type: 'EmptyLTXVLatentVideo',
      inputs: { width, height, length: frames, batch_size: 1 },
    },
    '9': {
      class_type: 'LTXVEmptyLatentAudio',
      inputs: { frames_number: frames, frame_rate: LTX_FPS, batch_size: 1, audio_vae: ['4', 0] },
    },
    '10': {
      class_type: 'LTXVConcatAVLatent',
      inputs: { video_latent: source ? ['21', 0] : ['8', 0], audio_latent: ['9', 0] },
    },
    '11': { class_type: 'KSamplerSelect', inputs: { sampler_name: 'euler' } },
    '12': {
      class_type: 'ManualSigmas',
      inputs: { sigmas: '1, 0.99375, 0.9875, 0.98125, 0.975, 0.909375, 0.725, 0.421875, 0' },
    },
    '13': {
      class_type: 'SamplerCustom',
      inputs: {
        model: ['1', 0],
        add_noise: true,
        noise_seed: seed,
        cfg: 1,
        positive: ['7', 0],
        negative: ['7', 1],
        sampler: ['11', 0],
        sigmas: ['12', 0],
        latent_image: ['10', 0],
      },
    },
    '14': { class_type: 'LTXVSeparateAVLatent', inputs: { av_latent: ['13', 0] } },
    '15': {
      class_type: 'VAEDecodeTiled',
      inputs: {
        samples: ['14', 0],
        vae: ['3', 0],
        tile_size: 256,
        overlap: 64,
        temporal_size: 32,
        temporal_overlap: 8,
      },
    },
    '16': {
      class_type: 'LTXVAudioVAEDecode',
      inputs: { samples: ['14', 1], audio_vae: ['4', 0] },
    },
    '17': {
      class_type: 'CreateVideo',
      inputs: { images: ['15', 0], audio: ['16', 0], fps: LTX_FPS },
    },
    '18': {
      class_type: 'SaveVideo',
      inputs: { video: ['17', 0], filename_prefix: filenamePrefix, format: 'mp4', codec: 'h264' },
    },
    ...(source && {
      '19': { class_type: 'LoadImage', inputs: { image: annotatedImage(source) } },
      '20': {
        class_type: 'ImageScale',
        inputs: { image: ['19', 0], upscale_method: 'bicubic', width, height, crop: 'center' },
      },
      '21': {
        class_type: 'LTXVImgToVideoInplace',
        inputs: { vae: ['3', 0], image: ['20', 0], latent: ['8', 0], strength: 1, bypass: false },
      },
    }),
  };
}
