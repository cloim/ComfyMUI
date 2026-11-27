import { test, expect, type Page } from '@playwright/test';

test.beforeEach(async ({ request }) => {
  expect((await request.post('/api/state/reset')).ok()).toBe(true);
});

async function connect(page: Page) {
  await page.goto('/settings');
  await page.getByRole('button', { name: '저장하고 연결 확인' }).click();
  await expect(page.getByText('서버에 연결했어요')).toBeVisible();
  await page.goto('/create');
}

test('만들기에서 영상 계열을 고르면 같은 화면이 영상 설정으로 바뀌고 MP4를 만든다', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await connect(page);
  // The video screen is part of 만들기 now.
  await expect(
    page.getByRole('navigation', { name: '모바일 메뉴' }).getByRole('link', { name: '영상' }),
  ).toHaveCount(0);

  await page.getByRole('combobox', { name: '모델 계열' }).selectOption({ label: 'LTX 2.5 (1)' });
  await expect(page.getByRole('combobox', { name: '모델', exact: true })).toHaveValue(
    'UNETLoader:LTX 2.5/REDGraft-ltx25-sulphur2-int8-convrot-ComfyMCP.safetensors',
  );
  await expect(page.getByRole('heading', { name: '영상 설정' })).toBeVisible();
  await expect(page.getByText('아직 생성한 영상이 없어요')).toBeVisible();
  // The portrait image default becomes a portrait HD video.
  await expect(page.getByLabel('너비', { exact: true })).toHaveValue('720');
  await expect(page.getByLabel('높이', { exact: true })).toHaveValue('1280');
  await page.getByRole('combobox', { name: '비율' }).selectOption({ label: 'HD 가로 (16:9)' });
  await page.getByLabel('길이 (초)', { exact: true }).fill('10');
  await expect(page.getByText('241프레임, 약 10.04초')).toBeVisible();
  await expect(page.getByLabel('MP4에 오디오 포함')).toBeChecked();

  await page.getByRole('button', { name: '고급 설정', exact: true }).click();
  await expect(page.getByLabel('Steps', { exact: true })).toHaveValue('8');
  await expect(page.getByRole('combobox', { name: 'Sampler' })).toHaveValue('euler_ancestral');
  await expect(page.getByRole('combobox', { name: 'Scheduler' })).toHaveCount(0);
  await page.getByRole('button', { name: '설정 완료' }).click();

  await page.locator('#positive').fill('waves roll toward the shore');
  const submitted = page.waitForRequest(
    (r) => r.url().endsWith('/prompt') && r.method() === 'POST',
  );
  await page.getByTestId('generate').click();
  const body = (await submitted).postDataJSON();
  expect(body.prompt['18'].class_type).toBe('SaveVideo');
  expect(body.prompt['18'].inputs.filename_prefix).toMatch(/^video\/ComfyMUI_/);
  expect(body.prompt['8'].inputs).toMatchObject({ width: 1280, height: 736, length: 241 });
  expect(body.prompt['22'].inputs).toMatchObject({ width: 1280, height: 720 });
  expect(body.prompt['11'].inputs.sampler_name).toBe('euler_ancestral');
  expect(body.prompt_id).toBeTruthy();

  await expect(page.getByText('생성 완료', { exact: true })).toBeVisible({ timeout: 15000 });
  await expect(page.getByRole('link', { name: 'MP4 저장' })).toHaveAttribute('href', /\.mp4/);
  await expect(page.getByLabel('생성한 영상')).toBeVisible();
  await expect(page.getByRole('button', { name: '업스케일' })).toHaveCount(0);

  // Image families show image results only.
  await page.getByRole('combobox', { name: '모델 계열' }).selectOption('flux');
  await expect(page.getByRole('heading', { name: '이미지 설정' })).toBeVisible();
  await expect(page.getByText('아직 생성한 이미지가 없어요')).toBeVisible();
  await expect(page.getByLabel('너비', { exact: true })).toHaveValue('1024');

  await page.goto('/video');
  await expect(page).toHaveURL(/\/create$/);
  expect(errors).toEqual([]);
});

test('이미지 결과의 영상으로 만들기는 첫 프레임과 영상 계열을 만들기 화면에 설정한다', async ({
  page,
}) => {
  await connect(page);
  await page
    .getByRole('combobox', { name: '모델', exact: true })
    .selectOption({ label: 'Flux1.D/test-model.safetensors' });
  await page.locator('#positive').fill('a quiet harbor at dawn');
  await page.getByTestId('generate').click();
  await expect(page.getByText('생성 완료', { exact: true })).toBeVisible({ timeout: 15000 });
  await page.locator('#positive').fill('a different scene');

  await page.getByRole('link', { name: '영상으로 만들기' }).click();
  await expect(page).toHaveURL(/\/create$/);
  await expect(page.getByRole('combobox', { name: '모델 계열' })).toHaveValue('ltx2');
  await expect(page.getByRole('heading', { name: '영상 설정' })).toBeVisible();
  await expect(page.getByAltText('첫 프레임 이미지')).toBeVisible();
  // The image prompt comes along, even after the prompt was changed.
  await expect(page.locator('#positive')).toHaveValue('a quiet harbor at dawn');
  await expect(page.getByRole('spinbutton', { name: '첫 프레임 강도' })).toHaveValue('1');
  // The 768×1024 image starts a portrait clip.
  await expect(page.getByLabel('너비', { exact: true })).toHaveValue('720');

  const submitted = page.waitForRequest(
    (r) => r.url().endsWith('/prompt') && r.method() === 'POST',
  );
  await page.getByTestId('generate').click();
  const body = (await submitted).postDataJSON();
  expect(body.prompt['19'].inputs.image).toMatch(/^mock-.*\.png \[output\]$/);
  expect(body.prompt['21'].inputs.strength).toBe(1);

  await page.getByRole('button', { name: '첫 프레임 해제' }).click();
  await expect(page.getByAltText('첫 프레임 이미지')).toHaveCount(0);
});

test('영상 생성본은 기록에 표시되고 상세 보기, 필터와 삭제를 이미지와 같이 사용한다', async ({
  page,
}) => {
  await connect(page);
  await page.getByRole('combobox', { name: '모델 계열' }).selectOption({ label: 'LTX 2.5 (1)' });
  await page.locator('#positive').fill('lanterns drift over a lake');
  await page.getByTestId('generate').click();
  await expect(page.getByText('생성 완료', { exact: true })).toBeVisible({ timeout: 15000 });

  await page
    .getByRole('navigation', { name: '모바일 메뉴' })
    .getByRole('link', { name: '기록', exact: true })
    .click();
  // The output folder is shared by the tests, so the card is found by its prompt.
  const card = page
    .getByRole('article')
    .filter({ has: page.getByLabel('lanterns drift over a lake') });
  await expect(card).toHaveCount(1);
  await expect(card.getByText('영상', { exact: true })).toBeVisible();
  await expect(card.getByRole('button', { name: '대표 이미지로 설정' })).toHaveCount(0);

  await page.getByRole('combobox', { name: '모델 계열 필터' }).selectOption('ltx2');
  await expect(card).toHaveCount(1);
  // Only videos remain under the LTX 2.5 filter.
  await expect(page.getByRole('article').filter({ hasNotText: '영상' })).toHaveCount(0);

  await card.getByRole('button', { name: '완료 영상 상세 보기' }).click();
  const dialog = page.getByRole('dialog', { name: '생성 기록' });
  await expect(dialog.getByLabel('생성한 영상')).toBeVisible();
  await expect(dialog.getByRole('link', { name: 'MP4 저장' })).toHaveAttribute('href', /\.mp4/);
  await expect(dialog.getByText('lanterns drift over a lake')).toBeVisible();
  await dialog.getByRole('button', { name: '기록 삭제' }).click();
  await expect(page.getByRole('dialog', { name: '영상을 삭제할까요?' })).toBeVisible();
  await page.getByRole('button', { name: '파일 삭제' }).click();
  await expect(card).toHaveCount(0);
});

test('기록의 이미지에서 영상으로 만들기를 누르면 그 이미지의 프롬프트를 함께 넘긴다', async ({
  page,
}) => {
  await connect(page);
  await page
    .getByRole('combobox', { name: '모델', exact: true })
    .selectOption({ label: 'Flux1.D/test-model.safetensors' });
  await page.locator('#positive').fill('a lighthouse in morning fog');
  await page.getByTestId('generate').click();
  await expect(page.getByText('생성 완료', { exact: true })).toBeVisible({ timeout: 15000 });
  await page.locator('#positive').fill('an unrelated prompt');

  await page
    .getByRole('navigation', { name: '모바일 메뉴' })
    .getByRole('link', { name: '기록', exact: true })
    .click();
  await page
    .getByRole('article')
    .filter({ has: page.getByAltText('a lighthouse in morning fog') })
    .first()
    .getByRole('button', { name: '완료 이미지 상세 보기' })
    .click();
  await page
    .getByRole('dialog', { name: '생성 기록' })
    .getByRole('link', { name: '영상으로 만들기' })
    .click();
  await expect(page).toHaveURL(/\/create$/);
  await expect(page.getByRole('combobox', { name: '모델 계열' })).toHaveValue('ltx2');
  await expect(page.locator('#positive')).toHaveValue('a lighthouse in morning fog');
  await expect(page.getByAltText('첫 프레임 이미지')).toBeVisible();
});
