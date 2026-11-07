import { test, expect, type Page } from '@playwright/test';
async function connect(page: Page) {
  await page.goto('/settings');
  await page.getByRole('button', { name: '저장하고 연결 확인' }).click();
  await expect(page.getByText('서버에 연결했어요')).toBeVisible();
  await page.goto('/create');
  await page.getByRole('button', { name: '모델 선택', exact: true }).click();
  await page.getByRole('button', { name: 'Flux1.D/test-model.safetensors', exact: true }).click();
}
test('mobile preview, advanced values, presets CRUD and persistence', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/create');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('만들기');
  await page.getByRole('button', { name: '고급 설정', exact: true }).click();
  await page.getByLabel('Steps', { exact: true }).fill('32');
  await page.getByLabel('CFG', { exact: true }).fill('6.5');
  await page.getByRole('button', { name: '설정 완료' }).click();
  await page.getByRole('button', { name: '현재 설정을 프리셋으로 저장' }).click();
  await page.getByLabel('프리셋 이름', { exact: true }).fill('숲의 아침');
  await page.getByRole('button', { name: '저장', exact: true }).click();
  await page
    .getByRole('navigation', { name: '모바일 메뉴' })
    .getByRole('link', { name: '프리셋', exact: true })
    .click();
  await expect(page.getByRole('heading', { name: '숲의 아침' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: '숲의 아침' })).toBeVisible();
  await page.getByRole('button', { name: '숲의 아침 복제' }).click();
  await expect(page.getByRole('heading', { name: '숲의 아침 복사본' })).toBeVisible();
  await page.getByRole('button', { name: '숲의 아침 수정' }).click();
  await page.getByLabel('프리셋 이름', { exact: true }).fill('나만의 숲');
  await page.getByRole('button', { name: '저장', exact: true }).click();
  await page.getByRole('button', { name: '숲의 아침 복사본 삭제' }).click();
  await page.getByRole('button', { name: '삭제', exact: true }).click();
  await expect(page.getByRole('heading', { name: '숲의 아침 복사본' })).toHaveCount(0);
  await page.getByRole('link', { name: '적용하기' }).click();
  await expect(page).toHaveURL(/create/);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('cm-settings')!).steps)).toBe(
    32,
  );
  await page.getByTestId('generate').click();
  await expect(page.getByText('생성 완료', { exact: true })).toBeVisible({ timeout: 10000 });
  await expect(page.getByText('미리보기 체험', { exact: true })).toBeVisible();
  await page.setViewportSize({ width: 325, height: 667 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'docs/qa-result-325.png' });
  await page.getByRole('link', { name: '결과 보기', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '생성 기록' })).toBeVisible();
  expect(errors).toEqual([]);
});
test('real protocol submission, LoRA chain, batch outputs, poll fallback and reuse', async ({
  page,
}) => {
  await connect(page);
  await page.getByRole('button', { name: '추가', exact: true }).click();
  await page.getByRole('button', { name: 'LoRA 선택', exact: true }).click();
  await page.getByRole('button', { name: 'Flux1.D/soft.safetensors', exact: true }).click();
  await page.getByLabel('생성 수', { exact: true }).selectOption('2');
  const submitted = page.waitForRequest(
    (r) => r.url().endsWith('/comfy/prompt') && r.method() === 'POST',
  );
  await page.getByTestId('generate').click();
  const body = (await submitted).postDataJSON();
  expect(body.prompt['100'].inputs.lora_name).toBe('Flux1.D/soft.safetensors');
  expect(body.prompt['4'].inputs.batch_size).toBe(2);
  expect(body.client_id).toBeTruthy();
  await expect(page.getByText('생성 완료', { exact: true })).toBeVisible({ timeout: 15000 });
  await expect(page.getByRole('link', { name: '이미지 2', exact: true })).toBeVisible();
  await page.getByRole('link', { name: '설정 재사용', exact: true }).click();
  expect(
    await page.evaluate(() => JSON.parse(localStorage.getItem('cm-settings')!).loras[0].name),
  ).toBe('Flux1.D/soft.safetensors');
  await page
    .getByRole('navigation', { name: '모바일 메뉴' })
    .getByRole('link', { name: '기록', exact: true })
    .click();
  await page.getByRole('button', { name: '완료 이미지 상세 보기' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
});
test('server validation errors and queued-only cancellation', async ({ page }) => {
  await connect(page);
  await page.getByLabel('그리고 싶은 장면', { exact: true }).fill('reject');
  await page.getByTestId('generate').click();
  await expect(page.getByText('생성을 다시 확인해 주세요', { exact: true })).toBeVisible();
  await expect(page.getByText(/테스트 모델 검증 실패 \(400\)/).first()).toBeVisible();
  await page.getByLabel('그리고 싶은 장면', { exact: true }).fill('slow');
  await page.getByTestId('generate').click();
  await expect(page.getByRole('button', { name: '대기 취소', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '대기 취소', exact: true }).click();
  await expect(page.getByText('대기 취소됨', { exact: true })).toBeVisible();
});
test('pending jobs resume after reload, execution errors recover and cross-origin calls are rejected', async ({
  page,
  request,
}) => {
  await connect(page);
  await page.getByLabel('그리고 싶은 장면', { exact: true }).fill('slow');
  await page.getByTestId('generate').click();
  await expect(page.getByRole('button', { name: '대기 취소', exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('button', { name: '대기 취소', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '대기 취소', exact: true }).click();
  await expect(page.getByText('대기 취소됨', { exact: true })).toBeVisible();
  await page.getByLabel('그리고 싶은 장면', { exact: true }).fill('execution-error');
  await page.getByTestId('generate').click();
  await expect(page.getByText('생성을 다시 확인해 주세요', { exact: true })).toBeVisible({
    timeout: 10000,
  });
  await expect(page.getByText(/mock out of memory/).first()).toBeVisible();
  await expect(page.getByTestId('generate')).toBeEnabled();
  const rejected = await request.post('/comfy/prompt', {
    headers: { Origin: 'https://example.com' },
    data: {},
  });
  expect(rejected.status()).toBe(403);
});
test('API workflow import, linked input preservation and export', async ({ page }) => {
  await connect(page);
  await page.getByRole('button', { name: '고급 설정', exact: true }).click();
  await page.getByRole('button', { name: 'API 워크플로', exact: true }).click();
  const data = {
    '1': { class_type: 'SaveImage', inputs: { filename_prefix: 'custom', images: ['2', 0] } },
    '2': { class_type: 'EmptyLatentImage', inputs: { width: 512, height: 512, batch_size: 1 } },
  };
  await page.getByLabel('워크플로 JSON 가져오기', { exact: true }).setInputFiles({
    name: 'workflow.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(data)),
  });
  await page.getByText('2 | EmptyLatentImage', { exact: true }).click();
  await page.getByRole('spinbutton', { name: '2 / width', exact: true }).fill('768');
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: '내보내기', exact: true }).click();
  expect((await download).suggestedFilename()).toBe('comfymui-workflow.json');
  await page.getByRole('button', { name: '설정 완료' }).click();
  await expect(page.getByText('가져온 워크플로 사용 중')).toBeVisible();
  expect(
    await page.evaluate(
      () => JSON.parse(localStorage.getItem('cm-settings')!).workflow['2'].inputs.width,
    ),
  ).toBe(768);
});
test('PWA offline shell and presets remain available without caching API images', async ({
  page,
  context,
}) => {
  await page.goto('/create');
  await page.getByRole('button', { name: '현재 설정을 프리셋으로 저장' }).click();
  await page.getByLabel('프리셋 이름', { exact: true }).fill('오프라인 설정');
  await page.getByRole('button', { name: '저장', exact: true }).click();
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
  await page.reload();
  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
  await context.setOffline(true);
  await page.goto('/presets');
  await expect(page.getByRole('heading', { name: '오프라인 설정' })).toBeVisible();
  await expect(page.getByText(/오프라인 \|/)).toBeVisible();
  const cached = await page.evaluate(async () => {
    const cache = await caches.open((await caches.keys()).find((k) => k.startsWith('comfymui-'))!);
    return (await cache.keys()).map((r) => new URL(r.url).pathname);
  });
  expect(cached.some((p) => p.startsWith('/comfy'))).toBe(false);
  await context.setOffline(false);
});
test('layouts fit 325, 390 and 1440px and dialogs trap focus', async ({ page }) => {
  for (const width of [325, 390, 1440]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto('/create');
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    if (width === 325) {
      const splitWords = await page.evaluate(() => {
        const bad: string[] = [];
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        while (walker.nextNode()) {
          const node = walker.currentNode,
            parent = node.parentElement;
          if (
            !parent ||
            parent.closest('.sr-only, script, style') ||
            !parent.getClientRects().length
          )
            continue;
          for (const match of (node.textContent || '').matchAll(/[가-힣]{2,}/g)) {
            const range = document.createRange();
            range.setStart(node, match.index!);
            range.setEnd(node, match.index! + match[0].length);
            if (new Set([...range.getClientRects()].map((r) => Math.round(r.top))).size > 1)
              bad.push(match[0]);
          }
        }
        return bad;
      });
      expect(splitWords).toEqual([]);
    }
    await page.getByRole('button', { name: '고급 설정', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    expect(
      await dialog.evaluate((el) => {
        const r = el.getBoundingClientRect();
        return r.left >= 0 && r.right <= innerWidth && r.bottom <= innerHeight + 1;
      }),
    ).toBe(true);
    await page.screenshot({ path: `docs/qa-dialog-${width}.png` });
    await page.keyboard.press('Tab');
    expect(await page.evaluate(() => !!document.activeElement?.closest('[role=dialog]'))).toBe(
      true,
    );
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await page.evaluate(() => document.getElementById('main')!.scrollTo(0, 0));
    await page.screenshot({ path: `docs/qa-create-${width}.png` });
  }
});
test('invalid fields show anchored errors without shifting the form', async ({ page }) => {
  await page.goto('/settings');
  const address = page.getByLabel('ComfyUI 서버 주소', { exact: true });
  const button = page.getByRole('button', { name: '저장하고 연결 확인' });
  await address.fill('file:///invalid');
  const before = await button.boundingBox();
  await button.click();
  await expect(address).toHaveAttribute('aria-invalid', 'true');
  await expect(page.getByRole('alert')).toBeVisible();
  expect(await button.boundingBox()).toEqual(before);
  await page.goto('/create');
  await page.getByRole('button', { name: '현재 설정을 프리셋으로 저장' }).click();
  const save = page.getByRole('button', { name: '저장', exact: true });
  const savedBox = await save.boundingBox();
  await save.click();
  await expect(page.getByLabel('프리셋 이름', { exact: true })).toHaveAttribute(
    'aria-invalid',
    'true',
  );
  await expect(page.getByRole('alert')).toHaveText('프리셋 이름을 입력해 주세요');
  expect(await save.boundingBox()).toEqual(savedBox);
  await page.getByLabel('프리셋 이름', { exact: true }).fill('수정한 이름');
  await expect(page.getByRole('alert')).toHaveCount(0);
});
test('family-first model selection, GGUF submission and manual LoRA classification', async ({
  page,
}) => {
  await connect(page);
  await page.getByRole('tab', { name: /^Flux1/ }).click();
  await page.getByRole('button', { name: '모델 선택', exact: true }).click();
  await page.getByRole('button', { name: 'Flux1.D/forest-Q4.gguf', exact: true }).click();
  await page.getByRole('button', { name: '추가', exact: true }).click();
  await page.getByRole('button', { name: 'LoRA 선택', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Krea2/style.safetensors', exact: true }),
  ).toHaveCount(0);
  await page.getByRole('button', { name: 'Flux1.D/style.safetensors', exact: true }).click();
  const sent = page.waitForRequest(
    (r) => r.url().endsWith('/comfy/prompt') && r.method() === 'POST',
  );
  await page.getByTestId('generate').click();
  const body = (await sent).postDataJSON();
  expect(body.prompt['1'].class_type).toBe('UnetLoaderGGUF');
  expect(body.prompt['1'].inputs.unet_name).toBe('Flux1.D/forest-Q4.gguf');
  expect(body.prompt['8'].class_type).toBe('DualCLIPLoader');
  await expect(page.getByText('생성 완료', { exact: true })).toBeVisible({ timeout: 10000 });
  await page.getByRole('button', { name: '모델과 LoRA 계열 분류' }).click();
  await page.getByLabel('분류 대상', { exact: true }).selectOption('lora');
  await page.getByLabel('unknown.safetensors 계열', { exact: true }).selectOption('flux');
  await page.getByRole('button', { name: '완료', exact: true }).click();
  await page.getByRole('button', { name: '추가', exact: true }).click();
  await page.getByRole('button', { name: 'LoRA 선택', exact: true }).click();
  await page.getByRole('button', { name: 'unknown.safetensors', exact: true }).click();
  expect(
    await page.evaluate(() => JSON.parse(localStorage.getItem('cm-settings')!).loras),
  ).toHaveLength(2);
  await page.getByRole('tab', { name: /^krea2/ }).click();
  expect(
    await page.evaluate(() => JSON.parse(localStorage.getItem('cm-settings')!).loras),
  ).toHaveLength(0);
  await page.reload();
  expect(
    await page.evaluate(
      () => JSON.parse(localStorage.getItem('cm-asset-families')!)['lora:unknown.safetensors'],
    ),
  ).toBe('flux');
});
test('exactly four families generate directly with their native graph', async ({ page }) => {
  await connect(page);
  await expect(page.getByRole('tab')).toHaveCount(4);
  for (const [label, clipType, latent, positive] of [
    ['Flux1.d', 'flux', 'EmptySD3LatentImage', 'CLIPTextEncode'],
    ['krea2', 'krea2', 'EmptySD3LatentImage', 'CLIPTextEncode'],
    ['moss', 'moss_image', 'EmptyFlux2LatentImage', 'CLIPTextEncode'],
    ['qwen 2.1', 'qwen_image', 'EmptyFlux2LatentImage', 'TextEncodeQwenImage21'],
  ]) {
    await page.getByRole('tab', { name: new RegExp('^' + label.replace('.', '[.]')) }).click();
    await expect(page.getByTestId('generate')).toBeEnabled();
    await expect(page.getByText(/이 모델은 전용 API 워크플로/)).toHaveCount(0);
    const sent = page.waitForRequest(
      (r) => r.url().endsWith('/comfy/prompt') && r.method() === 'POST',
    );
    await page.getByTestId('generate').click();
    const body = (await sent).postDataJSON();
    expect(body.prompt['8'].inputs.type).toBe(clipType);
    expect(body.prompt['4'].class_type).toBe(latent);
    expect(body.prompt['2'].class_type).toBe(positive);
    await expect(page.getByText('생성 완료', { exact: true })).toBeVisible({ timeout: 10000 });
  }
});
