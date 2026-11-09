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
test('advanced settings shows quality recommendation card and auto-fixes quality degradation', async ({
  page,
}) => {
  await page.goto('/create');
  await page.getByRole('button', { name: '고급 설정', exact: true }).click();

  // 최고 화질 공식 권장 카드 표시 확인
  await expect(page.getByText(/최고 화질 공식 권장값/)).toBeVisible();

  // CFG를 비권장 수치(3.5)로 변경하여 화질 경고 유도
  await page.getByLabel('CFG', { exact: true }).fill('3.5');
  await expect(page.getByText('Flux1.d CFG 1.0 권장')).toBeVisible();

  // 즉시 보정 버튼 클릭
  await page.getByRole('button', { name: '즉시 보정' }).click();
  await expect(page.getByText('Flux1.d CFG 1.0 권장')).toHaveCount(0);
  expect(await page.getByLabel('CFG', { exact: true }).inputValue()).toBe('1');

  // 모달 닫기
  await page.keyboard.press('Escape');
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

  // 태그 필터 관리 모달 열기 및 특정 태그(#editorial) 필터링
  await page.getByRole('button', { name: '태그 필터' }).click();
  const tagDialog = page.getByRole('dialog', { name: '# 태그 필터 관리' });
  await expect(tagDialog).toBeVisible();
  await tagDialog.getByText('#editorial').click();
  await tagDialog.getByRole('button', { name: '필터 적용 및 닫기' }).click();

  // #editorial 태그 필터 적용 결과 확인
  await expect(page.getByRole('heading', { name: 'Krea2 Editorial Style' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Flux Soft Portrait LoRA' })).toHaveCount(0);

  // 상단 활성 태그 칩에서 editorial 태그 필터 해제
  await page.getByRole('button', { name: 'editorial 태그 필터 해제' }).click();
  await expect(page.getByRole('heading', { name: 'Flux Soft Portrait LoRA' })).toBeVisible();

  // 페이징 버튼(이전/다음)이 존재하지 않는지 확인
  await expect(page.getByRole('button', { name: '이전', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '다음', exact: true })).toHaveCount(0);

  // 상세 모달 열기 및 원격 버전 조회
  await page.getByRole('heading', { name: 'Flux Soft Portrait LoRA' }).click();
  const detailDialog = page.getByRole('dialog');
  await expect(detailDialog).toBeVisible();
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
    .getByLabel('CivitAI 주소 또는 ID', { exact: true })
    .fill('https://civitai.com/models/840370?modelVersionId=990500');
  await dlDialog.getByRole('button', { name: 'CivitAI 조회' }).click();
  await expect(dlDialog.getByLabel('다운로드할 버전 선택')).toBeVisible();
  await dlDialog.getByRole('button', { name: '선택 버전 다운로드' }).click();

  await expect(
    page.getByRole('heading', { name: /Flux Soft Portrait v2 \(990500\)/ }),
  ).toBeVisible();
});
test('quick badge management modal, collapsed negative prompt, and tabbed settings with default prompts', async ({
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

  // 3. 단축 배지 목록 맨 앞에 '단축 배지 관리' 배지 버튼이 있고 모달에서 관리 가능한지 확인
  const badgeManageBtn = page.getByRole('button', { name: '단축 배지 관리', exact: true });
  await expect(badgeManageBtn).toBeVisible();
  const firstBadgeInContainer = badgeManageBtn.locator('..').locator('button').first();
  await expect(firstBadgeInContainer).toHaveText(/단축 배지 관리/);

  await badgeManageBtn.click();
  const badgeDialog = page.getByRole('dialog', { name: '단축 배지 관리' });
  await expect(badgeDialog).toBeVisible();

  await badgeDialog.getByLabel('새 단축 배지', { exact: true }).fill('dramatic shadow');
  await badgeDialog.getByRole('button', { name: '추가', exact: true }).click();
  await expect(badgeDialog.getByText('+ dramatic shadow')).toBeVisible();

  await badgeDialog.getByRole('button', { name: 'soft pastel 배지 삭제' }).click();
  await expect(badgeDialog.getByText('+ soft pastel')).toHaveCount(0);

  await badgeDialog.getByRole('button', { name: '완료', exact: true }).click();
  await expect(badgeDialog).toHaveCount(0);

  await expect(page.getByRole('button', { name: 'dramatic shadow' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'soft pastel' })).toHaveCount(0);

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

  // 모델 유형 필터(디퓨전 / UNET) 적용
  await page.getByLabel('모델 유형 필터', { exact: true }).selectOption('diffusion_model');
  await expect(page.getByRole('heading', { name: 'Krea2 Turbo 8-Step Diffusion' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Flux Studio Checkpoint FP8' })).toHaveCount(0);
  await page.getByLabel('모델 유형 필터', { exact: true }).selectOption('all');

  // 태그 필터 모달 열기 및 #krea2 필터링
  await page.getByRole('button', { name: '태그 필터' }).click();
  const tagDialog = page.getByRole('dialog', { name: '# 태그 필터 관리' });
  await expect(tagDialog).toBeVisible();
  await tagDialog.getByText('#krea2').click();
  await tagDialog.getByRole('button', { name: '필터 적용 및 닫기' }).click();
  await expect(page.getByRole('heading', { name: 'Krea2 Turbo 8-Step Diffusion' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Flux Studio Checkpoint FP8' })).toHaveCount(0);

  // 상단 활성 태그 칩에서 krea2 태그 필터 해제
  await page.getByRole('button', { name: 'krea2 태그 필터 해제' }).click();
  await expect(page.getByRole('heading', { name: 'Flux Studio Checkpoint FP8' })).toBeVisible();

  // 상세 모달 열기, 원격 버전 조회 및 생성 화면으로 모델 적용
  await page.getByRole('heading', { name: 'Krea2 Turbo 8-Step Diffusion' }).click();
  const detailDialog = page.getByRole('dialog');
  await expect(detailDialog).toBeVisible();
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
    .getByLabel('CivitAI 주소 또는 ID', { exact: true })
    .fill('https://civitai.com/models/705606?modelVersionId=992100');
  await dlDialog.getByRole('button', { name: 'CivitAI 조회' }).click();
  await expect(dlDialog.getByLabel('다운로드할 버전 선택')).toBeVisible();
  await dlDialog.getByRole('button', { name: '선택 버전 다운로드' }).click();

  await expect(
    page.getByRole('heading', { name: /Flux Studio Checkpoint v3 \(992100\)/ }),
  ).toBeVisible();
});
