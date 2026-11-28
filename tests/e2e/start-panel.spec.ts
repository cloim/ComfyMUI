import { test, expect, type Page } from '@playwright/test';
import { deflateSync } from 'node:zlib';

test.beforeEach(async ({ request }) => {
  expect((await request.post('/api/state/reset')).ok()).toBe(true);
});

async function connect(page: Page) {
  await page.goto('/settings');
  await page.getByRole('button', { name: '저장하고 연결 확인' }).click();
  await expect(page.getByText('서버에 연결했어요')).toBeVisible();
  await page.goto('/create');
  await page
    .getByRole('combobox', { name: '모델', exact: true })
    .selectOption({ label: 'Flux1.D/test-model.safetensors' });
}

// A solid grey PNG of the given size, enough for the browser to read its dimensions.
function png(width: number, height: number) {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf: Buffer) => {
    let c = 0xffffffff;
    for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type), data]);
    const out = Buffer.alloc(body.length + 8);
    out.writeUInt32BE(data.length, 0);
    body.copy(out, 4);
    out.writeUInt32BE(crc(body), body.length + 4);
    return out;
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 0, 0, 0, 0], 8);
  const rows = Buffer.alloc((width + 1) * height, 128);
  for (let y = 0; y < height; y++) rows[y * (width + 1)] = 0;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(rows)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
const helperRequest = (page: Page) =>
  page.waitForRequest(
    (r) =>
      r.url().endsWith('/prompt') &&
      r.method() === 'POST' &&
      r.postDataJSON()?.prompt?.['3']?.class_type === 'TextGenerate',
  );

test('글로 적은 아이디어를 모델 프롬프트로 바꿔 프롬프트 칸에 넣는다', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await connect(page);
  await page.getByLabel('만들고 싶은 것').fill('새벽 항구의 고요한 풍경');
  const sent = helperRequest(page);
  await page.getByRole('button', { name: '프롬프트만 쓰기' }).click();
  const body = (await sent).postDataJSON();
  expect(body.front).toBe(true);
  expect(body.client_id).toMatch(/^comfymui-assist-/);
  expect(body.prompt['1'].inputs).toEqual({
    clip_name: 'Qwen/qwen3vl_4b.safetensors',
    type: 'krea2',
  });
  expect(body.prompt['3'].inputs.prompt).toContain('Request: 새벽 항구의 고요한 풍경');
  expect(body.prompt['2']).toBeUndefined();
  await expect(page.locator('#positive')).toHaveValue(
    'A detailed mock prompt about a quiet harbor at dawn.',
  );
  // The idea stays so it can be refined and written again.
  await expect(page.getByLabel('만들고 싶은 것')).toHaveValue('새벽 항구의 고요한 풍경');
  expect(errors).toEqual([]);
});

test('사진 고치기는 Qwen 2.1로 바꾸고 사진을 편집 원본으로 생성한다', async ({ page }) => {
  await connect(page);
  await page
    .getByLabel('시작할 사진 선택')
    .setInputFiles({ name: 'me.png', mimeType: 'image/png', buffer: png(600, 800) });
  await expect(page.getByAltText('넣은 사진')).toBeVisible();
  await page.getByRole('radio', { name: /사진 고치기/ }).click();
  // Editing needs a request.
  await expect(page.getByRole('button', { name: '바로 만들기' })).toBeDisabled();
  await page.getByLabel('만들고 싶은 것').fill('머리를 금발로');
  const helper = helperRequest(page);
  const generated = page.waitForRequest(
    (r) => r.url().endsWith('/prompt') && Boolean(r.postDataJSON()?.prompt?.['7']),
  );
  await page.getByRole('button', { name: '바로 만들기' }).click();
  const assist = (await helper).postDataJSON();
  expect(assist.prompt['2'].inputs.image).toMatch(/\[input\]$/);
  expect(assist.prompt['3'].inputs.prompt).toContain('Requested change: 머리를 금발로');
  const body = (await generated).postDataJSON();
  expect(body.prompt['2'].class_type).toBe('TextEncodeQwenImage21');
  expect(body.prompt['2'].inputs.prompt).toBe(
    'Change the hair to platinum blonde; keep the face, pose and background.',
  );
  expect(body.prompt['50'].inputs.image).toBe(assist.prompt['2'].inputs.image);
  // The size follows the photo at about one megapixel.
  expect(body.prompt['51'].inputs).toMatchObject({ width: 896, height: 1216 });
  await expect(page.getByRole('combobox', { name: '모델 계열' })).toHaveValue('qwen21');
  await expect(page.getByAltText('고칠 사진')).toBeVisible();
  await page.getByRole('button', { name: '사진 고치기 해제' }).click();
  await expect(page.getByAltText('고칠 사진')).toHaveCount(0);
});

test('사진을 영상으로 고르면 첫 프레임과 움직임 프롬프트를 준비한다', async ({ page }) => {
  await connect(page);
  await page
    .getByLabel('시작할 사진 선택')
    .setInputFiles({ name: 'me.png', mimeType: 'image/png', buffer: png(600, 800) });
  await page.getByRole('radio', { name: /영상으로/ }).click();
  const helper = helperRequest(page);
  await page.getByRole('button', { name: '프롬프트만 쓰기' }).click();
  expect((await helper).postDataJSON().prompt['3'].inputs.prompt).toContain(
    'first frame of a video',
  );
  await expect(page.locator('#positive')).toHaveValue(
    'She slowly turns toward the camera as the light flickers.',
  );
  await expect(page.getByRole('combobox', { name: '모델 계열' })).toHaveValue('ltx2');
  await expect(page.getByAltText('첫 프레임 이미지')).toBeVisible();
  await expect(page.getByLabel('너비', { exact: true })).toHaveValue('600');
  await expect(page.getByLabel('높이', { exact: true })).toHaveValue('800');
});

test('고화질 마무리는 같은 생성 안에서 키우고 디테일을 다시 그린다', async ({ page }) => {
  await connect(page);
  await page.getByLabel('너비', { exact: true }).fill('768');
  await page.getByLabel('높이', { exact: true }).fill('1024');
  const finish = page.getByRole('checkbox', { name: /고화질 마무리/ });
  await expect(finish).toBeChecked();
  await expect(page.getByText(/1152×1536로 키우고/)).toBeVisible();
  await page.locator('#positive').fill('a quiet harbor at dawn');
  const submitted = page.waitForRequest(
    (r) => r.url().endsWith('/prompt') && Boolean(r.postDataJSON()?.prompt?.['7']),
  );
  await page.getByTestId('generate').click();
  const body = (await submitted).postDataJSON();
  expect(body.prompt['70'].inputs.model_name).toBe('4x-UltraSharp.pth');
  expect(body.prompt['72'].inputs).toMatchObject({ width: 1152, height: 1536 });
  expect(body.prompt['74'].inputs.denoise).toBe(0.35);
  expect(body.prompt['7'].inputs.images).toEqual(['75', 0]);
  await expect(page.getByText('생성 완료', { exact: true })).toBeVisible({ timeout: 15000 });

  await finish.uncheck();
  await page.reload();
  await expect(page.getByRole('checkbox', { name: /고화질 마무리/ })).not.toBeChecked();
  const plain = page.waitForRequest(
    (r) => r.url().endsWith('/prompt') && Boolean(r.postDataJSON()?.prompt?.['7']),
  );
  await page.getByTestId('generate').click();
  const plainBody = (await plain).postDataJSON();
  expect(plainBody.prompt['70']).toBeUndefined();
  expect(plainBody.prompt['7'].inputs.images).toEqual(['6', 0]);
});
