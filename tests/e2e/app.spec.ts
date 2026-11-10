import { test, expect, type Page } from '@playwright/test';
// Shared settings live in the app server's SQLite database; each test starts empty.
test.beforeEach(async ({ request }) => {
  expect((await request.post('/api/state/reset')).ok()).toBe(true);
});
async function connect(page: Page) {
  await page.goto('/settings');
  await page.getByRole('button', { name: '저장하고 연결 확인' }).click();
  await expect(page.getByText('서버에 연결했어요')).toBeVisible();
  await expect(page.getByRole('link', { name: /ComfyUI 연결 문서/ })).toHaveCount(0);
  await page.goto('/create');
  await page
    .getByRole('combobox', { name: '모델', exact: true })
    .selectOption({ label: 'Flux1.D/test-model.safetensors (체크포인트)' });
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
  await expect(page.getByRole('link', { name: '결과 보기', exact: true })).toHaveCount(0);
  expect(errors).toEqual([]);
});
test('real protocol submission, LoRA chain, batch outputs, poll fallback and reuse', async ({
  page,
}) => {
  await connect(page);
  await page.getByRole('button', { name: '추가', exact: true }).click();
  await page.getByRole('button', { name: 'LoRA 선택', exact: true }).click();
  await page.getByRole('button', { name: 'Flux1.D/soft.safetensors', exact: true }).click();
  await expect(page.getByLabel('생성 수', { exact: true })).toHaveCount(0);
  const submitted = page.waitForRequest(
    (r) => r.url().endsWith('/comfy/prompt') && r.method() === 'POST',
  );
  await page.getByTestId('generate').click();
  const body = (await submitted).postDataJSON();
  expect(body.prompt['100'].inputs.lora_name).toBe('Flux1.D/soft.safetensors');
  expect(body.prompt['4'].inputs.batch_size).toBe(1);
  expect(body.client_id).toBeTruthy();
  await expect(page.getByText('생성 완료', { exact: true })).toBeVisible({ timeout: 15000 });

  // 업스케일은 원본 출력 이미지를 업스케일 모델로 확대하고 생성 화면 설정은 그대로 둔다
  const before = await page.evaluate(() => JSON.parse(localStorage.getItem('cm-settings')!));
  await page.getByRole('button', { name: '업스케일', exact: true }).click();
  await page.getByLabel('업스케일 모델', { exact: true }).selectOption('4x-UltraSharp.pth');
  await page.getByRole('radio', { name: '2x', exact: true }).click();
  await page.getByRole('radio', { name: '끄기', exact: true }).click();
  const plain = page.waitForRequest(
    (r) => r.url().endsWith('/comfy/prompt') && r.method() === 'POST',
  );
  await page.getByRole('button', { name: '업스케일 시작', exact: true }).click();
  const plainBody = (await plain).postDataJSON().prompt;
  expect(plainBody['50'].class_type).toBe('LoadImage');
  expect(plainBody['50'].inputs.image).toMatch(/ \[output\]$/);
  expect(plainBody['51'].inputs.model_name).toBe('4x-UltraSharp.pth');
  expect(plainBody['53'].inputs.width).toBe(before.width * 2);
  expect(plainBody['53'].inputs.height).toBe(before.height * 2);
  expect(plainBody['7'].inputs.images).toEqual(['53', 0]);
  expect(plainBody['5']).toBeUndefined();
  await expect(page.getByText('생성 완료', { exact: true })).toBeVisible({ timeout: 15000 });
  const after = await page.evaluate(() => JSON.parse(localStorage.getItem('cm-settings')!));
  expect([after.width, after.height]).toEqual([before.width, before.height]);

  // 디테일 보정을 켜면 확대한 이미지를 낮은 강도로 다시 샘플링한다
  await page.getByRole('button', { name: '업스케일', exact: true }).click();
  await page.getByRole('radio', { name: '보통', exact: true }).click();
  const refined = page.waitForRequest(
    (r) => r.url().endsWith('/comfy/prompt') && r.method() === 'POST',
  );
  await page.getByRole('button', { name: '업스케일 시작', exact: true }).click();
  const refinedBody = (await refined).postDataJSON().prompt;
  expect(refinedBody['54'].class_type).toBe('VAEEncode');
  expect(refinedBody['5'].inputs.latent_image).toEqual(['54', 0]);
  expect(refinedBody['5'].inputs.denoise).toBe(0.35);
  expect(refinedBody['4']).toBeUndefined();
  await expect(page.getByText('생성 완료', { exact: true })).toBeVisible({ timeout: 15000 });

  await page.getByRole('link', { name: '설정 재사용', exact: true }).click();
  expect(
    await page.evaluate(() => JSON.parse(localStorage.getItem('cm-settings')!).upscale ?? null),
  ).toBeNull();
  expect(
    await page.evaluate(() => JSON.parse(localStorage.getItem('cm-settings')!).loras[0].name),
  ).toBe('Flux1.D/soft.safetensors');
  await page
    .getByRole('navigation', { name: '모바일 메뉴' })
    .getByRole('link', { name: '기록', exact: true })
    .click();
  // 원본 1장과 업스케일 2장이 각각 카드로 보인다
  await expect(page.getByRole('button', { name: '완료 이미지 상세 보기' })).toHaveCount(3);
  await page.getByRole('button', { name: '완료 이미지 상세 보기' }).first().click();
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
  await page.getByLabel('모델 계열', { exact: true }).selectOption('flux');
  const modelSelect = page.getByRole('combobox', { name: '모델', exact: true });
  await expect(page.getByRole('button', { name: '모델 선택', exact: true })).toHaveCount(0);
  await modelSelect.selectOption({ label: 'Flux1.D/forest-Q4.gguf (GGUF)' });
  await expect(modelSelect.locator('option:checked')).toHaveText('Flux1.D/forest-Q4.gguf (GGUF)');
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
  await page.getByLabel('모델 계열', { exact: true }).selectOption('krea2');
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
  await expect(page.getByLabel('모델 계열', { exact: true }).locator('option')).toHaveCount(4);
  for (const [family, clipType, latent, positive] of [
    ['flux', 'flux', 'EmptySD3LatentImage', 'CLIPTextEncode'],
    ['krea2', 'krea2', 'EmptySD3LatentImage', 'CLIPTextEncode'],
    ['moss', 'moss_image', 'EmptyFlux2LatentImage', 'CLIPTextEncode'],
    ['qwen21', 'qwen_image', 'EmptyFlux2LatentImage', 'TextEncodeQwenImage21'],
  ]) {
    await page.getByLabel('모델 계열', { exact: true }).selectOption(family);
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
test('click image surface opens fullscreen viewer with zoom controls, pinch ready, and closes cleanly', async ({
  page,
}) => {
  await page.goto('/create');

  // 독립 확장 버튼 래퍼가 없는지 확인
  const expandIconWrapper = page.locator('.absolute.right-3.top-3.rounded-xl.bg-white\\/90');
  await expect(expandIconWrapper).toHaveCount(0);

  // 이미지 영역 클릭
  const imageSurface = page.getByRole('button', { name: '이미지 크게 보기' });
  await expect(imageSurface).toBeVisible();
  await imageSurface.click();

  // 바텀시트가 아닌 풀스크린 다이얼로그 뷰어 열림 확인
  const viewer = page.getByRole('dialog', { name: '이미지 전체 화면 뷰어' });
  await expect(viewer).toBeVisible();
  await expect(viewer).toHaveClass(/fixed inset-0/);

  // 닫기 버튼 표시 확인
  const closeBtn = viewer.getByRole('button', { name: '닫기' });
  await expect(closeBtn).toBeVisible();

  // 확대 및 배율 리셋 확인
  const zoomInBtn = viewer.getByRole('button', { name: '확대' });
  await zoomInBtn.click();
  const resetChip = viewer.getByRole('button', { name: '확대 초기화' });
  await expect(resetChip).toBeVisible();
  await resetChip.click();
  await expect(resetChip).toHaveCount(0);

  // ESC 키로 닫기
  await page.keyboard.press('Escape');
  await expect(viewer).toHaveCount(0);
});
test('advanced settings highlights non-recommended values and restores them per field', async ({
  page,
}) => {
  await page.goto('/create');
  await page.getByRole('button', { name: '고급 설정', exact: true }).click();
  await expect(page.getByText(/최고 화질 공식 권장값/)).toHaveCount(0);

  // 권장값 상태에서는 되돌리기 버튼이 비활성화된다
  const cfg = page.getByLabel('CFG', { exact: true });
  const reset = page.getByRole('button', { name: 'CFG 권장값(1)으로 되돌리기' });
  await cfg.fill('1');
  await expect(reset).toBeDisabled();

  // 권장값과 다르면 황색 배경과 함께 되돌리기 버튼이 활성화된다
  await cfg.fill('3.5');
  await expect(cfg).toHaveClass(/bg-amber-50/);
  await expect(reset).toBeEnabled();
  await reset.click();
  expect(await cfg.inputValue()).toBe('1');
  await expect(cfg).not.toHaveClass(/bg-amber-50/);

  // 도움말 아이콘을 누르면 HTML 툴팁으로 속성 설명을 보여준다
  await page.getByRole('button', { name: 'Sampler 도움말' }).click();
  await expect(page.getByRole('tooltip')).toContainText('노이즈를 걷어내는 계산 방식');
  await expect(page.getByRole('button', { name: '너비 도움말' })).toHaveCount(0);

  // 너비와 높이는 고급 설정이 아니라 이미지 설정에서 바꾼다
  await expect(page.getByRole('dialog').getByLabel('너비', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '설정 완료' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByLabel('생성 수', { exact: true })).toHaveCount(0);
  await page.getByLabel('너비', { exact: true }).fill('768');
  await page.getByLabel('높이', { exact: true }).fill('1024');
  await page.getByRole('button', { name: '가로와 세로 바꾸기' }).click();
  expect(await page.getByLabel('너비', { exact: true }).inputValue()).toBe('1024');
  expect(await page.getByLabel('높이', { exact: true }).inputValue()).toBe('768');
});
test('LoRA manager browses, updates metadata, applies trigger words, and downloads from CivitAI', async ({
  page,
}) => {
  await connect(page);
  await page.goto('/loras');

  await expect(page.getByRole('heading', { name: 'Flux Soft Portrait LoRA' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Krea2 Editorial Style' })).toBeVisible();

  // 업데이트 확인 실행
  await page.getByRole('button', { name: '업데이트 확인' }).click();
  await expect(page.getByText(/새 버전이 있어요/)).toBeVisible();

  // 제거한 필터와 체크박스가 남아 있지 않은지 확인
  await expect(page.getByLabel('베이스 모델 필터', { exact: true })).toHaveCount(0);
  await expect(page.getByLabel('정렬 기준', { exact: true })).toHaveCount(0);
  await expect(page.getByText('적용 시 트리거 워드 자동 추가')).toHaveCount(0);

  // 상태 드롭다운에서 즐겨찾기만 표시
  await page.getByLabel('상태 필터', { exact: true }).selectOption('favorites');
  await expect(page.getByRole('heading', { name: 'Flux Soft Portrait LoRA' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Krea2 Editorial Style' })).toHaveCount(0);
  await page.getByLabel('상태 필터', { exact: true }).selectOption('all');

  // 태그 멀티 셀렉트 드롭다운에서 #editorial 필터링
  await page.getByRole('button', { name: '태그 필터' }).click();
  const tagList = page.getByRole('listbox', { name: '태그 필터 목록' });
  await expect(tagList).toBeVisible();
  await tagList.getByRole('option', { name: /#editorial/ }).click();
  await expect(page.getByRole('heading', { name: 'Krea2 Editorial Style' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Flux Soft Portrait LoRA' })).toHaveCount(0);

  // 드롭다운의 선택 해제로 태그 필터 해제 후 Escape로 닫기
  await page.getByRole('button', { name: '선택 해제' }).click();
  await page.keyboard.press('Escape');
  await expect(tagList).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Flux Soft Portrait LoRA' })).toBeVisible();

  // 페이징 버튼(이전/다음)이 존재하지 않는지 확인
  await expect(page.getByRole('button', { name: '이전', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '다음', exact: true })).toHaveCount(0);

  // 목록 끝 안내 문구는 표시하지 않음
  await expect(page.getByText(/모든 LoRA\(\d+개\)/)).toHaveCount(0);

  // 상세 모달 열기, 예시 이미지 확인 및 원격 버전 조회
  await page.getByRole('heading', { name: 'Flux Soft Portrait LoRA' }).click();
  const detailDialog = page.getByRole('dialog');
  await expect(detailDialog).toBeVisible();
  const loraGallery = detailDialog.getByRole('region', { name: '예시 이미지' });
  await expect(loraGallery.getByRole('button', { name: /크게 보기$/ })).toHaveCount(2);
  await loraGallery.getByRole('button', { name: '예시 이미지 1 크게 보기' }).click();
  await expect(
    page.getByRole('dialog', { name: '예시 이미지 1 / 3' }).getByText('loras studio portrait, soft key light, 85mm'),
  ).toBeVisible();
  await page.keyboard.press('Escape');
  const loraDefault = loraGallery.getByRole('checkbox', { name: '예시 이미지 1 기본 이미지로 설정' });
  await loraDefault.click();
  await expect(loraDefault).toHaveAttribute('aria-checked', 'true');
  await detailDialog.getByRole('button', { name: '원격 버전 조회' }).click();
  await expect(detailDialog.getByText('v2.0 HD')).toBeVisible();

  // 적용 후 생성 화면으로 이동 (트리거 워드 자동 반영)
  await detailDialog.getByRole('button', { name: '적용 후 생성 화면으로' }).click();
  await expect(page).toHaveURL(/\/create$/);
  await expect(page.getByText('Flux1.D/soft.safetensors')).toBeVisible();
  const promptVal = await page.getByLabel('그리고 싶은 장면', { exact: true }).inputValue();
  expect(promptVal).toContain('soft studio glow');

  // 다시 LoRA 화면에서 CivitAI 다운로드 수행
  await page.goto('/loras');
  await page.getByRole('button', { name: 'CivitAI 다운로드' }).click();
  const dlDialog = page.getByRole('dialog');
  await dlDialog
    .getByLabel('CivitAI AIR 코드', { exact: true })
    .fill('urn:air:flux1:lora:civitai:840370@990500');
  await dlDialog.getByRole('button', { name: 'CivitAI 조회' }).click();
  await expect(dlDialog.getByLabel('다운로드할 버전 선택')).toBeVisible();
  await dlDialog.getByRole('button', { name: '선택 버전 다운로드' }).click();

  await expect(
    page.getByRole('heading', { name: /Flux Soft Portrait v2 \(990500\)/ }),
  ).toBeVisible();
});
test('quick badges removed, collapsed negative prompt, and tabbed settings with default prompts', async ({
  page,
}) => {
  await page.goto('/create');

  // 1. 스니펫 드롭다운이 제거되었는지 확인
  await expect(page.getByRole('button', { name: /스니펫/ })).toHaveCount(0);

  // 2. 네거티브 프롬프트가 기본 접은 상태인지 확인
  const negToggle = page.getByRole('button', { name: '네거티브 프롬프트', exact: true });
  await expect(negToggle).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('#negative')).toHaveCount(0);
  await negToggle.click();
  await expect(negToggle).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('#negative')).toBeVisible();

  // 3. 단축 배지 기능은 제거됨
  await expect(page.getByRole('button', { name: '단축 배지 관리' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'cinematic lighting' })).toHaveCount(0);

  // 4. 내비게이션이 '설정'으로 변경되고 카테고리 탭(연결 설정, 기본 프롬프트 설정, 앱 및 알림)이 동작하는지 확인
  await page
    .getByRole('navigation', { name: '모바일 메뉴' })
    .getByRole('link', { name: '설정', exact: true })
    .click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('설정');

  const connTab = page.getByRole('tab', { name: '연결 설정', exact: true });
  const promptTab = page.getByRole('tab', { name: '기본 프롬프트 설정', exact: true });
  const appTab = page.getByRole('tab', { name: '앱 및 알림', exact: true });

  await expect(connTab).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('heading', { name: 'ComfyUI 연결' })).toBeVisible();

  await appTab.click();
  await expect(appTab).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('heading', { name: '앱 설치와 업데이트' })).toBeVisible();

  // 5. 기본 프롬프트 설정 탭에서 기본 프롬프트 수정 및 저장 확인
  await promptTab.click();
  await expect(promptTab).toHaveAttribute('aria-selected', 'true');
  await page
    .getByLabel('기본 포지티브 프롬프트', { exact: true })
    .fill('studio portrait, golden hour glow');
  await page.getByLabel('기본 네거티브 프롬프트', { exact: true }).fill('lowres, bad anatomy');
  await page.getByRole('button', { name: '기본 프롬프트 저장', exact: true }).click();

  // 325px 뷰포트에서 어절 분절 0건 및 가로 넘침 없음 확인
  await page.setViewportSize({ width: 325, height: 667 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  const splitWords = await page.evaluate(() => {
    const bad: string[] = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const node = walker.currentNode,
        parent = node.parentElement;
      if (!parent || parent.closest('.sr-only, script, style') || !parent.getClientRects().length)
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

  await page.goto('/create');
  await expect(page.getByLabel('그리고 싶은 장면', { exact: true })).toHaveValue(
    'studio portrait, golden hour glow',
  );
});
test('Model manager browses checkpoints and diffusion models, filters, applies to generation, and downloads from CivitAI', async ({
  page,
}) => {
  await connect(page);
  await page.goto('/models');

  await expect(page.getByRole('heading', { level: 1 })).toHaveText('모델');
  await expect(page.getByRole('heading', { name: 'Flux Studio Checkpoint FP8' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Krea2 Turbo 8-Step Diffusion' })).toBeVisible();

  // 업데이트 확인 실행
  await page.getByRole('button', { name: '업데이트 확인' }).click();
  await expect(page.getByText(/새 버전이 있어요/)).toBeVisible();

  // 민감 프리뷰 표시는 필터 끝의 아이콘 토글 버튼
  const nsfwToggle = page.getByRole('button', { name: '민감 프리뷰 표시', exact: true });
  await expect(nsfwToggle).toHaveAttribute('aria-pressed', 'false');
  const tagBox = await page.getByRole('button', { name: '태그 필터' }).boundingBox();
  const toggleBox = await nsfwToggle.boundingBox();
  expect(toggleBox!.x).toBeGreaterThan(tagBox!.x + tagBox!.width);
  expect(Math.abs(toggleBox!.y - tagBox!.y)).toBeLessThanOrEqual(2);
  await nsfwToggle.click();
  await expect(nsfwToggle).toHaveAttribute('aria-pressed', 'true');
  await nsfwToggle.click();

  // 제거한 필터가 남아 있지 않은지 확인
  for (const label of ['모델 유형 필터', '베이스 모델 필터', '정렬 기준']) {
    await expect(page.getByLabel(label, { exact: true })).toHaveCount(0);
  }

  // 상태 드롭다운에서 즐겨찾기만 표시
  await page.getByLabel('상태 필터', { exact: true }).selectOption('favorites');
  await expect(page.getByRole('heading', { name: 'Flux Studio Checkpoint FP8' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Krea2 Turbo 8-Step Diffusion' })).toHaveCount(0);
  await page.getByLabel('상태 필터', { exact: true }).selectOption('all');

  // 태그 멀티 셀렉트 드롭다운에서 #krea2 필터링
  await page.getByRole('button', { name: '태그 필터' }).click();
  const tagList = page.getByRole('listbox', { name: '태그 필터 목록' });
  await tagList.getByRole('option', { name: /#krea2/ }).click();
  await expect(page.getByRole('heading', { name: 'Krea2 Turbo 8-Step Diffusion' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Flux Studio Checkpoint FP8' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '태그 필터' })).toContainText('#krea2');

  // 같은 항목을 다시 눌러 해제
  await tagList.getByRole('option', { name: /#krea2/ }).click();
  await expect(page.getByRole('heading', { name: 'Flux Studio Checkpoint FP8' })).toBeVisible();
  await page.keyboard.press('Escape');

  // 상세 모달 열기, 원격 버전 조회 및 생성 화면으로 모델 적용
  await page.getByRole('heading', { name: 'Krea2 Turbo 8-Step Diffusion' }).click();
  const detailDialog = page.getByRole('dialog');
  await expect(detailDialog).toBeVisible();

  // CivitAI 예시 이미지: 원본 비율 그대로, 민감한 이미지는 가림, 누르면 생성 정보와 함께 크게 보기
  const gallery = detailDialog.getByRole('region', { name: '예시 이미지' });
  const first = gallery.getByRole('button', { name: '예시 이미지 1 크게 보기' });
  await expect(first).toBeVisible();
  const firstBox = await first.boundingBox();
  expect(firstBox!.height / firstBox!.width).toBeCloseTo(1216 / 832, 1);
  const sensitive = gallery.getByRole('button', { name: '예시 이미지 3 민감한 이미지 보기' });
  await expect(sensitive).toBeVisible();
  await sensitive.click();
  await expect(gallery.getByRole('button', { name: '예시 이미지 3 크게 보기' })).toBeVisible();
  await first.click();
  const viewer = page.getByRole('dialog', { name: '예시 이미지 1 / 3' });
  await expect(viewer).toBeVisible();
  await expect(viewer.getByText('checkpoints studio portrait, soft key light, 85mm')).toBeVisible();
  await expect(viewer.getByText('flux-studio')).toBeVisible();
  await expect(viewer.getByText('777', { exact: true })).toBeVisible();
  await expect(viewer.getByText('832 × 1216')).toBeVisible();
  await page.keyboard.press('ArrowRight');
  const second = page.getByRole('dialog', { name: '예시 이미지 2 / 3' });
  await expect(second.getByText('이 이미지에는 작성자가 남긴 생성 정보가 없어요')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: /^예시 이미지/ })).toHaveCount(0);
  await expect(detailDialog).toBeVisible();

  // 예시 이미지 좌하단 체크박스로 카드 기본 이미지 교체
  const makeDefault = gallery.getByRole('checkbox', {
    name: '예시 이미지 2 기본 이미지로 설정',
  });
  await expect(makeDefault).toHaveAttribute('aria-checked', 'false');
  const defaultBox = await makeDefault.boundingBox();
  const secondCard = await gallery
    .getByRole('button', { name: '예시 이미지 2 크게 보기' })
    .boundingBox();
  expect(defaultBox!.x - secondCard!.x).toBeLessThan(16);
  expect(secondCard!.y + secondCard!.height - (defaultBox!.y + defaultBox!.height)).toBeLessThan(16);
  await makeDefault.click();
  await expect(makeDefault).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByText('기본 이미지로 설정했어요')).toBeVisible();
  await expect(page.locator('img[src*="path=example-2.svg&v="]')).toHaveCount(1);

  await detailDialog.getByRole('button', { name: '원격 버전 조회' }).click();
  await expect(detailDialog.getByText('v3.0 Studio FP8')).toBeVisible();

  await detailDialog.getByRole('button', { name: '적용 후 생성 화면으로' }).click();
  await expect(page).toHaveURL(/\/create$/);
  expect(
    await page.evaluate(() => JSON.parse(localStorage.getItem('cm-settings')!).architecture),
  ).toBe('krea2');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('cm-settings')!).model)).toBe(
    'Krea2/krea2_turbo.safetensors',
  );

  // 다시 모델 화면으로 이동하여 CivitAI 모델 다운로드 수행
  await page.goto('/models');
  await page.getByRole('button', { name: 'CivitAI 다운로드' }).click();
  const dlDialog = page.getByRole('dialog');
  await dlDialog
    .getByLabel('CivitAI AIR 코드', { exact: true })
    .fill('urn:air:flux1:checkpoint:civitai:705606@992100+5501');
  await dlDialog.getByRole('button', { name: 'CivitAI 조회' }).click();
  await expect(dlDialog.getByLabel('다운로드할 버전 선택')).toBeVisible();
  await dlDialog.getByRole('button', { name: '선택 버전 다운로드' }).click();

  await expect(
    page.getByRole('heading', { name: /Flux Studio Checkpoint v3 \(992100\) file 5501/ }),
  ).toBeVisible();
});
test('sidebar cleanup, prompt assemble multi-select, model dropdown, LoRA keyboard strength, ratio dropdown, and single-line gallery filters', async ({
  page,
  browser,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await connect(page);

  // 1. 사이드바 문구 제거와 연결 상태가 브랜딩 오른쪽에 있는지 확인
  const sidebar = page.getByRole('complementary');
  const badge = sidebar.getByRole('link', { name: '연결됨', exact: true });
  const brandBox = await sidebar.getByRole('link', { name: 'ComfyMUI 홈' }).boundingBox();
  const badgeBox = await badge.boundingBox();
  expect(badgeBox!.x).toBeGreaterThan(brandBox!.x + brandBox!.width);
  expect(Math.abs(badgeBox!.y + badgeBox!.height / 2 - (brandBox!.y + brandBox!.height / 2))).toBeLessThanOrEqual(2);
  await expect(page.getByRole('banner').getByRole('link', { name: '연결됨' })).toBeHidden();
  await expect(page.getByText('연결 관리')).toHaveCount(0);
  await expect(page.getByText('상상을 위한, 가벼운 작업실')).toHaveCount(0);

  // 2. 만들기 화면 문구 및 관리 버튼, 입력 보조 제거 확인
  await expect(page.getByText('모든 설정은 자동 저장돼요')).toHaveCount(0);
  await expect(page.getByText('입력 보조:')).toHaveCount(0);
  await expect(page.getByRole('link', { name: '관리', exact: true })).toHaveCount(0);

  // 3. 모델은 계열과 같은 줄의 드롭다운에서 바로 선택
  const modelSelect = page.getByRole('combobox', { name: '모델', exact: true });
  const familyBox = await page.getByLabel('모델 계열', { exact: true }).boundingBox();
  const modelBox = await modelSelect.boundingBox();
  expect(Math.abs(familyBox!.y - modelBox!.y)).toBeLessThanOrEqual(2);
  await modelSelect.selectOption({ label: 'Flux1.D/another.safetensors (체크포인트)' });
  await expect
    .poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('cm-settings')!).model))
    .toBe('Flux1.D/another.safetensors');
  await modelSelect.selectOption({ label: 'Flux1.D/test-model.safetensors (체크포인트)' });
  await expect(page.getByRole('dialog')).toHaveCount(0);

  // 4. 프롬프트 어셈블 다중 선택 및 설정 연동 확인
  const elemSelect = page.getByLabel('프롬프트 요소', { exact: true });
  await expect(elemSelect).toBeVisible();
  const attrBtn = page.getByRole('button', { name: '프롬프트 속성', exact: true });
  await attrBtn.click();
  const listbox = page.getByRole('listbox', { name: '앵글 속성 목록' });
  await expect(listbox).toBeVisible();
  await listbox.getByRole('option', { name: 'eye-level', exact: true }).click();
  await listbox.getByRole('option', { name: 'bird-eye', exact: true }).click();
  const promptText = await page.getByLabel('그리고 싶은 장면', { exact: true }).inputValue();
  expect(promptText).toContain('eye-level');
  expect(promptText).toContain('bird-eye');
  await page.keyboard.press('Escape');

  // 5. LoRA 강도 클릭하여 키보드 입력 지원 확인
  await page.getByRole('button', { name: '추가', exact: true }).click();
  await page.getByRole('button', { name: 'LoRA 선택', exact: true }).click();
  await page.getByRole('button', { name: 'Flux1.D/soft.safetensors', exact: true }).click();
  await page.getByRole('button', { name: /LoRA 1 모델 강도 값 직접 입력/ }).click();
  const strengthInput = page.getByLabel('LoRA 1 모델 강도 수치 입력', { exact: true });
  await expect(strengthInput).toBeVisible();
  await strengthInput.fill('0.65');
  await strengthInput.press('Enter');
  await expect(
    page.getByRole('button', { name: 'LoRA 1 모델 강도 값 직접 입력 (0.65)' }),
  ).toBeVisible();

  // 6. 이미지 설정 비율 드롭다운 변경 확인
  const ratioSelect = page.getByLabel('비율', { exact: true });
  await expect(ratioSelect).toBeVisible();
  await ratioSelect.selectOption('1024x576');
  await expect(page.getByLabel('너비', { exact: true })).toHaveValue('1024');
  await expect(page.getByLabel('높이', { exact: true })).toHaveValue('576');
  await expect(page.getByLabel('해상도', { exact: true })).toHaveCount(0);

  // 7. 기록 화면 넓은 화면에서 배지 필터와 모델/LoRA 드롭다운 한줄 표시 확인
  await page.goto('/gallery');
  await expect(page.getByRole('button', { name: '즐겨찾기', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '전체 상태', exact: true })).toHaveCount(0);
  const favBtnBox = await page.getByLabel('모델 계열 필터', { exact: true }).boundingBox();
  const loraSelectBox = await page.getByLabel('LoRA 필터', { exact: true }).boundingBox();
  expect(favBtnBox).not.toBeNull();
  expect(loraSelectBox).not.toBeNull();
  expect(Math.abs(favBtnBox!.y - loraSelectBox!.y)).toBeLessThanOrEqual(2);

  // 8. 모바일 뷰포트(390x844)에서도 모델 드롭다운이 계열 옆 한 줄에 들어가는지 확인
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/create');
  const mobileModel = page.getByRole('combobox', { name: '모델', exact: true });
  const mobileModelBox = await mobileModel.boundingBox();
  const mobileFamilyBox = await page.getByLabel('모델 계열', { exact: true }).boundingBox();
  expect(Math.abs(mobileModelBox!.y - mobileFamilyBox!.y)).toBeLessThanOrEqual(2);
  expect(mobileModelBox!.x + mobileModelBox!.width).toBeLessThanOrEqual(390);
  await expect(mobileModel.locator('option:checked')).toHaveText(
    'Flux1.D/test-model.safetensors (체크포인트)',
  );

  // 9. 설정 - 프롬프트 어셈블 기존 요소/속성 수정, 검색 및 일괄 편집 관리 확인
  await page.goto('/settings');
  await page.getByRole('tab', { name: '기본 프롬프트 설정' }).click();
  // 요소 목록에서 손잡이로 순서 변경 (키보드 드래그)
  const elementHandle = page.getByRole('button', { name: '구도 요소 순서 변경' });
  await elementHandle.focus();
  await page.keyboard.press('Space');
  await page.waitForTimeout(150);
  await page.keyboard.press('ArrowUp');
  await page.waitForTimeout(150);
  await page.keyboard.press('Space');
  await expect
    .poll(async () =>
      page
        .getByRole('list', { name: '어셈블 요소 목록' })
        .getByRole('button', { name: /요소 편집$/ })
        .allInnerTexts(),
    )
    .toEqual([
      expect.stringContaining('앵글'),
      expect.stringContaining('구도'),
      expect.stringContaining('구성'),
    ]);

  // 요소 편집 화면으로 이동해 속성 수정, 추가, 삭제
  await page.getByRole('button', { name: '구성 요소 편집' }).click();
  await expect(page.getByLabel('선택 요소 이름', { exact: true })).toHaveValue('구성');
  await page.getByRole('button', { name: '구성 close-up 속성 수정' }).click();
  const editAttrInput = page.getByLabel('기존 속성 수정 입력', { exact: true });
  await expect(editAttrInput).toBeVisible();
  await editAttrInput.fill('close-up-edited');
  await page.getByRole('button', { name: '수정 저장' }).click();
  await expect(page.getByRole('button', { name: '구성 close-up-edited 속성 수정' })).toBeVisible();

  await page.getByLabel('구성 속성 추가 입력', { exact: true }).fill('macro, macro');
  await page.getByRole('button', { name: '구성 속성 추가' }).click();
  await expect(page.getByRole('button', { name: '구성 macro 속성 수정' })).toHaveCount(1);
  await page.getByRole('button', { name: '구성 macro 속성 삭제' }).click();
  await expect(page.getByRole('button', { name: '구성 macro 속성 수정' })).toHaveCount(0);

  await page.getByRole('button', { name: '일괄 편집' }).click();
  const bulkArea = page.getByLabel('구성 속성 일괄 편집', { exact: true });
  await expect(bulkArea).toBeVisible();
  expect(await bulkArea.inputValue()).toContain('close-up-edited');
  await page.getByRole('button', { name: '일괄 적용' }).click();
  await expect(bulkArea).toHaveCount(0);

  // 요소 목록으로 돌아가기
  await page.getByRole('button', { name: '요소 목록' }).click();
  await expect(page.getByRole('button', { name: '구성 요소 편집' })).toBeVisible();

  // 10. 새로고침 및 다른 기기(새 브라우저 컨텍스트) 접속 시 선택/입력 상태 유지 확인
  await page.goto('/create');
  await page.getByLabel('프롬프트 요소', { exact: true }).selectOption('framing');
  await page.waitForTimeout(100);
  await page.reload();
  await expect(page.getByLabel('프롬프트 요소', { exact: true })).toHaveValue('framing');
  await expect(page.getByLabel('비율', { exact: true })).toHaveValue('1024x576');
  await expect(
    page.getByRole('button', { name: 'LoRA 1 모델 강도 값 직접 입력 (0.65)' }),
  ).toBeVisible();
  expect(await page.getByLabel('그리고 싶은 장면', { exact: true }).inputValue()).toContain(
    'bird-eye',
  );

  const otherDeviceContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const otherPage = await otherDeviceContext.newPage();
  await otherPage.goto('/create');
  await expect(otherPage.getByLabel('프롬프트 요소', { exact: true })).toHaveValue('framing');
  await expect(otherPage.getByLabel('비율', { exact: true })).toHaveValue('1024x576');
  await expect(
    otherPage.getByRole('button', { name: 'LoRA 1 모델 강도 값 직접 입력 (0.65)' }),
  ).toBeVisible();
  expect(await otherPage.getByLabel('그리고 싶은 장면', { exact: true }).inputValue()).toContain(
    'bird-eye',
  );
  await expect
    .poll(() =>
      otherPage.evaluate(() => JSON.parse(localStorage.getItem('cm-settings') || '{}').model),
    )
    .toBe('Flux1.D/test-model.safetensors');
  await otherDeviceContext.close();
});

test('gallery lists the ComfyUI output folder and deleting removes the file', async ({ page }) => {
  await connect(page);
  type GalleryFile = {
    filename: string;
    subfolder: string;
    settings?: { positive?: string; seed?: number };
    summary?: { positive?: string };
  };
  const gallery = async () =>
    ((await (await page.request.get('/api/gallery')).json()) as { items: GalleryFile[] }).items;

  // 앱으로 2장을 만든다 (다른 테스트가 만든 파일은 기준 목록으로 제외)
  const baseline = new Set((await gallery()).map((f) => f.filename));
  const prompt = page.getByLabel('그리고 싶은 장면', { exact: true });
  await prompt.fill('갤러리 동기화 확인용 장면');
  for (let i = 0; i < 2; i++) {
    await page.getByTestId('generate').click();
    await expect(page.getByText('생성 완료', { exact: true })).toBeVisible({ timeout: 15000 });
    await page.waitForTimeout(300);
  }
  await expect
    .poll(async () => (await gallery()).filter((f) => !baseline.has(f.filename)).length)
    .toBe(2);
  const created = (await gallery()).filter((f) => !baseline.has(f.filename));
  // 앱 설정이 PNG에 저장되고 워크플로 요약도 읽힌다
  expect(created[0].settings?.positive).toBe('갤러리 동기화 확인용 장면');
  expect(created[0].summary?.positive).toBe('갤러리 동기화 확인용 장면');

  await page.goto('/gallery');
  const total = (await gallery()).length;
  const deleteButtons = page.getByRole('button', { name: '기록 삭제', exact: true });
  await expect(deleteButtons).toHaveCount(total);
  await expect(page.getByRole('button', { name: '즐겨찾기 등록' })).toHaveCount(0);

  // 검색과 필터는 한 줄, 다중 선택 버튼 대신 이미지마다 체크박스
  const searchBox = await page.getByLabel('기록 검색', { exact: true }).boundingBox();
  const loraBox = await page.getByLabel('LoRA 필터', { exact: true }).boundingBox();
  expect(Math.abs(searchBox!.y - loraBox!.y)).toBeLessThanOrEqual(2);
  // 개수는 넓은 화면에서 필터와 같은 줄 끝, 모바일에서는 다음 줄 오른쪽
  await page.setViewportSize({ width: 1280, height: 900 });
  const count = page.getByText(`표시 ${total} / ${total}개`, { exact: true });
  const wideLora = await page.getByLabel('LoRA 필터', { exact: true }).boundingBox();
  const countBox = await count.boundingBox();
  expect(countBox!.x).toBeGreaterThan(wideLora!.x + wideLora!.width);
  expect(
    Math.abs(countBox!.y + countBox!.height / 2 - (wideLora!.y + wideLora!.height / 2)),
  ).toBeLessThanOrEqual(3);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('button', { name: '다중 선택', exact: true })).toHaveCount(0);
  const checks = page.getByRole('checkbox', { name: '이미지 선택' });
  await expect(checks).toHaveCount(total);
  await checks.nth(0).click();
  await expect(checks.nth(0)).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByText('1개 선택', { exact: true })).toBeVisible();
  await expect(deleteButtons).toHaveCount(0);
  await page.getByRole('button', { name: '선택 해제', exact: true }).first().click();
  await expect(page.getByText('1개 선택', { exact: true })).toHaveCount(0);
  await expect(deleteButtons).toHaveCount(total);

  // 앱 밖에서 파일이 지워지면 다시 불러올 때 목록에서 빠진다
  const removed = await page.request.post('/api/outputs/delete', {
    data: { files: [{ filename: created[0].filename, subfolder: '', type: 'output' }] },
  });
  expect((await removed.json()).deleted).toEqual([created[0].filename]);
  await page.reload();
  await expect(deleteButtons).toHaveCount(total - 1);

  // 파일에서 설정을 그대로 복원해 재사용한다
  await page.getByRole('button', { name: '완료 이미지 상세 보기' }).first().click();
  await page.getByRole('link', { name: '설정 재사용', exact: true }).click();
  await expect(page).toHaveURL(/\/create$/);
  await expect(prompt).toHaveValue('갤러리 동기화 확인용 장면');

  // 기록 화면에서 삭제하면 실제 파일이 지워진다
  await page.goto('/gallery');
  await deleteButtons.first().click();
  const dialog = page.getByRole('dialog', { name: '이미지를 삭제할까요?' });
  await expect(dialog).toContainText('output 폴더의 이미지 파일을 삭제');
  await dialog.getByRole('button', { name: '파일 삭제' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(deleteButtons).toHaveCount(total - 2);
  const remaining = new Set((await gallery()).map((f) => f.filename));
  expect(remaining.has(created[1].filename)).toBe(false);
});

test('generation count input runs once by default and repeats with new seeds', async ({
  page,
}) => {
  await connect(page);
  // 장 수와 생성 버튼은 상단바에 있고 하단 고정란은 없음
  const header = page.getByRole('banner');
  const runs = header.getByRole('spinbutton', { name: '장 수' });
  await expect(runs).toHaveValue('1');
  await expect(header.getByTestId('generate')).toBeVisible();
  const headerBox = await header.boundingBox();
  const generateBox = await page.getByTestId('generate').boundingBox();
  expect(generateBox!.x + generateBox!.width).toBeLessThanOrEqual(headerBox!.x + headerBox!.width);
  expect(generateBox!.y + generateBox!.height).toBeLessThanOrEqual(headerBox!.y + headerBox!.height);
  await expect(page.getByRole('button', { name: 'Seed 변경 연속 생성' })).toHaveCount(0);
  await runs.fill('0');
  await runs.blur();
  await expect(runs).toHaveValue('1');
  await runs.fill('3');
  await expect(page.getByTestId('generate')).toContainText('3장');
  const seeds: number[] = [];
  page.on('request', (r) => {
    if (r.url().endsWith('/comfy/prompt') && r.method() === 'POST')
      seeds.push(r.postDataJSON().prompt['5'].inputs.seed);
  });
  await page.getByTestId('generate').click();
  await expect.poll(() => seeds.length, { timeout: 45000 }).toBe(3);
  expect(new Set(seeds).size).toBe(3);
});

test('example default image syncs to other devices and remix fills the create form', async ({
  page,
  browser,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await connect(page);
  await page.goto('/models');
  await page.getByRole('heading', { name: 'Krea2 Turbo 8-Step Diffusion' }).click();
  const gallery = page.getByRole('dialog').getByRole('region', { name: '예시 이미지' });
  const pick = gallery.getByRole('checkbox', { name: '예시 이미지 1 기본 이미지로 설정' });
  await pick.click();
  await expect(pick).toHaveAttribute('aria-checked', 'true');

  // 다른 기기에서도 같은 예시가 기본 이미지로 체크되어 있음
  const other = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const otherPage = await other.newPage();
  await otherPage.goto('/models');
  await otherPage.getByRole('heading', { name: 'Krea2 Turbo 8-Step Diffusion' }).click();
  await expect(
    otherPage.getByRole('checkbox', { name: '예시 이미지 1 기본 이미지로 설정' }),
  ).toHaveAttribute('aria-checked', 'true');
  await other.close();

  // 예시의 생성 정보를 만들기 화면으로 가져오기
  await gallery.getByRole('button', { name: '예시 이미지 1 크게 보기' }).click();
  await page.getByRole('button', { name: '이 설정으로 만들기' }).click();
  await expect(page).toHaveURL(/\/create$/);
  await expect(page.getByLabel('그리고 싶은 장면', { exact: true })).toHaveValue(
    'checkpoints studio portrait, soft key light, 85mm',
  );
  await expect
    .poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('cm-settings')!)))
    .toMatchObject({
      seed: 777,
      random: false,
      width: 832,
      height: 1216,
      steps: 24,
      guidance: 3.5,
      sampler: 'euler',
      model: 'Flux1.D/test-model.safetensors',
    });
});

test('old JSON sync file is imported into the database once, then the database wins', async ({
  page,
  request,
}) => {
  await request.post('/comfy/userdata/comfymui-state.json', {
    data: {
      entries: {
        'cm-model-order': { value: ['UNETLoader:예전.safetensors'], updatedAt: 5 },
        'not-an-app-key': { value: 1, updatedAt: 5 },
      },
    },
  });
  await request.post('/api/state/reset');
  const first = await (await request.get('/api/state')).json();
  expect(first.entries['cm-model-order'].value).toEqual(['UNETLoader:예전.safetensors']);
  expect(first.entries['not-an-app-key']).toBeUndefined();

  // The app shows the imported value, and later edits to the old file are ignored
  await page.goto('/create');
  await expect
    .poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('cm-model-order') || '[]')))
    .toEqual(['UNETLoader:예전.safetensors']);
  await request.post('/comfy/userdata/comfymui-state.json', {
    data: { entries: { 'cm-model-order': { value: ['UNETLoader:나중.safetensors'], updatedAt: 9 } } },
  });
  const again = await (await request.get('/api/state')).json();
  expect(again.entries['cm-model-order'].value).toEqual(['UNETLoader:예전.safetensors']);
  await request.post('/comfy/userdata/comfymui-state.json', { data: {} });
});

test('model download keeps tracking after the app loses the request', async ({ page }) => {
  await connect(page);
  await page.goto('/loras');

  // 요청은 서버에 전달되지만 응답 전에 연결이 끊긴 상황 (앱 최소화, 네트워크 전환)
  await page.route('**/comfy/api/lm/download-model', async (route) => {
    await route.fetch();
    await route.abort('connectionreset');
  });

  await page.getByRole('button', { name: 'CivitAI 다운로드' }).click();
  const dlDialog = page.getByRole('dialog');
  await dlDialog
    .getByLabel('CivitAI AIR 코드', { exact: true })
    .fill('urn:air:flux1:lora:civitai:840370@990777');
  await dlDialog.getByRole('button', { name: 'CivitAI 조회' }).click();
  await expect(dlDialog.getByLabel('다운로드할 버전 선택')).toBeVisible();
  await dlDialog.getByRole('button', { name: '선택 버전 다운로드' }).click();

  // 창은 바로 닫히고 진행 목록이 생긴다
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByText('백그라운드에서 다운로드를 시작했어요')).toBeVisible();

  // 진행률 API와 라이브러리 등록을 확인해 완료 처리하고 목록을 새로고침한다
  await expect(page.getByText(/다운로드를 완료했어요/)).toBeVisible({ timeout: 15000 });
  await expect(page.getByRole('region', { name: '진행 중인 다운로드' })).toHaveCount(0);
  await expect(
    page.getByRole('heading', { name: /Flux Soft Portrait v2 \(990777\)/ }),
  ).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('cm-downloads'))).toBe('[]');
});
