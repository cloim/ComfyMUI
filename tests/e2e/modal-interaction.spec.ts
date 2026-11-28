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

  // 2. Settings page: Textarea standalone Enter keeps newline, Ctrl+Enter submits
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
