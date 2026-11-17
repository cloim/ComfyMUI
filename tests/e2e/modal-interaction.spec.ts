import { test, expect, type Page } from '@playwright/test';

test.beforeEach(async ({ request }) => {
  expect((await request.post('/api/state/reset')).ok()).toBe(true);
});

async function connect(page: Page) {
  await page.goto('/settings');
  await page.getByRole('button', { name: '저장하고 연결 확인' }).click();
  await expect(page.getByText('서버에 연결했어요')).toBeVisible();
}

test('Balance modal Enter and Esc interaction in real app', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await connect(page);

  // 1. Create page: Test "고급 설정" modal with Escape
  await page.goto('/create');
  await page.getByRole('button', { name: '고급 설정', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);

  // 2. Preset Save modal: Enter triggers save
  await page.getByRole('button', { name: '현재 설정을 프리셋으로 저장' }).click();
  const presetModal = page.getByRole('dialog');
  await expect(presetModal).toBeVisible();

  // Pressing Escape should close preset modal without saving
  await page.keyboard.press('Escape');
  await expect(presetModal).toHaveCount(0);

  // Re-open and type name, then press Enter
  await page.getByRole('button', { name: '현재 설정을 프리셋으로 저장' }).click();
  await expect(presetModal).toBeVisible();
  const nameInput = page.getByLabel('프리셋 이름', { exact: true });
  await nameInput.fill('엔터키 테스트 프리셋');
  await nameInput.press('Enter');

  // Modal should be closed automatically by Enter on positive button
  await expect(presetModal).toHaveCount(0);

  // Verify preset exists in Presets page
  await page.goto('/presets');
  await expect(page.getByRole('heading', { name: '엔터키 테스트 프리셋' })).toBeVisible();

  // 3. Preset Delete modal: Escape cancels, Enter confirms deletion
  await page.getByRole('button', { name: '엔터키 테스트 프리셋 삭제' }).click();
  const deleteModal = page.getByRole('dialog');
  await expect(deleteModal).toBeVisible();

  // Escape cancels deletion
  await page.keyboard.press('Escape');
  await expect(deleteModal).toHaveCount(0);
  await expect(page.getByRole('heading', { name: '엔터키 테스트 프리셋' })).toBeVisible();

  // Re-open delete modal and press Enter to confirm deletion
  await page.getByRole('button', { name: '엔터키 테스트 프리셋 삭제' }).click();
  await expect(deleteModal).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(deleteModal).toHaveCount(0);
  await expect(page.getByRole('heading', { name: '엔터키 테스트 프리셋' })).toHaveCount(0);

  // 4. Settings page: Textarea standalone Enter keeps newline, Ctrl+Enter submits
  await page.goto('/settings');
  await page.getByRole('tab', { name: '기본 프롬프트 설정' }).click();

  // Click the first element in the assemble list to enter detail view
  const firstElementButton = page.locator('button:has-text("속성 관리")').first();
  if (await firstElementButton.isVisible()) {
    await firstElementButton.click();
  }

  // Open "속성 일괄 편집" modal
  const bulkEditButton = page.getByRole('button', { name: '속성 일괄 편집' });
  if (await bulkEditButton.isVisible()) {
    await bulkEditButton.click();
    const bulkModal = page.getByRole('dialog');
    await expect(bulkModal).toBeVisible();

    const textarea = bulkModal.locator('textarea');
    await textarea.focus();
    await textarea.fill('line1');
    await textarea.press('Enter');
    await textarea.pressSequentially('line2');

    // Modal must still be open and textarea must contain newline
    await expect(bulkModal).toBeVisible();
    const textVal = await textarea.inputValue();
    expect(textVal).toContain('\n');

    // Ctrl+Enter should confirm and close the modal
    await textarea.press('Control+Enter');
    await expect(bulkModal).toHaveCount(0);
  }

  expect(errors).toEqual([]);
});
