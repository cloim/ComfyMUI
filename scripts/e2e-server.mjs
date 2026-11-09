// Isolated ComfyUI protocol fixture, used only by npm run test:e2e.
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { WebSocketServer } from 'ws';

const jobs = new Map();
const choices = (values) => [values];

const mockLoras = [
  {
    model_name: 'Flux Soft Portrait LoRA',
    file_name: 'soft',
    preview_url: '/api/lm/previews?path=soft.svg',
    preview_nsfw_level: 1,
    base_model: 'Flux.1 D',
    folder: 'Flux1.D',
    sha256: '1111111111111111111111111111111111111111111111111111111111111111',
    file_path: 'E:/ComfyUI/models/loras/Flux1.D/soft.safetensors',
    file_size: 148000000,
    modified: 1762000000,
    tags: ['portrait', 'lighting'],
    from_civitai: true,
    usage_count: 8,
    usage_tips: '{"strength":0.75,"clipStrength":0.75}',
    notes: '소프트 인물 조명 스타일',
    favorite: true,
    update_available: true,
    civitai: {
      id: 940211,
      modelId: 840370,
      name: 'v1.0',
      trainedWords: ['soft studio glow', 'skin detail'],
    },
  },
  {
    model_name: 'Krea2 Editorial Style',
    file_name: 'style',
    preview_url: '/api/lm/previews?path=style.svg',
    preview_nsfw_level: 1,
    base_model: 'Krea2',
    folder: 'Krea2',
    sha256: '2222222222222222222222222222222222222222222222222222222222222222',
    file_path: 'E:/ComfyUI/models/loras/Krea2/style.safetensors',
    file_size: 96000000,
    modified: 1761900000,
    tags: ['editorial', 'fashion'],
    from_civitai: true,
    usage_count: 4,
    usage_tips: '{"strength":0.85,"clipStrength":0.85}',
    notes: '매거진 에디토리얼 톤',
    favorite: false,
    update_available: false,
    civitai: {
      id: 950100,
      modelId: 850100,
      name: 'v1.0',
      trainedWords: ['editorial fashion'],
    },
  },
];

const mockCheckpoints = [
  {
    model_name: 'Flux Studio Checkpoint FP8',
    file_name: 'test-model',
    preview_url: '/api/lm/previews?path=flux-model.svg',
    preview_nsfw_level: 1,
    base_model: 'Flux.1 D',
    folder: 'Flux1.D',
    sha256: '3333333333333333333333333333333333333333333333333333333333333333',
    hash_status: 'completed',
    quantization: 'FP8',
    file_path: 'E:/ComfyUI/models/checkpoints/Flux1.D/test-model.safetensors',
    file_size: 11900000000,
    modified: 1762100000,
    tags: ['flux', 'photorealistic'],
    from_civitai: true,
    usage_count: 14,
    notes: 'Flux 기본 실사 체크포인트',
    sub_type: 'checkpoint',
    favorite: true,
    update_available: true,
    civitai: {
      id: 852897,
      modelId: 705606,
      name: 'v2.0 FP8',
    },
  },
  {
    model_name: 'Krea2 Turbo 8-Step Diffusion',
    file_name: 'krea2_turbo',
    preview_url: '/api/lm/previews?path=krea2-model.svg',
    preview_nsfw_level: 1,
    base_model: 'Krea2',
    folder: 'Krea2',
    sha256: '4444444444444444444444444444444444444444444444444444444444444444',
    hash_status: 'completed',
    quantization: 'INT8',
    file_path: 'E:/ComfyUI/models/diffusion_models/Krea2/krea2_turbo.safetensors',
    file_size: 12400000000,
    modified: 1762050000,
    tags: ['krea2', 'distilled'],
    from_civitai: true,
    usage_count: 9,
    notes: 'Krea2 8스텝 고속 디퓨전 모델',
    sub_type: 'diffusion_model',
    favorite: false,
    update_available: false,
    civitai: {
      id: 910200,
      modelId: 810200,
      name: 'v1.0 Turbo',
    },
  },
];

// 1x1 dummy PNG preview packet (4 bytes event type 1 + 4 bytes format 2 + PNG data)
const dummyPng = Buffer.from(
  '89504E470D0A1A0A0000000D49484452000000010000000108060000001F15C4890000000A49444154789C63000100000500010D0A2DB40000000049454E44AE426082',
  'hex',
);
const previewPacket = Buffer.alloc(8 + dummyPng.length);
previewPacket.writeUInt32BE(1, 0); // BinaryEventTypes.PREVIEW_IMAGE = 1
previewPacket.writeUInt32BE(2, 4); // PNG = 2
dummyPng.copy(previewPacket, 8);
const schema = {
  UNETLoader: {
    input: {
      required: {
        unet_name: choices([
          'Flux1.D/diffusion.safetensors',
          'Krea2/krea2_turbo.safetensors',
          'moss_image_sft.safetensors',
          'qwen_image_2.1.safetensors',
        ]),
        weight_dtype: choices(['default']),
      },
    },
  },
  UnetLoaderGGUF: { input: { required: { unet_name: choices(['Flux1.D/forest-Q4.gguf']) } } },
  DualCLIPLoader: {
    input: {
      required: {
        clip_name1: choices(['Flux1.D/clip_l.safetensors', 'Flux1.D/t5_fp8.safetensors']),
        clip_name2: choices(['Flux1.D/clip_l.safetensors', 'Flux1.D/t5_fp8.safetensors']),
        type: choices(['flux']),
      },
    },
  },
  CLIPLoader: {
    input: {
      required: {
        clip_name: choices([
          'Qwen/qwen3vl_4b.safetensors',
          'qwen3.5_9b_gptq.safetensors',
          'qwen3vl_8b.safetensors',
        ]),
        type: choices(['krea2', 'moss_image', 'qwen_image']),
      },
    },
  },
  VAELoader: {
    input: {
      required: {
        vae_name: choices([
          'Flux1.D/ae.safetensors',
          'Qwen/qwen_image_vae.safetensors',
          'flux2-vae_small.safetensors',
          'qwen_image_2.1_vae.safetensors',
        ]),
      },
    },
  },
  FluxGuidance: { input: { required: { conditioning: ['CONDITIONING'], guidance: ['FLOAT'] } } },
  EmptySD3LatentImage: {
    input: { required: { width: ['INT'], height: ['INT'], batch_size: ['INT'] } },
  },
  CheckpointLoaderSimple: {
    input: {
      required: {
        ckpt_name: choices(['Flux1.D/test-model.safetensors', 'Flux1.D/another.safetensors']),
      },
    },
  },
  LoraLoader: {
    input: {
      required: {
        model: ['MODEL'],
        clip: ['CLIP'],
        lora_name: choices([
          'Flux1.D/soft.safetensors',
          'Flux1.D/film.safetensors',
          'Flux1.D/style.safetensors',
          'Krea2/style.safetensors',
          'moss_style.safetensors',
          'qwen_image_2.1_style.safetensors',
          'unknown.safetensors',
        ]),
        strength_model: ['FLOAT'],
        strength_clip: ['FLOAT'],
      },
    },
  },
  CLIPTextEncode: { input: { required: { text: ['STRING'], clip: ['CLIP'] } } },
  EmptyLatentImage: {
    input: { required: { width: ['INT'], height: ['INT'], batch_size: ['INT'] } },
  },
  KSampler: {
    input: {
      required: {
        model: ['MODEL'],
        positive: ['CONDITIONING'],
        negative: ['CONDITIONING'],
        latent_image: ['LATENT'],
        seed: ['INT'],
        steps: ['INT', { min: 1, max: 150 }],
        cfg: ['FLOAT', { min: 0, max: 30 }],
        sampler_name: choices(['euler', 'dpmpp_2m']),
        scheduler: choices(['normal', 'karras', 'simple']),
        denoise: ['FLOAT'],
      },
    },
  },
  VAEDecode: { input: { required: { samples: ['LATENT'], vae: ['VAE'] } } },
  SaveImage: {
    input: { required: { images: ['IMAGE'], filename_prefix: ['STRING'] } },
    output_node: true,
  },
};
schema.EmptyFlux2LatentImage = schema.EmptySD3LatentImage;
schema.ModelSamplingFlux = {
  input: {
    required: {
      model: ['MODEL'],
      max_shift: ['FLOAT'],
      base_shift: ['FLOAT'],
      width: ['INT'],
      height: ['INT'],
    },
  },
};
schema.ConditioningZeroOut = { input: { required: { conditioning: ['CONDITIONING'] } } };
schema.TextEncodeQwenImage21 = {
  input: {
    required: {
      clip: ['CLIP'],
      prompt: ['STRING'],
      negative_prompt: ['STRING'],
      resolution: ['INT'],
      images: ['COMFY_AUTOGROW_V3'],
    },
  },
};
schema.LoraLoaderModelOnly = {
  input: {
    required: {
      model: ['MODEL'],
      lora_name: schema.LoraLoader.input.required.lora_name,
      strength_model: ['FLOAT'],
    },
  },
};
const mock = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const send = (body, status = 200) => {
    res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(body));
  };
  if (req.headers.origin && new URL(req.headers.origin).host !== req.headers.host)
    return send({ error: { message: 'backend origin mismatch' } }, 403);
  if (url.pathname === '/object_info') return send(schema);
  if (url.pathname === '/view' || url.pathname === '/api/lm/previews') {
    res.writeHead(200, { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'no-store' });
    return res.end(readFileSync('public/sample.svg'));
  }
  if (req.method === 'GET' && url.pathname === '/api/lm/loras/list') {
    let items = [...mockLoras];
    const search = (url.searchParams.get('search') || '').trim().toLowerCase();
    const folder = url.searchParams.get('folder');
    const baseModel = url.searchParams.get('base_model');
    const tagIncludes = url.searchParams.getAll('tag_include');
    const tagLogic = url.searchParams.get('tag_logic') || 'any';
    const favOnly = url.searchParams.get('favorites_only') === 'true';
    const updOnly = url.searchParams.get('update_available_only') === 'true';
    if (search) {
      items = items.filter(
        (x) =>
          x.model_name.toLowerCase().includes(search) ||
          x.file_name.toLowerCase().includes(search) ||
          x.tags.some((t) => t.toLowerCase().includes(search)) ||
          (x.civitai?.trainedWords || []).some((w) => w.toLowerCase().includes(search)),
      );
    }
    if (folder) items = items.filter((x) => x.folder === folder);
    if (baseModel) items = items.filter((x) => x.base_model === baseModel);
    if (tagIncludes.length > 0) {
      items = items.filter((x) =>
        tagLogic === 'all'
          ? tagIncludes.every((t) => x.tags.includes(t))
          : tagIncludes.some((t) => x.tags.includes(t)),
      );
    }
    if (favOnly) items = items.filter((x) => x.favorite);
    if (updOnly) items = items.filter((x) => x.update_available);
    return send({
      items,
      total: items.length,
      page: 1,
      page_size: 60,
      total_pages: 1,
    });
  }
  if (req.method === 'GET' && url.pathname === '/api/lm/loras/folders') {
    return send({ folders: ['Flux1.D', 'Krea2', 'Qwen'] });
  }
  if (req.method === 'GET' && url.pathname === '/api/lm/loras/roots') {
    return send({ success: true, roots: ['E:/ComfyUI/models/loras'] });
  }
  if (req.method === 'GET' && url.pathname === '/api/lm/loras/base-models') {
    return send({
      success: true,
      base_models: [
        { name: 'Flux.1 D', count: 1 },
        { name: 'Krea2', count: 1 },
      ],
    });
  }
  if (req.method === 'GET' && url.pathname === '/api/lm/loras/top-tags') {
    return send({
      success: true,
      tags: [
        { tag: 'portrait', count: 1 },
        { tag: 'editorial', count: 1 },
      ],
    });
  }
  if (req.method === 'GET' && url.pathname === '/api/lm/loras/scan') {
    return send({ status: 'success', message: 'LoRA scan completed' });
  }
  if (req.method === 'GET' && url.pathname.startsWith('/api/lm/loras/civitai/versions/')) {
    const modelId = Number(url.pathname.split('/').pop());
    return send([
      {
        id: 940211,
        modelId,
        name: 'v1.0',
        baseModel: 'Flux.1 D',
        existsLocally: true,
        modelSizeKB: 144531,
        trainedWords: ['soft studio glow', 'skin detail'],
        model: { name: 'Flux Soft Portrait LoRA', type: 'LORA' },
      },
      {
        id: 990500,
        modelId,
        name: 'v2.0 HD',
        baseModel: 'Flux.1 D',
        existsLocally: false,
        modelSizeKB: 152000,
        trainedWords: ['soft studio glow v2', 'ultra skin detail'],
        model: { name: 'Flux Soft Portrait LoRA', type: 'LORA' },
      },
    ]);
  }
  if (req.method === 'GET' && url.pathname.startsWith('/api/lm/loras/civitai/model/version/')) {
    const versionId = Number(url.pathname.split('/').pop());
    return send({
      id: versionId,
      modelId: 840370,
      name: 'v2.0 HD',
      baseModel: 'Flux.1 D',
      existsLocally: false,
      modelSizeKB: 152000,
      trainedWords: ['soft studio glow v2'],
      model: { name: 'Flux Soft Portrait LoRA', type: 'LORA' },
    });
  }
  if (req.method === 'GET' && url.pathname === '/api/lm/checkpoints/list') {
    let items = [...mockCheckpoints];
    const search = (url.searchParams.get('search') || '').trim().toLowerCase();
    const folder = url.searchParams.get('folder');
    const baseModel = url.searchParams.get('base_model');
    const modelType = url.searchParams.get('model_type');
    const tagIncludes = url.searchParams.getAll('tag_include');
    const tagLogic = url.searchParams.get('tag_logic') || 'any';
    const favOnly = url.searchParams.get('favorites_only') === 'true';
    const updOnly = url.searchParams.get('update_available_only') === 'true';
    if (search) {
      items = items.filter(
        (x) =>
          x.model_name.toLowerCase().includes(search) ||
          x.file_name.toLowerCase().includes(search) ||
          (x.base_model || '').toLowerCase().includes(search) ||
          x.tags.some((t) => t.toLowerCase().includes(search)),
      );
    }
    if (folder) items = items.filter((x) => x.folder === folder);
    if (baseModel) items = items.filter((x) => x.base_model === baseModel);
    if (modelType) items = items.filter((x) => x.sub_type === modelType);
    if (tagIncludes.length > 0) {
      items = items.filter((x) =>
        tagLogic === 'all'
          ? tagIncludes.every((t) => x.tags.includes(t))
          : tagIncludes.some((t) => x.tags.includes(t)),
      );
    }
    if (favOnly) items = items.filter((x) => x.favorite);
    if (updOnly) items = items.filter((x) => x.update_available);
    return send({
      items,
      total: items.length,
      page: 1,
      page_size: 100,
      total_pages: 1,
    });
  }
  if (req.method === 'GET' && url.pathname === '/api/lm/checkpoints/folders') {
    return send({ folders: ['Flux1.D', 'Krea2', 'Qwen'] });
  }
  if (req.method === 'GET' && url.pathname === '/api/lm/checkpoints/roots') {
    return send({
      success: true,
      roots: ['E:/ComfyUI/models/checkpoints', 'E:/ComfyUI/models/diffusion_models'],
    });
  }
  if (req.method === 'GET' && url.pathname === '/api/lm/checkpoints/base-models') {
    return send({
      success: true,
      base_models: [
        { name: 'Flux.1 D', count: 1 },
        { name: 'Krea2', count: 1 },
      ],
    });
  }
  if (req.method === 'GET' && url.pathname === '/api/lm/checkpoints/top-tags') {
    return send({
      success: true,
      tags: [
        { tag: 'flux', count: 1 },
        { tag: 'photorealistic', count: 1 },
        { tag: 'krea2', count: 1 },
        { tag: 'distilled', count: 1 },
      ],
    });
  }
  if (req.method === 'GET' && url.pathname === '/api/lm/checkpoints/scan') {
    return send({ status: 'success', message: 'Checkpoint scan completed' });
  }
  if (req.method === 'GET' && url.pathname.startsWith('/api/lm/checkpoints/civitai/versions/')) {
    const modelId = Number(url.pathname.split('/').pop());
    return send([
      {
        id: 852897,
        modelId,
        name: 'v2.0 FP8',
        baseModel: 'Flux.1 D',
        existsLocally: true,
        modelSizeKB: 11621093,
        model: { name: 'Flux Studio Checkpoint FP8', type: 'Checkpoint' },
      },
      {
        id: 992100,
        modelId,
        name: 'v3.0 Studio FP8',
        baseModel: 'Flux.1 D',
        existsLocally: false,
        modelSizeKB: 11840000,
        model: { name: 'Flux Studio Checkpoint FP8', type: 'Checkpoint' },
      },
    ]);
  }
  if (
    req.method === 'GET' &&
    url.pathname.startsWith('/api/lm/checkpoints/civitai/model/version/')
  ) {
    const versionId = Number(url.pathname.split('/').pop());
    return send({
      id: versionId,
      modelId: 705606,
      name: 'v3.0 Studio FP8',
      baseModel: 'Flux.1 D',
      existsLocally: false,
      modelSizeKB: 11840000,
      model: { name: 'Flux Studio Checkpoint FP8', type: 'Checkpoint' },
    });
  }
  if (req.method === 'GET' && url.pathname.startsWith('/api/lm/download-progress/')) {
    return send({
      success: true,
      progress: {
        progress: 100,
        status: 'completed',
        bytes_downloaded: 152000000,
        total_bytes: 152000000,
      },
    });
  }
  if (req.method === 'POST') {
    let body = '';
    for await (const chunk of req) body += chunk;
    let data;
    try {
      data = JSON.parse(body);
    } catch {
      return send({ error: { message: 'Invalid JSON body' } }, 400);
    }
    if (url.pathname === '/prompt') {
      const text = data.prompt?.['2']?.inputs?.text || data.prompt?.['2']?.inputs?.prompt || '';
      if (text.includes('reject'))
        return send(
          {
            error: { message: '테스트 모델 검증 실패' },
            node_errors: { 1: { errors: ['invalid model'] } },
          },
          400,
        );
      if (!data.client_id || !data.prompt?.['7'])
        return send({ error: { message: 'API contract mismatch' } }, 400);
      const id = crypto.randomUUID();
      jobs.set(id, { start: Date.now(), prompt: data.prompt, text, cancelled: false });

      if (!text.includes('slow')) {
        setTimeout(() => {
          for (const ws of wsClients) {
            safeSend(ws, JSON.stringify({ type: 'execution_start', data: { prompt_id: id } }));
            safeSend(
              ws,
              JSON.stringify({ type: 'progress', data: { value: 50, max: 100, prompt_id: id } }),
            );
            safeSend(ws, previewPacket);
          }
        }, 150);

        if (text.includes('execution-error')) {
          setTimeout(() => {
            for (const ws of wsClients) {
              safeSend(
                ws,
                JSON.stringify({
                  type: 'execution_error',
                  data: { prompt_id: id, exception_message: 'mock out of memory' },
                }),
              );
            }
          }, 800);
        } else {
          setTimeout(() => {
            const j = jobs.get(id);
            if (j && !j.cancelled) {
              j.wsCompleted = true;
              for (const ws of wsClients) {
                safeSend(
                  ws,
                  JSON.stringify({
                    type: 'executing',
                    data: { node: null, prompt_id: id },
                  }),
                );
                safeSend(
                  ws,
                  JSON.stringify({
                    type: 'executed',
                    data: { node: '7', prompt_id: id, output: {} },
                  }),
                );
              }
            }
          }, 1000);
        }
      }

      return send({ prompt_id: id, number: 1, node_errors: {} });
    }
    if (url.pathname === '/queue') {
      for (const id of data.delete || []) {
        const j = jobs.get(id);
        if (j) j.cancelled = true;
      }
      return send({});
    }
    if (url.pathname === '/api/lm/loras/save-metadata') {
      const target = mockLoras.find((x) => x.file_path === data.file_path);
      if (target) {
        if (typeof data.favorite === 'boolean') target.favorite = data.favorite;
        if (typeof data.model_name === 'string') target.model_name = data.model_name;
        if (typeof data.base_model === 'string') target.base_model = data.base_model;
        if (typeof data.usage_tips === 'string') target.usage_tips = data.usage_tips;
        if (typeof data.notes === 'string') target.notes = data.notes;
        if (Array.isArray(data.tags)) target.tags = [...data.tags];
        if (data.civitai?.trainedWords) {
          target.civitai = { ...(target.civitai || {}), trainedWords: data.civitai.trainedWords };
        }
      }
      return send({ success: true });
    }
    if (url.pathname === '/api/lm/loras/add-tags') {
      const target = mockLoras.find((x) => x.file_path === data.file_path);
      if (target && Array.isArray(data.tags)) {
        target.tags = [...new Set([...target.tags, ...data.tags])];
      }
      return send({ success: true, tags: target?.tags || [] });
    }
    if (url.pathname === '/api/lm/loras/fetch-civitai') {
      return send({ success: true });
    }
    if (url.pathname === '/api/lm/loras/relink-civitai') {
      const target = mockLoras.find((x) => x.file_path === data.file_path);
      if (target) {
        target.civitai = {
          ...(target.civitai || {}),
          modelId: Number(data.model_id),
          id: Number(data.model_version_id || 940211),
        };
      }
      return send({ success: true });
    }
    if (url.pathname === '/api/lm/loras/updates/refresh') {
      return send({
        success: true,
        records: [
          {
            model_type: 'lora',
            model_id: 840370,
            has_update: true,
            version_ids: [940211, 990500],
            in_library_version_ids: [940211],
          },
        ],
      });
    }
    if (url.pathname === '/api/lm/download-model') {
      const vid = Number(data.model_version_id || 990500);
      const mid = Number(data.model_id || 840370);
      const isCheckpointDl =
        mid === 705606 ||
        vid === 992100 ||
        String(data.download_id || '').startsWith('cm-mdl-') ||
        String(data.model_root || '').includes('checkpoints') ||
        String(data.model_root || '').includes('diffusion_models');
      if (isCheckpointDl) {
        const newName = `civitai_model_${vid}`;
        const newRel = `Flux1.D/${newName}.safetensors`;
        const ckptList = schema.CheckpointLoaderSimple.input.required.ckpt_name[0];
        if (!ckptList.includes(newRel)) ckptList.push(newRel);
        mockCheckpoints.unshift({
          model_name: `Flux Studio Checkpoint v3 (${vid})`,
          file_name: newName,
          preview_url: '/api/lm/previews?path=flux-model.svg',
          preview_nsfw_level: 1,
          base_model: 'Flux.1 D',
          folder: 'Flux1.D',
          sha256: String(vid).padStart(64, '0'),
          hash_status: 'completed',
          quantization: 'FP8',
          file_path: `E:/ComfyUI/models/checkpoints/${newRel}`,
          file_size: 11840000000,
          modified: Math.floor(Date.now() / 1000),
          tags: ['flux', 'v3'],
          from_civitai: true,
          usage_count: 0,
          notes: 'CivitAI 다운로드 체크포인트',
          sub_type: 'checkpoint',
          favorite: false,
          update_available: false,
          civitai: {
            id: vid,
            modelId: mid,
            name: 'v3.0 Studio FP8',
          },
        });
        return send({ success: true, download_id: data.download_id || 'dl-mdl-1' });
      }
      const newName = `civitai_${vid}`;
      const newRel = `Flux1.D/${newName}.safetensors`;
      const loraList = schema.LoraLoader.input.required.lora_name[0];
      if (!loraList.includes(newRel)) loraList.push(newRel);
      mockLoras.unshift({
        model_name: `Flux Soft Portrait v2 (${vid})`,
        file_name: newName,
        preview_url: '/api/lm/previews?path=soft.svg',
        preview_nsfw_level: 1,
        base_model: 'Flux.1 D',
        folder: 'Flux1.D',
        sha256: String(vid).padStart(64, '0'),
        file_path: `E:/ComfyUI/models/loras/${newRel}`,
        file_size: 152000000,
        modified: Math.floor(Date.now() / 1000),
        tags: ['portrait', 'v2'],
        from_civitai: true,
        usage_count: 0,
        usage_tips: '{"strength":0.8,"clipStrength":0.8}',
        notes: 'CivitAI 다운로드 모델',
        favorite: false,
        update_available: false,
        civitai: {
          id: vid,
          modelId: mid,
          name: 'v2.0 HD',
          trainedWords: ['soft studio glow v2'],
        },
      });
      return send({ success: true, download_id: data.download_id || 'dl-1' });
    }
    if (url.pathname === '/api/lm/checkpoints/save-metadata') {
      const target = mockCheckpoints.find((x) => x.file_path === data.file_path);
      if (target) {
        if (typeof data.favorite === 'boolean') target.favorite = data.favorite;
        if (typeof data.model_name === 'string') target.model_name = data.model_name;
        if (typeof data.base_model === 'string') target.base_model = data.base_model;
        if (typeof data.notes === 'string') target.notes = data.notes;
        if (Array.isArray(data.tags)) target.tags = [...data.tags];
      }
      return send({ success: true });
    }
    if (url.pathname === '/api/lm/checkpoints/add-tags') {
      const target = mockCheckpoints.find((x) => x.file_path === data.file_path);
      if (target && Array.isArray(data.tags)) {
        target.tags = [...new Set([...target.tags, ...data.tags])];
      }
      return send({ success: true, tags: target?.tags || [] });
    }
    if (url.pathname === '/api/lm/checkpoints/fetch-civitai') {
      return send({ success: true });
    }
    if (url.pathname === '/api/lm/checkpoints/relink-civitai') {
      const target = mockCheckpoints.find((x) => x.file_path === data.file_path);
      if (target) {
        target.civitai = {
          ...(target.civitai || {}),
          modelId: Number(data.model_id),
          id: Number(data.model_version_id || 852897),
        };
      }
      return send({ success: true });
    }
    if (url.pathname === '/api/lm/checkpoints/updates/refresh') {
      return send({
        success: true,
        records: [
          {
            model_type: 'checkpoint',
            model_id: 705606,
            has_update: true,
            version_ids: [852897, 992100],
            in_library_version_ids: [852897],
          },
        ],
      });
    }
    if (url.pathname === '/api/lm/checkpoints/rename') {
      const target = mockCheckpoints.find((x) => x.file_path === data.file_path);
      if (target && data.new_file_name) {
        target.file_name = data.new_file_name;
      }
      return send({ success: true });
    }
    if (url.pathname === '/api/lm/checkpoints/move_model') {
      return send({ success: true });
    }
    if (url.pathname === '/api/lm/checkpoints/delete') {
      const idx = mockCheckpoints.findIndex((x) => x.file_path === data.file_path);
      if (idx !== -1) mockCheckpoints.splice(idx, 1);
      return send({ success: true });
    }
    if (url.pathname === '/api/lm/loras/rename') {
      const target = mockLoras.find((x) => x.file_path === data.file_path);
      if (target && data.new_file_name) {
        target.file_name = data.new_file_name;
      }
      return send({ success: true });
    }
    if (url.pathname === '/api/lm/loras/move_model') {
      return send({ success: true });
    }
    if (url.pathname === '/api/lm/loras/delete') {
      const idx = mockLoras.findIndex((x) => x.file_path === data.file_path);
      if (idx !== -1) mockLoras.splice(idx, 1);
      return send({ success: true });
    }
  }
  if (url.pathname === '/queue')
    return send({
      queue_running: [...jobs]
        .filter(
          ([, j]) =>
            !j.cancelled &&
            !j.text.includes('slow') &&
            (Date.now() - j.start < 2200 || !j.wsCompleted),
        )
        .map(([id]) => [1, id, {}, {}]),
      queue_pending: [...jobs]
        .filter(([, j]) => !j.cancelled && j.text.includes('slow'))
        .map(([id]) => [1, id, {}, {}]),
    });
  if (url.pathname.startsWith('/history/')) {
    const id = url.pathname.slice('/history/'.length),
      j = jobs.get(id);
    if (
      !j ||
      j.cancelled ||
      j.text.includes('slow') ||
      (!j.wsCompleted && Date.now() - j.start < 2200)
    )
      return send({});
    if (j.text.includes('execution-error'))
      return send({
        [id]: {
          outputs: {},
          status: {
            completed: false,
            status_str: 'error',
            messages: [['execution_error', { exception_message: 'mock out of memory' }]],
          },
        },
      });
    return send({
      [id]: {
        outputs: {
          7: {
            images: Array.from({ length: j.prompt['4']?.inputs?.batch_size || 1 }, (_, i) => ({
              filename: `mock-${i}.svg`,
              subfolder: '',
              type: 'output',
            })),
          },
        },
        status: { completed: true, status_str: 'success' },
      },
    });
  }
  send({ error: 'Not found' }, 404);
});

const wss = new WebSocketServer({ noServer: true });
const wsClients = new Set();
function safeSend(ws, data) {
  if (ws && ws.readyState === 1) {
    try {
      ws.send(data, () => {});
    } catch {}
  }
}
wss.on('connection', (ws) => {
  wsClients.add(ws);
  ws.on('error', () => {});
  ws.on('close', () => wsClients.delete(ws));
});
mock.on('upgrade', (req, socket, head) => {
  if (req.url?.startsWith('/ws')) {
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, req);
    });
  } else {
    socket.destroy();
  }
});
await new Promise((resolve) => mock.listen(8799, '127.0.0.1', resolve));
process.env.COMFY_URL = 'http://127.0.0.1:8799';
process.env.PORT = '4174';
await import('../server.mjs');
