import { describe, it, expect } from 'vitest';
import {
  defaults,
  buildWorkflow,
  parseSettings,
  validateAgainstServer,
  type ObjectInfo,
} from '../src/domain';
import {
  catalog,
  inferFamily,
  compatibleAssets,
  selectModel,
  validateSelection,
  comboOptions,
  families,
  qualityProfiles,
  checkQualityIssues,
  getOptimalQualitySettings,
  isOptimalQuality,
  sortModelEntries,
  applyModelReorder,
} from '../src/models';
const info: ObjectInfo = {
  CheckpointLoaderSimple: {
    input: {
      required: { ckpt_name: [['Flux1.D/checkpoint.safetensors', 'SDXL/photo.safetensors']] },
    },
  },
  UNETLoader: {
    input: {
      required: {
        unet_name: [
          [
            'Flux1.D/diffusion.safetensors',
            'Krea2/krea2_turbo.safetensors',
            'moss_image_sft.safetensors',
            'qwen_image_2.1.safetensors',
            'Qwen/qwen_image.safetensors',
            'Wan/wan2.2.safetensors',
            'Flux1.D/kontext/model.safetensors',
          ],
        ],
      },
    },
  },
  UnetLoaderGGUF: {
    input: { required: { unet_name: [['Flux1.D/forest.gguf', 'qwen_image_2.1-Q4.gguf']] } },
  },
  UnetLoaderGGUFAdvanced: { input: { required: { unet_name: [['Flux1.D/forest.gguf']] } } },
  GGUFLoaderKJ: {
    input: {
      required: {
        model_name: ['COMBO', { options: ['Flux1.D/forest.gguf', 'Flux1.D/kj-only.gguf'] }],
      },
    },
  },
  LoraLoader: {
    input: {
      required: {
        lora_name: [
          [
            'Flux1.D/style.safetensors',
            'Krea2/style.safetensors',
            'moss_style.safetensors',
            'qwen_image_2.1_style.safetensors',
            'Qwen/old-style.safetensors',
            'unknown.safetensors',
          ],
        ],
      },
    },
  },
  DualCLIPLoader: {
    input: {
      required: {
        clip_name1: [['Flux1.D/clip_l.safetensors', 'Flux1.D/t5xxl_fp8.safetensors']],
        clip_name2: [['Flux1.D/clip_l.safetensors', 'Flux1.D/t5xxl_fp8.safetensors']],
      },
    },
  },
  DualCLIPLoaderGGUF: {
    input: {
      required: {
        clip_name1: [['Flux1.D/clip_l.safetensors', 'Flux1.D/t5xxl-Q8.gguf']],
        clip_name2: [['Flux1.D/clip_l.safetensors', 'Flux1.D/t5xxl-Q8.gguf']],
      },
    },
  },
  CLIPLoader: {
    input: {
      required: {
        clip_name: [
          [
            'Qwen/qwen3vl_4b.safetensors',
            'qwen3.5_9b_gptq.safetensors',
            'qwen3vl_8b_int8.safetensors',
            'Qwen/qwen_2.5_vl.safetensors',
          ],
        ],
      },
    },
  },
  CLIPLoaderGGUF: { input: { required: { clip_name: [['qwen3vl_8b-Q4.gguf']] } } },
  VAELoader: {
    input: {
      required: {
        vae_name: [
          [
            'Flux1.D/ae.safetensors',
            'Qwen/qwen_image_vae.safetensors',
            'flux2-vae_small.safetensors',
            'qwen_image_2.1_vae.safetensors',
            'Wan/wan_vae.safetensors',
          ],
        ],
      },
    },
  },
};
describe('four directly supported families', () => {
  it('exposes exactly the requested four families and excludes older Qwen and reference-image models', () => {
    expect(families.map((f) => f.id)).toEqual(['flux', 'krea2', 'moss', 'qwen21']);
    const models = catalog(info);
    expect(models).toHaveLength(8);
    expect(models.filter((e) => e.format === 'GGUF')).toHaveLength(3);
    expect(models.some((e) => /SDXL|Wan|kontext|Qwen\/qwen_image/.test(e.name))).toBe(false);
    expect(inferFamily('Flux1.D\\krea\\flux1-krea.safetensors')).toBe('flux');
    expect(inferFamily('flux2-klein.gguf')).toBeNull();
    expect(inferFamily('qwen_image_2.1_int8.safetensors')).toBe('qwen21');
  });
  it('selects the correct shared Qwen encoders and VAE for each architecture', () => {
    const expected = {
      flux: ['clip_l', 'ae.'],
      krea2: ['qwen3vl_4b', 'qwen_image_vae'],
      moss: ['qwen3.5_9b', 'flux2-vae'],
      qwen21: ['qwen3vl_8b', 'qwen_image_2.1_vae'],
    };
    for (const family of families) {
      const s = selectModel(
        defaults,
        catalog(info).find((e) => e.family === family.id)!,
        info,
      );
      expect(s.clip1).toContain(expected[family.id][0]);
      expect(s.vae).toContain(expected[family.id][1]);
      expect(() => validateSelection(s, info)).not.toThrow();
    }
  });
  it('does not mix old Qwen LoRA with Qwen 2.1, and persists an explicit manual classification', () => {
    expect(compatibleAssets(info, 'lora', 'qwen21')).toEqual(['qwen_image_2.1_style.safetensors']);
    expect(compatibleAssets(info, 'lora', 'flux', { 'lora:unknown.safetensors': 'flux' })).toEqual([
      'Flux1.D/style.safetensors',
      'unknown.safetensors',
    ]);
  });
  it('clears incompatible LoRA and applies usable sampling defaults on a family change', () => {
    const s = selectModel(
      { ...defaults, loras: [{ name: 'Flux1.D/style.safetensors', model: 1, clip: 1 }] },
      catalog(info).find((e) => e.family === 'krea2')!,
      info,
    );
    expect(s.loras).toEqual([]);
    expect(s.cfg).toBe(1);
    expect(s.steps).toBe(8);
    expect(s.scheduler).toBe('simple');
  });
  it('reads modern COMBO options and validates installed values', () => {
    expect(comboOptions(info, 'GGUFLoaderKJ', 'model_name')).toHaveLength(2);
    expect(() =>
      validateAgainstServer(
        { '1': { class_type: 'GGUFLoaderKJ', inputs: { model_name: 'absent.gguf' } } },
        info,
      ),
    ).toThrow('설치값');
  });
});
describe('family-specific native graphs', () => {
  it.each(families.map((f) => f.id))(
    'builds %s with matching text encoder, VAE and unchanged geometry',
    (family) => {
      const s = selectModel(
        defaults,
        catalog(info).find((e) => e.family === family)!,
        info,
      );
      const w = buildWorkflow({ ...s, width: 768, height: 1024, batch: 3, seed: 99 });
      expect(w['8'].inputs.type).toBe(families.find((f) => f.id === family)!.clipType);
      expect(w['9'].inputs.vae_name).toBe(s.vae);
      expect(w['4'].inputs).toEqual({ width: 768, height: 1024, batch_size: 3 });
      expect(w['5'].inputs.seed).toBe(99);
      expect(w['6'].inputs.vae).toEqual(['9', 0]);
      expect(w['4'].class_type).toBe(
        ['moss', 'qwen21'].includes(family) ? 'EmptyFlux2LatentImage' : 'EmptySD3LatentImage',
      );
      if (family === 'qwen21') {
        expect(w['2'].class_type).toBe('TextEncodeQwenImage21');
        expect(w['2'].inputs.images).toEqual({});
        expect(w['5'].inputs.negative).toEqual(['2', 1]);
      }
      if (family === 'krea2') {
        expect(w['20']).toBeUndefined();
        expect(w['5'].inputs.model).toEqual(['1', 0]);
        expect(w['3'].class_type).toBe('ConditioningZeroOut');
      }
    },
  );
  it('chains model-only LoRA for Krea2 while preserving the text encoder', () => {
    const s = selectModel(
      defaults,
      catalog(info).find((e) => e.family === 'krea2')!,
      info,
    );
    const w = buildWorkflow({
      ...s,
      loras: [{ name: 'Krea2/style.safetensors', model: 0.7, clip: 0 }],
    });
    expect(w['100'].class_type).toBe('LoraLoaderModelOnly');
    expect(w['5'].inputs.model).toEqual(['100', 0]);
    expect(w['2'].inputs.clip).toEqual(['8', 0]);
  });
  it('uses GGUF diffusion and mixed GGUF Flux text encoders with the correct LoRA outputs', () => {
    const s = selectModel(
      defaults,
      catalog(info).find((e) => e.name === 'Flux1.D/forest.gguf')!,
      info,
    );
    const w = buildWorkflow({
      ...s,
      clip2: 'Flux1.D/t5xxl-Q8.gguf',
      loras: [{ name: 'Flux1.D/style.safetensors', model: 0.8, clip: 0.5 }],
    });
    expect(w['1'].class_type).toBe('UnetLoaderGGUF');
    expect(w['8'].class_type).toBe('DualCLIPLoaderGGUF');
    expect(w['100'].inputs.clip).toEqual(['8', 0]);
    expect(w['2'].inputs.clip).toEqual(['100', 1]);
  });
  it('restores previous Flux snapshots and rejects non-aligned high-channel latent dimensions', () => {
    const s = selectModel(
      defaults,
      catalog(info).find((e) => e.family === 'flux')!,
      info,
    );
    const old = { ...s } as Partial<typeof s>;
    delete old.modelLoader;
    expect(parseSettings(old).modelLoader).toBe('CheckpointLoaderSimple');
    const q = selectModel(
      s,
      catalog(info).find((e) => e.family === 'qwen21')!,
      info,
    );
    expect(() => buildWorkflow({ ...q, width: 752 })).toThrow('32');
  });
  it('recommends optimal quality parameters and detects quality degradation issues per family', () => {
    // 1. Profile definitions
    expect(qualityProfiles.krea2.steps).toBe(8);
    expect(qualityProfiles.krea2.sampler).toBe('euler');
    expect(qualityProfiles.flux.steps).toBe(24);
    expect(qualityProfiles.flux.cfg).toBe(1.0);
    expect(qualityProfiles.moss.cfg).toBe(4.0);
    expect(qualityProfiles.qwen21.steps).toBe(28);

    // 2. Optimal setting getter
    const kreaOpt = getOptimalQualitySettings('krea2');
    expect(kreaOpt.steps).toBe(8);
    expect(kreaOpt.sampler).toBe('euler');
    expect(kreaOpt.cfg).toBe(1.0);

    // 3. Quality issue detection
    // Krea2 with SDE sampler and 16 steps should report 2 issues
    const badKreaIssues = checkQualityIssues({
      ...defaults,
      architecture: 'krea2',
      sampler: 'dpmpp_2m_sde',
      steps: 16,
    });
    expect(badKreaIssues.some((i) => i.id === 'sde-artifact')).toBe(true);
    expect(badKreaIssues.some((i) => i.id === 'krea-steps')).toBe(true);

    // Flux with high CFG should report flux-cfg issue
    const badFluxIssues = checkQualityIssues({
      ...defaults,
      architecture: 'flux',
      cfg: 3.5,
    });
    expect(badFluxIssues.some((i) => i.id === 'flux-cfg')).toBe(true);

    // Optimal settings should have zero issues and return true for isOptimalQuality
    const optimalFlux = {
      ...defaults,
      architecture: 'flux' as const,
      sampler: 'euler',
      scheduler: 'simple',
      steps: 24,
      cfg: 1.0,
      guidance: 3.5,
    };
    expect(checkQualityIssues(optimalFlux)).toHaveLength(0);
    expect(isOptimalQuality(optimalFlux)).toBe(true);
  });
  it('reorders model entries per family while preserving other family orders', () => {
    const all = catalog(info);
    const fluxIds = all.filter((e) => e.family === 'flux').map((e) => e.id);
    expect(fluxIds.length).toBeGreaterThanOrEqual(3);
    const reversed = [...fluxIds].reverse();
    const order = applyModelReorder([], fluxIds, reversed);
    const sorted = sortModelEntries(all, order).filter((e) => e.family === 'flux');
    expect(sorted.map((e) => e.id)).toEqual(reversed);
  });
});

describe('diffusion-only files stored under checkpoints', () => {
  const moody = 'Krea2\Moody-Krea-Mix-v8_00001__clean-int8_convrot.safetensors';
  const ckptInfo: ObjectInfo = {
    CheckpointLoaderSimple: {
      input: { required: { ckpt_name: [[moody, 'Flux1.D\realDream_flux1V1.safetensors']] } },
    },
  };

  it('lists non-Flux checkpoints-folder models in their family', () => {
    expect(catalog(ckptInfo)).toContainEqual(
      expect.objectContaining({ name: moody, loader: 'CheckpointLoaderSimple', family: 'krea2' }),
    );
  });

  it('loads the MODEL through CheckpointLoaderSimple and keeps separate encoder and VAE loaders', () => {
    const w = buildWorkflow({
      ...defaults,
      architecture: 'krea2',
      modelLoader: 'CheckpointLoaderSimple',
      model: moody,
      clip1: 'qwen3_vl_4b.safetensors',
      clip2: '',
      vae: 'qwen_image_vae.safetensors',
      steps: 8,
      cfg: 1,
    });
    expect(w['1']).toEqual({ class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: moody } });
    expect(w['5'].inputs.model).toEqual(['1', 0]);
    expect(w['8'].inputs).toEqual({ clip_name: 'qwen3_vl_4b.safetensors', type: 'krea2' });
    expect(w['9']).toEqual({
      class_type: 'VAELoader',
      inputs: { vae_name: 'qwen_image_vae.safetensors' },
    });
  });
});
