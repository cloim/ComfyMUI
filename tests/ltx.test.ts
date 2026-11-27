import { describe, expect, it } from 'vitest';
import { buildWorkflow, defaults, reusableSettings, type ObjectInfo } from '../src/domain';
import {
  catalog,
  compatibleAssets,
  inferFamily,
  ltxBaseFamily,
  selectModel,
  familyFolder,
  validateSelection,
  withFamilyFolders,
} from '../src/models';
import { inferFamilyFromModelItem, resolveComfyModelEntry } from '../src/model-manager';
import { fitVideoSize } from '../src/ltx';
import { inferFamilyFromLoraItem } from '../src/lora-manager';

// LTX 2.5 lives in its own family folder like the image families.
const redgraft = 'LTX 2.5/REDGraft-ltx25-sulphur2-int8-convrot-ComfyMCP.safetensors';
const legacy = 'ltxv-2b-0.9.8-distilled.safetensors';
const lora = 'LTX-2.5/camera-dolly.safetensors';
const info: ObjectInfo = {
  UNETLoader: { input: { required: { unet_name: [[redgraft, 'flux1-dev.safetensors']] } } },
  CheckpointLoaderSimple: { input: { required: { ckpt_name: [[legacy]] } } },
  CLIPLoader: {
    input: {
      required: {
        clip_name: [
          [
            'gemma4-12b-with-proj-ltx-2.5-comfy-int8-convrot.safetensors',
            't5xxl_fp8_e4m3fn_scaled.safetensors',
          ],
        ],
      },
    },
  },
  VAELoader: {
    input: {
      required: {
        vae_name: [
          [
            'ltx-2.5-video-vae-conv-bf16.safetensors',
            'ltx-2.5-audio-vae-bf16.safetensors',
            'ae.safetensors',
          ],
        ],
      },
    },
  },
  LoraLoaderModelOnly: { input: { required: { lora_name: [[lora]] } } },
};
const entry = (family: string) => catalog(info).find((e) => e.family === family)!;

describe('LTX 2.5 video family', () => {
  it('infers LTX models and LoRAs like the other families', () => {
    expect(inferFamily(redgraft)).toBe('ltx2');
    expect(inferFamily('ltx-2.5-22b-distilled-transformer-bf16.safetensors')).toBe('ltx2');
    expect(inferFamily('LTX 2.5/renamed.safetensors')).toBe('ltx2');
    // LTX-Video 0.9.x is not supported.
    expect(inferFamily(legacy)).toBeNull();
    expect(catalog(info).some((e) => e.name === legacy)).toBe(false);
    expect(ltxBaseFamily('LTXV 2.5')).toBe('ltx2');
    expect(ltxBaseFamily('LTXV2')).toBe('ltx2');
    expect(ltxBaseFamily('LTXV')).toBeNull();
    expect(ltxBaseFamily('Flux.1 D')).toBeNull();
    expect(
      inferFamilyFromModelItem({
        base_model: 'LTXV 2.5',
        folder: '',
        file_name: 'renamed',
        file_path: '/models/renamed.safetensors',
      }),
    ).toBe('ltx2');
    expect(
      inferFamilyFromLoraItem({
        base_model: 'Unknown',
        folder: 'LTX-2.5',
        file_name: 'camera-dolly',
        file_path: '/loras/LTX-2.5/camera-dolly.safetensors',
      }),
    ).toBe('ltx2');
    expect(compatibleAssets(info, 'lora', 'ltx2')).toEqual([lora]);
    // A manual classification moves a renamed file to another family.
    expect(catalog(info, { 'model:flux1-dev.safetensors': 'ltx2' })).toContainEqual(
      expect.objectContaining({ name: 'flux1-dev.safetensors', family: 'ltx2' }),
    );
  });

  it('offers every family folder in the model folder list before it exists', () => {
    expect(withFamilyFolders(['Flux1.D', 'flux1.d/nunchaku', 'krea2', 'Archive'])).toEqual([
      'Flux1.D',
      'flux1.d/nunchaku',
      'krea2',
      'Archive',
      'MOSS',
      'Qwen 2.1',
      'LTX 2.5',
    ]);
  });

  it('loads LTX from a shared checkpoints path as a diffusion model, as CivitAI lists it', () => {
    const shared: ObjectInfo = {
      ...info,
      CheckpointLoaderSimple: { input: { required: { ckpt_name: [[redgraft]] } } },
    };
    expect(catalog(shared).filter((e) => e.name === redgraft)).toEqual([
      expect.objectContaining({ loader: 'UNETLoader', family: 'ltx2' }),
    ]);
    const item = {
      folder: 'LTX 2.5',
      file_name: 'REDGraft-ltx25-sulphur2-int8-convrot-ComfyMCP',
      file_path: '/host-models/diffusion_models/' + redgraft,
      sub_type: 'checkpoint',
      base_model: 'LTXV 2.5',
    };
    expect(
      resolveComfyModelEntry(item as never, shared, { [`model:${redgraft}`]: 'ltx2' }),
    ).toMatchObject({
      loader: 'UNETLoader',
      family: 'ltx2',
    });
  });

  it('keeps an image size for its video within the LTX range', () => {
    expect(fitVideoSize(768, 1024)).toEqual({ width: 768, height: 1024 });
    expect(fitVideoSize(1024, 576)).toEqual({ width: 1024, height: 576 });
    expect(fitVideoSize(2048, 1536)).toEqual({ width: 1920, height: 1440 });
    expect(fitVideoSize(1080, 1920)).toEqual({ width: 1080, height: 1920 });
    expect(fitVideoSize(4096, 512)).toEqual({ width: 1920, height: 256 });
  });

  it('saves downloads in the family folder with the spelling the server uses', () => {
    expect(familyFolder('ltx2')).toBe('LTX 2.5');
    expect(familyFolder('qwen21', ['Flux1.D', 'Qwen2.1'])).toBe('Qwen2.1');
    expect(familyFolder('qwen21', ['Qwen2.1', 'Qwen 2.1'])).toBe('Qwen 2.1');
    expect(familyFolder('flux', ['flux1.d/commons'])).toBe('Flux1.D');
  });

  it('switches an image setting to video with its encoders, VAEs and an HD size', () => {
    const s = selectModel({ ...defaults, width: 768, height: 1024 }, entry('ltx2'), info);
    expect(s).toMatchObject({
      architecture: 'ltx2',
      modelLoader: 'UNETLoader',
      clip1: 'gemma4-12b-with-proj-ltx-2.5-comfy-int8-convrot.safetensors',
      vae: 'ltx-2.5-video-vae-conv-bf16.safetensors',
      audioVae: 'ltx-2.5-audio-vae-bf16.safetensors',
      width: 720,
      height: 1280,
      steps: 8,
      cfg: 1,
      sampler: 'euler_ancestral',
    });
    expect(() => validateSelection(s, info)).not.toThrow();
    const image = selectModel(
      s,
      {
        id: 'UNETLoader:flux1-dev.safetensors',
        name: 'flux1-dev.safetensors',
        loader: 'UNETLoader',
        family: 'flux',
        format: 'Diffusion',
      },
      info,
    );
    expect(image).toMatchObject({ architecture: 'flux', width: 768, height: 1024, audioVae: '' });
  });

  it('builds the audio-video graph with LoRAs and crops a padded HD latent back', () => {
    const s = {
      ...selectModel(defaults, entry('ltx2'), info),
      positive: 'clouds drift',
      width: 1280,
      height: 720,
      seconds: 10,
      audio: false,
      seed: 456,
      loras: [{ name: lora, model: 0.7, clip: 0 }],
    };
    const graph = buildWorkflow(s);
    expect(graph['1']).toEqual({
      class_type: 'UNETLoader',
      inputs: { unet_name: redgraft, weight_dtype: 'default' },
    });
    expect(graph['8'].inputs).toMatchObject({ width: 1280, height: 736, length: 241 });
    expect(graph['22'].inputs).toMatchObject({ width: 1280, height: 720 });
    expect(graph['17'].inputs).toEqual({ images: ['22', 0], fps: 24 });
    expect(graph['9'].inputs.frames_number).toBe(241);
    expect(graph['16']).toBeUndefined();
    expect(graph['100'].inputs).toEqual({ model: ['1', 0], lora_name: lora, strength_model: 0.7 });
    expect(graph['13'].inputs).toMatchObject({ model: ['100', 0], noise_seed: 456 });
    expect(graph['18'].inputs.filename_prefix).toBe('video/ComfyMUI');
  });

  it('starts from a first frame with the selected sampling options', () => {
    const s = {
      ...selectModel(defaults, entry('ltx2'), info),
      positive: 'clouds drift',
      negative: 'hard cuts',
      cfg: 2,
      steps: 12,
      sampler: 'heun',
      frameStrength: 0.75,
      firstFrame: {
        base: '/comfy',
        image: { filename: 'input.png', subfolder: '', type: 'input' },
      },
    };
    const graph = buildWorkflow(s);
    expect(graph['19'].inputs.image).toBe('input.png [input]');
    expect(graph['21'].inputs).toMatchObject({ vae: ['3', 0], strength: 0.75 });
    expect(graph['10'].inputs.video_latent).toEqual(['21', 0]);
    expect(graph['16']).toBeDefined();
    expect(graph['6'].inputs.text).toBe('hard cuts');
    expect(graph['11'].inputs.sampler_name).toBe('heun');
    expect(graph['12']).toMatchObject({ class_type: 'LTXVScheduler', inputs: { steps: 12 } });
    expect(graph['13'].inputs).toMatchObject({ latent_image: ['10', 0] });
    // Reusing settings keeps a video's first frame but drops it from image settings.
    expect(reusableSettings(s).firstFrame).toEqual(s.firstFrame);
    expect(reusableSettings({ ...s, architecture: 'flux' }).firstFrame).toBeUndefined();
  });

  it('accepts FHD sizes and rejects video lengths and sizes LTX cannot render', () => {
    const s = { ...selectModel(defaults, entry('ltx2'), info), positive: 'waves' };
    expect(() => buildWorkflow({ ...s, width: 1920, height: 1080 })).not.toThrow();
    expect(() => buildWorkflow({ ...s, seconds: 25 })).toThrow('1~20초');
    expect(() => buildWorkflow({ ...s, width: 2048 })).toThrow('256~1920px');
    expect(() => buildWorkflow({ ...s, fps: 60 })).toThrow('FPS');
  });
});
