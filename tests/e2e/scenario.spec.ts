import { expect, test } from '@playwright/test';

test('mobile storyboard preserves manual prompts and pins Qwen references', async ({ page }) => {
  await page.setViewportSize({ width: 325, height: 667 });
  await page.goto('/create');
  await page
    .getByRole('navigation', { name: '모바일 메뉴' })
    .getByRole('link', { name: '시나리오' })
    .click();
  await page.getByRole('button', { name: '시나리오 만들기', exact: true }).click();
  await page.getByLabel('시나리오 이름').fill('비 오는 날');
  const model = page.getByLabel('기본 모델', { exact: true });
  await expect(model.locator('optgroup')).toHaveCount(4);
  await model.selectOption({ label: 'Flux1.D/test-model.safetensors' });
  await page.getByLabel('화면 비율').selectOption('1024x576');
  await page.getByRole('button', { name: '캐릭터 추가' }).click();
  await page.getByLabel('캐릭터 1 이름').fill('지수');
  await page.getByLabel('캐릭터 LoRA', { exact: true }).selectOption('Flux1.D/soft.safetensors');
  await page.getByLabel('트리거 단어').fill('jisu_character');
  // A new scenario opens on its common settings; scene work lives in its own tab.
  await expect(page.getByRole('tab', { name: '공통 설정' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(page.getByRole('button', { name: '씬 추가', exact: true })).toHaveCount(0);
  await page.getByRole('tab', { name: /씬 편집/ }).click();
  await page.getByRole('button', { name: '씬 추가', exact: true }).click();
  await page.getByLabel('씬 이름').fill('골목');
  await page.getByRole('button', { name: '지수', exact: true }).click();
  await page.getByLabel('장면 묘사').fill('비 오는 골목에서 우산을 접는다');
  const prompt = page.getByLabel('생성 프롬프트', { exact: true });
  await page.getByRole('button', { name: 'AI로 만들기' }).click();
  await expect(prompt).toHaveValue('Scene: 비 오는 골목에서 우산을 접는다');
  await prompt.fill('A handmade prompt for the alley');
  await page.getByLabel('장면 묘사').fill('골목 조명이 켜진다');
  await expect(page.getByText(/묘사 또는 공통 설정이 바뀌었어요/)).toBeVisible();
  await page.getByRole('button', { name: 'AI로 다시 작성' }).click();
  await expect(page.getByText('Scene: 골목 조명이 켜진다', { exact: true })).toBeVisible();
  await expect(prompt).toHaveValue('A handmade prompt for the alley');
  await page.getByRole('button', { name: '이 프롬프트 적용' }).click();
  await expect(prompt).toHaveValue('Scene: 골목 조명이 켜진다');

  const watchPrompt = () =>
    page.waitForRequest(
      (request) => request.url().endsWith('/comfy/prompt') && request.method() === 'POST',
    );
  await page.getByLabel('후보 장 수').selectOption('2');
  const first = watchPrompt();
  await page.getByRole('button', { name: '이 씬 생성', exact: true }).click();
  const graph = (await first).postDataJSON().prompt;
  expect(graph['1'].inputs.ckpt_name).toBe('Flux1.D/test-model.safetensors');
  expect(graph['2'].inputs.text).toBe('jisu_character, Scene: 골목 조명이 켜진다');
  expect(graph['4'].inputs).toMatchObject({ width: 1024, height: 576, batch_size: 2 });
  expect(graph['7'].inputs.filename_prefix).toMatch(/^scenario\/ComfyMUI_/);
  expect(graph['100'].inputs.lora_name).toBe('Flux1.D/soft.safetensors');
  await page.getByRole('button', { name: '후보 1 대표 컷으로 선택' }).click();

  await page.getByRole('button', { name: '씬 추가', exact: true }).click();
  await page.getByLabel('씬 이름').fill('카페');
  await page.getByRole('button', { name: '이미지로 이어 만들기' }).click();
  await page.getByLabel('참조 이미지', { exact: true }).selectOption({ label: '씬 1 | 골목' });
  await page.getByLabel('장면 묘사').fill('같은 인물이 카페 창가에 앉는다');

  const list = page.getByRole('list', { name: '씬 순서' });
  await list.getByRole('button', { name: /골목/ }).click();
  await page.getByRole('button', { name: '후보 2 대표 컷으로 선택' }).click();
  await list.getByRole('button', { name: /카페/ }).click();
  await expect(page.getByText('이전 컷 참조 중')).toBeVisible();
  const second = watchPrompt();
  await page.getByRole('button', { name: '이 씬 생성', exact: true }).click();
  const edit = (await second).postDataJSON().prompt;
  expect(edit['1'].inputs.unet_name).toBe('qwen_image_2.1.safetensors');
  expect(edit['2'].inputs.prompt).toBe('Edit <image1>: 같은 인물이 카페 창가에 앉는다');
  expect(edit['2'].inputs['images.image_1']).toEqual(['51', 0]);
  expect(edit['5'].inputs.latent_image).toEqual(['2', 2]);
  expect(edit['50'].inputs.image).toMatch(/^mock-.*-0\.png \[output\]$/);
  await page.getByRole('button', { name: '후보 1 대표 컷으로 선택' }).click();

  const boardTab = page.getByRole('tab', { name: /스토리보드/ });
  await boardTab.press('ArrowLeft');
  await expect(page.getByRole('tab', { name: /씬 편집/ })).toBeFocused();
  await boardTab.click();
  await expect(page.getByLabel('씬 이름')).toHaveCount(0);
  const board = page.getByRole('list', { name: '스토리보드' });
  await expect(board.locator('img')).toHaveCount(2);
  await expect(boardTab).toContainText('2/2');
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(325);
  // The storyboard is saved to the server so other devices can continue it.
  await expect
    .poll(async () => {
      const { entries } = await (await page.request.get('/api/state')).json();
      const saved = entries['cm-scenarios']?.value?.find(
        (item: { title: string }) => item.title === '비 오는 날',
      );
      return saved?.scenes.filter((scene: { featuredId: string | null }) => scene.featuredId)
        .length;
    })
    .toBe(2);
  await page.reload();
  await expect(page.getByLabel('시나리오 이름')).toHaveValue('비 오는 날');
  await page.getByRole('list', { name: '씬 순서' }).getByRole('button', { name: /카페/ }).click();
  await expect(page.getByText('이전 컷 참조 중')).toBeVisible();
  await expect(page.getByRole('button', { name: '후보 1 대표 컷으로 선택' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );

  await page.getByRole('button', { name: '씬 추가', exact: true }).click();
  await page.getByLabel('씬 이름').fill('올린 사진으로 이어 만들기');
  await page.getByRole('button', { name: '씬을 위로 이동' }).click();
  await expect(
    page.getByRole('list', { name: '씬 순서' }).getByRole('button').nth(1),
  ).toContainText('올린 사진으로 이어 만들기');
  await page.getByRole('button', { name: '이미지로 이어 만들기' }).click();
  await page.getByLabel('참조 이미지 업로드').setInputFiles({
    name: 'reference.png',
    mimeType: 'image/png',
    buffer: Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACklEQVR4nGNgAAAAAgABSK+kcQAAAABJRU5ErkJggg==',
      'base64',
    ),
  });
  await expect(page.getByRole('button', { name: '참조 이미지 크게 보기' })).toBeVisible();
  await page.getByLabel('생성 프롬프트').fill('Change the lighting.');
  await page.getByLabel('후보 장 수').selectOption('2');
  const third = watchPrompt();
  await page.getByRole('button', { name: '이 씬 생성', exact: true }).click();
  const uploaded = (await third).postDataJSON().prompt;
  expect(uploaded['50'].inputs.image).toMatch(/^scenario\/.*\.png \[input\]$/);
  expect(uploaded['52'].inputs).toEqual({ samples: ['2', 2], amount: 2 });
});

test('bulk generation converts blank prompts and filters revised scenes', async ({ page }) => {
  await page.goto('/scenario');
  // Scenarios are shared through the server, so earlier tests may have left one.
  await page.getByRole('button', { name: '새 시나리오 만들기' }).click();
  const model = page.getByLabel('기본 모델', { exact: true });
  await model.selectOption({ label: 'Flux1.D/test-model.safetensors' });
  await page.getByRole('tab', { name: /씬 편집/ }).click();
  const add = page.getByRole('button', { name: '씬 추가', exact: true });
  await add.click();
  await page.getByLabel('씬 이름').fill('첫 장면');
  await page.getByLabel('생성 프롬프트').fill('Keep my prompt');
  await page.getByLabel('후보 장 수').selectOption('3');
  await add.click();
  await page.getByLabel('씬 이름').fill('두 번째 장면');
  await page.getByLabel('장면 묘사').fill('역에 도착한다');

  const graphs: { [key: string]: { inputs: Record<string, unknown> } }[] = [];
  page.on('request', (request) => {
    if (request.url().endsWith('/comfy/prompt') && request.method() === 'POST') {
      graphs.push(request.postDataJSON().prompt);
    }
  });
  await page.getByRole('button', { name: '2개 씬 생성' }).click();
  await expect.poll(() => graphs.length).toBe(2);
  expect(graphs.map((graph) => graph['2'].inputs.text)).toEqual([
    'Keep my prompt',
    'Scene: 역에 도착한다',
  ]);
  expect(graphs.map((graph) => graph['4'].inputs.batch_size)).toEqual([1, 1]);
  await expect(page.getByRole('button', { name: '후보 1 대표 컷으로 선택' })).toBeVisible();
  await page.getByLabel('일괄 생성 범위').selectOption('missing');
  await expect(page.getByRole('button', { name: '0개 씬 생성' })).toBeDisabled();
  await page.getByLabel('장면 묘사').fill('역 광장으로 나온다');
  await page.getByLabel('일괄 생성 범위').selectOption('changed');
  await page.getByRole('button', { name: '1개 씬 생성' }).click();
  await expect.poll(() => graphs.length).toBe(3);
  // The AI prompt no longer matched the description, so the bulk run rewrote it.
  expect(graphs[2]['2'].inputs.text).toBe('Scene: 역 광장으로 나온다');
  await expect(page.getByLabel('생성 프롬프트')).toHaveValue('Scene: 역 광장으로 나온다');

  // A manual prompt is never rewritten: the bulk run asks the user to keep or edit it.
  const list = page.getByRole('list', { name: '씬 순서' });
  await page.getByLabel('일괄 생성 범위').selectOption('all');
  await expect(page.getByRole('button', { name: '2개 씬 생성' })).toBeEnabled();
  await list.getByRole('button', { name: /첫 장면/ }).click();
  await page.getByLabel('장면 묘사').fill('플랫폼에 선다');
  await page.getByRole('button', { name: '2개 씬 생성' }).click();
  await expect.poll(() => graphs.length).toBe(4);
  expect(graphs[3]['2'].inputs.text).toBe('Scene: 역 광장으로 나온다');
  const error = page.getByRole('alert');
  await expect(error).toContainText('직접 입력한 프롬프트를 유지하거나 고친 뒤 생성해 주세요');
  await page.getByRole('button', { name: '이 프롬프트 유지' }).click();
  await expect(error).toHaveCount(0);
  await expect(page.getByLabel('생성 프롬프트')).toHaveValue('Keep my prompt');
  await page.getByRole('button', { name: '이 씬 다시 생성' }).click();
  await expect.poll(() => graphs.length).toBe(5);
  expect(graphs[4]['2'].inputs.text).toBe('Keep my prompt');
});

test('character LoRAs must match the base model family', async ({ page }) => {
  await page.goto('/scenario');
  // Scenarios are shared through the server, so earlier tests may have left one.
  await page.getByRole('button', { name: '새 시나리오 만들기' }).click();
  const model = page.getByLabel('기본 모델', { exact: true });
  await model.selectOption({ label: 'Flux1.D/test-model.safetensors' });
  await page.getByRole('button', { name: '캐릭터 추가' }).click();
  await page.getByLabel('캐릭터 1 이름').fill('지수');
  await page.getByLabel('캐릭터 LoRA', { exact: true }).selectOption('Flux1.D/soft.safetensors');
  const families = await model.locator('optgroup').evaluateAll((groups) =>
    groups.map((group) => ({
      label: group.getAttribute('label'),
      first: group.querySelector('option')?.textContent,
    })),
  );
  const other = families.find((group) => group.label !== 'Flux1.D' && group.label !== 'Qwen2.1');
  await model.selectOption({ label: other!.first! });
  await expect(page.getByLabel('캐릭터 LoRA', { exact: true })).toContainText('현재 계열과 다름');
  await page.getByRole('tab', { name: /씬 편집/ }).click();
  await page.getByRole('button', { name: '씬 추가', exact: true }).click();
  await page.getByRole('button', { name: '지수', exact: true }).click();
  await page.getByLabel('생성 프롬프트').fill('A quiet street');
  let submitted = false;
  page.on('request', (request) => {
    if (request.url().endsWith('/comfy/prompt') && request.method() === 'POST') submitted = true;
  });
  await page.getByRole('button', { name: '이 씬 생성', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('지수의 LoRA가 기본 모델 계열과 맞지 않아요');
  expect(submitted).toBe(false);
});
