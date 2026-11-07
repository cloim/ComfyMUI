import { it, expect } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { defaults, buildWorkflow, validateAgainstServer, type ObjectInfo } from '../../src/domain';
import { catalog, selectModel, validateSelection, type ModelFamily } from '../../src/models';
const base = 'http://127.0.0.1:4173/comfy';
const prompt =
  'A red ceramic teapot on a wooden table beside a small green plant, soft daylight, studio photograph, no text, no people';
for (const family of ['flux', 'krea2', 'moss', 'qwen21'] as ModelFamily[])
  it('실제 GPU 생성: ' + family, async () => {
    const queue = await (await fetch(base + '/queue')).json();
    expect(
      queue.queue_running.length + queue.queue_pending.length,
      '기존 서버 작업을 보호하기 위해 대기 상태에서 검사합니다',
    ).toBe(0);
    const info: ObjectInfo = await (await fetch(base + '/object_info')).json();
    const list = catalog(info).filter((e) => e.family === family);
    const entry =
      (family === 'flux'
        ? list.find((e) => /flux1-dev-fp8\.safetensors$/i.test(e.name))
        : list[0]) || list[0];
    expect(entry, '설치된 ' + family + ' 모델').toBeTruthy();
    const settings = {
      ...selectModel({ ...defaults, architecture: 'flux' }, entry, info),
      positive: prompt,
      negative: 'blurry, watermark',
      width: 256,
      height: 256,
      batch: 1,
      steps: 4,
      seed: 42,
      random: false,
      loras: [],
    };
    validateSelection(settings, info);
    const graph = buildWorkflow(settings);
    validateAgainstServer(graph, info);
    const folder = 'docs/real-four';
    mkdirSync(folder, { recursive: true });
    writeFileSync(
      folder + '/' + family + '-request.json',
      JSON.stringify({ settings, graph }, null, 2),
    );
    const response = await fetch(base + '/prompt', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'http://127.0.0.1:4173' },
      body: JSON.stringify({ prompt: graph, client_id: crypto.randomUUID() }),
    });
    const body = await response.json();
    expect(response.ok, JSON.stringify(body)).toBe(true);
    expect(body.prompt_id).toBeTruthy();
    const started = Date.now();
    let item;
    console.log(family + ' 요청 전송: ' + body.prompt_id);
    while (Date.now() - started < 850000) {
      await new Promise((resolve) => setTimeout(resolve, 5000));
      const history = await (await fetch(base + '/history/' + body.prompt_id)).json();
      item = history[body.prompt_id];
      console.log(
        family +
          ' ' +
          Math.round((Date.now() - started) / 1000) +
          's ' +
          (item?.status?.status_str || 'running'),
      );
      if (item?.status?.completed || item?.status?.status_str === 'error') break;
    }
    writeFileSync(
      folder + '/' + family + '-history.json',
      JSON.stringify(item || { timeout: true, prompt_id: body.prompt_id }, null, 2),
    );
    expect(item?.status?.status_str, JSON.stringify(item?.status?.messages)).toBe('success');
    const images = Object.values(item.outputs).flatMap((v: any) => v.images || []);
    expect(images).toHaveLength(1);
    const image = await fetch(base + '/view?' + new URLSearchParams(images[0]));
    expect(image.ok).toBe(true);
    const png = Buffer.from(await image.arrayBuffer());
    expect(png.readUInt32BE(16)).toBe(settings.width);
    expect(png.readUInt32BE(20)).toBe(settings.height);
    writeFileSync(folder + '/' + family + '.png', png);
    console.log(family + ' 생성 및 256×256 PNG 검증 완료');
  });
