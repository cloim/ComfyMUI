import { expect, test, type Page } from '@playwright/test';

// scenario.spec.ts starts from an empty scenario list, so nothing is left behind.
test.beforeEach(async ({ request }) => {
  expect((await request.post('/api/state/reset')).ok()).toBe(true);
});
// Closing the pages first lets their last pending writes land before the reset.
test.afterEach(async ({ page, request }) => {
  await page.context().close();
  expect((await request.post('/api/state/reset')).ok()).toBe(true);
});

const png = (name: string) => ({
  name,
  mimeType: 'image/png',
  buffer: Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACklEQVR4nGNgAAAAAgABSK+kcQAAAABJRU5ErkJggg==',
    'base64',
  ),
});

async function connect(page: Page) {
  await page.goto('/settings');
  await page.getByRole('button', { name: '저장하고 연결 확인' }).click();
  await expect(page.getByText('서버에 연결했어요')).toBeVisible();
}

const nextPrompt = (page: Page) =>
  page.waitForRequest(
    (request) => request.url().endsWith('/comfy/prompt') && request.method() === 'POST',
  );

test('캐릭터의 얼굴·전신 정면 이미지를 올리거나 묘사로 생성한다', async ({ page }) => {
  await connect(page);
  await page.goto('/scenario');
  await page.getByRole('button', { name: '시나리오 만들기', exact: true }).click();
  await page.getByRole('button', { name: '캐릭터 추가' }).click();
  await page.getByLabel('캐릭터 1 이름').fill('omz');
  const list = page.getByRole('list', { name: '캐릭터 목록' });
  await expect(list).toContainText('정면 이미지 필요');

  // Generating needs a LoRA or a description to work from.
  await expect(page.getByRole('button', { name: '얼굴 정면 묘사로 생성' })).toBeDisabled();
  await page.getByLabel('캐릭터 묘사').fill('짧은 검은 머리, 노란 우비');
  const shot = nextPrompt(page);
  await page.getByRole('button', { name: '얼굴 정면 묘사로 생성' }).click();
  const graph = (await shot).postDataJSON().prompt;
  expect(graph['4'].inputs).toMatchObject({ width: 1024, height: 1024, batch_size: 1 });
  expect(graph['7'].inputs.filename_prefix).toMatch(/^scenario\//);
  // The finished image fills the face slot by itself.
  await expect(page.getByRole('button', { name: '얼굴 정면 크게 보기' })).toBeVisible({
    timeout: 15000,
  });

  await page.getByLabel('전신 정면 업로드').setInputFiles(png('body.png'));
  await expect(page.getByRole('button', { name: '전신 정면 크게 보기' })).toBeVisible();
  await expect(list).toContainText('이어 만들기 가능');

  await page.getByLabel('추가 이미지 업로드').setInputFiles(png('side.png'));
  await expect(page.getByRole('button', { name: '추가 이미지 1 크게 보기' })).toBeVisible();
  await page.getByRole('button', { name: '전신 정면 삭제' }).click();
  await expect(list).toContainText('정면 이미지 필요');
  await page.getByLabel('전신 정면 업로드').setInputFiles(png('body.png'));
  await expect(list).toContainText('이어 만들기 가능');
});

test('이어 만들기 씬은 캐릭터 정면 이미지와 고른 추가 이미지를 함께 보낸다', async ({ page }) => {
  await connect(page);
  await page.goto('/scenario');
  await page.getByRole('button', { name: '시나리오 만들기', exact: true }).click();
  await page.getByRole('button', { name: '캐릭터 추가' }).click();
  await page.getByLabel('캐릭터 1 이름').fill('omz');
  await page.getByLabel('얼굴 정면 업로드').setInputFiles(png('face.png'));
  await expect(page.getByRole('button', { name: '얼굴 정면 크게 보기' })).toBeVisible();

  await page.getByRole('tab', { name: /씬 편집/ }).click();
  await page.getByRole('button', { name: '씬 추가', exact: true }).click();
  await page.getByRole('button', { name: '이미지로 이어 만들기' }).click();
  await page.getByLabel('참조 이미지 업로드').setInputFiles(png('scene.png'));
  await expect(page.getByRole('button', { name: '참조 이미지 크게 보기' })).toBeVisible();
  await page.getByLabel('장면 묘사').fill('omz가 우산을 접는다');
  await expect(page.getByText('omz의 전신 정면 이미지가 필요해요.')).toBeVisible();

  // The warning leads to the character, where the missing images are added.
  await page.getByRole('button', { name: '캐릭터 설정 열기' }).click();
  await expect(page.getByRole('tab', { name: '공통 설정' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await page.getByLabel('전신 정면 업로드').setInputFiles(png('body.png'));
  await expect(page.getByRole('button', { name: '전신 정면 크게 보기' })).toBeVisible();
  await page.getByLabel('추가 이미지 업로드').setInputFiles(png('side.png'));
  await expect(page.getByRole('button', { name: '추가 이미지 1 크게 보기' })).toBeVisible();

  await page.getByRole('tab', { name: /씬 편집/ }).click();
  const refs = page.getByRole('list', { name: '함께 보내는 캐릭터 이미지' });
  await expect(refs.getByRole('listitem')).toHaveCount(2);
  await page.getByRole('button', { name: 'omz 추가 1 참조에 추가' }).click();
  await expect(refs.getByRole('listitem')).toHaveCount(3);
  await expect(refs).toContainText('<image4>');
  await expect(page.getByLabel('이 씬의 편집 모델')).toContainText('공통 설정 기본값');

  await page.getByLabel('생성 프롬프트').fill('Make <image1> rainy.');
  const submitted = nextPrompt(page);
  await page.getByRole('button', { name: '이 씬 생성', exact: true }).click();
  const graph = (await submitted).postDataJSON().prompt;
  expect(graph['2'].inputs.prompt).toBe(
    'Make <image1> rainy. omz looks like the person in <image2> (face), <image3> (full body), <image4> (extra).',
  );
  for (const [i, node] of [
    [2, '61'],
    [3, '63'],
    [4, '65'],
  ] as const)
    expect(graph['2'].inputs[`images.image_${i}`]).toEqual([node, 0]);
  expect(graph['60'].inputs.image).not.toBe(graph['50'].inputs.image);
});
