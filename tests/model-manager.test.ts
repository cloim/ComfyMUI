import { describe, expect, it } from 'vitest';
import type { ObjectInfo } from '../src/domain';
import {
  formatModelSubType,
  inferFamilyFromModelItem,
  isSpecializedModelPath,
  resolveComfyModelEntry,
  resolveComfyModelName,
} from '../src/model-manager';

const modelInfo: ObjectInfo = {
  CheckpointLoaderSimple: {
    input: { required: { ckpt_name: [['Flux1.D/flux-test.safetensors']] } },
  },
  UNETLoader: {
    input: { required: { unet_name: [['Krea2/krea2-test.safetensors']] } },
  },
};

describe('Model Manager domain helpers', () => {
  it('infers ComfyMUI family from model base_model and path', () => {
    expect(
      inferFamilyFromModelItem({
        base_model: 'Flux.1 D',
        folder: 'Flux1.D',
        file_name: 'flux-model',
        file_path: 'E:/ComfyUI/models/checkpoints/Flux1.D/flux-model.safetensors',
      }),
    ).toBe('flux');
    expect(
      inferFamilyFromModelItem({
        base_model: 'Unknown',
        folder: 'Krea2',
        file_name: 'krea2_turbo_int8',
        file_path: 'E:/ComfyUI/models/diffusion_models/Krea2/krea2_turbo_int8.safetensors',
      }),
    ).toBe('krea2');
    expect(
      inferFamilyFromModelItem({
        base_model: 'MOSS',
        folder: '',
        file_name: 'moss_image_sft',
        file_path: 'E:/ComfyUI/models/diffusion_models/moss_image_sft.safetensors',
      }),
    ).toBe('moss');
    expect(
      inferFamilyFromModelItem({
        base_model: 'Qwen',
        folder: 'Qwen',
        file_name: 'qwen_image_2.1',
        file_path: 'E:/ComfyUI/models/diffusion_models/Qwen/qwen_image_2.1.safetensors',
      }),
    ).toBe('qwen21');
  });

  it('identifies specialized workflow model paths', () => {
    expect(
      isSpecializedModelPath(
        'E:/ComfyUI/models/diffusion_models/Flux1.D/nunchaku/svdq-int4_r32-flux.1-dev.safetensors',
      ),
    ).toBe(true);
    expect(
      isSpecializedModelPath(
        'E:/ComfyUI/models/diffusion_models/Flux1.D/kontext/flux1-dev-kontext_fp8_scaled.safetensors',
      ),
    ).toBe(true);
    expect(
      isSpecializedModelPath(
        'E:/ComfyUI/models/diffusion_models/Krea2/krea2_turbo_int8_convrot.safetensors',
      ),
    ).toBe(false);
  });

  it('formats sub_type and GGUF badges accurately', () => {
    expect(
      formatModelSubType({
        sub_type: 'checkpoint',
        file_path: 'E:/ComfyUI/models/checkpoints/Flux1.D/model.safetensors',
      }),
    ).toBe('체크포인트');
    expect(
      formatModelSubType({
        sub_type: 'diffusion_model',
        file_path: 'E:/ComfyUI/models/diffusion_models/Flux1.D/model.gguf',
      }),
    ).toBe('GGUF');
    expect(
      formatModelSubType({
        sub_type: 'diffusion_model',
        file_path: 'E:/ComfyUI/models/diffusion_models/Krea2/krea2.safetensors',
      }),
    ).toBe('Diffusion');
  });

  it('resolves model item to ComfyUI ModelEntry and respects manual family assignments', () => {
    expect(
      resolveComfyModelName(
        {
          folder: 'Flux1.D',
          file_name: 'flux-test',
          file_path: '/data/models-view/checkpoints/Flux1.D/flux-test.safetensors',
          sub_type: 'checkpoint',
        },
        modelInfo,
      ),
    ).toBe('Flux1.D/flux-test.safetensors');

    const kreaEntry = resolveComfyModelEntry(
      {
        base_model: 'Krea2',
        folder: 'Krea2',
        file_name: 'krea2-test',
        file_path: '/data/models-view/diffusion_models/Krea2/krea2-test.safetensors',
        sub_type: 'diffusion_model',
      },
      modelInfo,
      {},
    );
    expect(kreaEntry).toEqual({
      id: 'UNETLoader:Krea2/krea2-test.safetensors',
      name: 'Krea2/krea2-test.safetensors',
      loader: 'UNETLoader',
      family: 'krea2',
      format: 'Diffusion',
    });
  });
});
