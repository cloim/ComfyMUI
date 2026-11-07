// Isolated ComfyUI protocol fixture, used only by npm run test:e2e.
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { WebSocketServer } from 'ws';

const jobs = new Map();
const choices = (values) => [values];

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
  if (url.pathname === '/view') {
    res.writeHead(200, { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'no-store' });
    return res.end(readFileSync('public/sample.svg'));
  }
  if (req.method === 'POST') {
    let body = '';
    for await (const chunk of req) body += chunk;
    const data = JSON.parse(body);
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
            if (ws.readyState === 1) {
              ws.send(JSON.stringify({ type: 'execution_start', data: { prompt_id: id } }));
              ws.send(JSON.stringify({ type: 'progress', data: { value: 50, max: 100, prompt_id: id } }));
              ws.send(previewPacket);
            }
          }
        }, 150);

        if (text.includes('execution-error')) {
          setTimeout(() => {
            for (const ws of wsClients) {
              if (ws.readyState === 1) {
                ws.send(JSON.stringify({
                  type: 'execution_error',
                  data: { prompt_id: id, exception_message: 'mock out of memory' },
                }));
              }
            }
          }, 800);
        } else {
          setTimeout(() => {
            const j = jobs.get(id);
            if (j && !j.cancelled) {
              j.wsCompleted = true;
              for (const ws of wsClients) {
                if (ws.readyState === 1) {
                  ws.send(JSON.stringify({
                    type: 'executing',
                    data: { node: null, prompt_id: id },
                  }));
                  ws.send(JSON.stringify({
                    type: 'executed',
                    data: { node: '7', prompt_id: id, output: {} },
                  }));
                }
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
  }
  if (url.pathname === '/queue')
    return send({
      queue_running: [...jobs]
        .filter(([, j]) => !j.cancelled && !j.text.includes('slow') && (Date.now() - j.start < 2200 || !j.wsCompleted))
        .map(([id]) => [1, id, {}, {}]),
      queue_pending: [...jobs]
        .filter(([, j]) => !j.cancelled && j.text.includes('slow'))
        .map(([id]) => [1, id, {}, {}]),
    });
  if (url.pathname.startsWith('/history/')) {
    const id = url.pathname.slice('/history/'.length),
      j = jobs.get(id);
    if (!j || j.cancelled || j.text.includes('slow') || (!j.wsCompleted && Date.now() - j.start < 2200))
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
wss.on('connection', (ws) => {
  wsClients.add(ws);
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
