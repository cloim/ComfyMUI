import { expect, test } from '@playwright/test';

test.beforeEach(async ({ request }) => {
  expect((await request.post('/api/state/reset')).ok()).toBe(true);
});

test('모델 메뉴는 Checkpoints와 LoRA 탭으로 나뉘고 기존 LoRA 주소를 옮긴다', async ({ page }) => {
  await page.goto('/settings');
  await page.getByRole('button', { name: '저장하고 연결 확인' }).click();
  await expect(page.getByText('서버에 연결했어요')).toBeVisible();

  const mobileNav = page.getByRole('navigation', { name: '모바일 메뉴' });
  await expect(mobileNav.getByRole('link', { name: 'LoRA', exact: true })).toHaveCount(0);
  await mobileNav.getByRole('link', { name: '모델', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('모델');
  const checkpoints = page.getByRole('tab', { name: 'Checkpoints' });
  const lora = page.getByRole('tab', { name: 'LoRA' });
  await expect(checkpoints).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('heading', { name: 'Flux Studio Checkpoint FP8' })).toBeVisible();

  await lora.click();
  await expect(page).toHaveURL(/\/models\?tab=lora$/);
  await expect(lora).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('heading', { name: 'Flux Soft Portrait LoRA' })).toBeVisible();
  await expect(page.getByRole('searchbox', { name: 'LoRA 검색' })).toBeVisible();

  await lora.press('ArrowLeft');
  await expect(checkpoints).toBeFocused();
  await expect(page).toHaveURL(/\/models$/);

  await page.goto('/loras');
  await expect(page).toHaveURL(/\/models\?tab=lora$/);
  await expect(page.getByRole('tab', { name: 'LoRA' })).toHaveAttribute('aria-selected', 'true');
});

test('설정의 AI 연결로 모델을 불러오고 저장하며 키는 다시 표시하지 않는다', async ({ page }) => {
  await page.goto('/settings?tab=ai');
  const tab = page.getByRole('tab', { name: 'AI 연결' });
  await expect(tab).toHaveAttribute('aria-selected', 'true');
  // The e2e server provides the connection through SCENARIO_AI_* until one is saved.
  await expect(page.getByText('서버 환경변수 사용 중')).toBeVisible();
  const address = page.getByRole('textbox', { name: 'AI API 주소' });
  await expect(address).toHaveValue('http://127.0.0.1:8799/v1');

  const key = page.getByLabel('AI API 키');
  await key.fill('wrong-key');
  await page.getByRole('button', { name: '연결 확인 및 모델 불러오기' }).click();
  await expect(page.getByText('API 키를 확인해 주세요')).toBeVisible();

  await key.fill('e2e-key');
  await page.getByRole('button', { name: '연결 확인 및 모델 불러오기' }).click();
  await expect(page.getByText('서버에 연결했어요 · 모델 2개')).toBeVisible();
  await page.getByRole('button', { name: 'scenario-test-model', exact: true }).click();
  await expect(page.getByLabel('AI 텍스트 모델')).toHaveValue('scenario-test-model');
  await page.getByRole('button', { name: '저장', exact: true }).click();
  await expect(page.getByText('AI 연결 설정을 저장했어요')).toBeVisible();
  await expect(page.getByText('설정됨', { exact: true })).toBeVisible();
  await expect(key).toHaveValue('');
  await expect(key).toHaveAttribute('placeholder', /저장된 키 사용 중/);

  const state = await page.request.get('/api/settings/ai');
  const body = await state.json();
  expect(body).toMatchObject({ model: 'scenario-test-model', hasKey: true, source: 'saved' });
  expect(JSON.stringify(body)).not.toContain('e2e-key');

  // The stored key is reused for the saved address without typing it again.
  await page.reload();
  await page.getByRole('button', { name: '연결 확인 및 모델 불러오기' }).click();
  await expect(page.getByText('서버에 연결했어요 · 모델 2개')).toBeVisible();
});
