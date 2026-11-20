import { expect, test, type CDPSession, type Page } from '@playwright/test';

// scenario.spec.ts starts from an empty scenario list, so nothing is left behind.
test.beforeEach(async ({ request }) => {
  expect((await request.post('/api/state/reset')).ok()).toBe(true);
});
// Closing the pages first lets their last pending writes land before the reset.
test.afterEach(async ({ page, request }) => {
  await page.context().close();
  expect((await request.post('/api/state/reset')).ok()).toBe(true);
});

// Types each syllable the way a Korean IME does: a composition, then the committed text.
async function typeWithIme(page: Page, cdp: CDPSession, text: string) {
  for (const ch of text) {
    if (ch !== ' ') {
      await cdp.send('Input.imeSetComposition', { text: ch, selectionStart: 1, selectionEnd: 1 });
      await page.waitForTimeout(40);
    }
    await cdp.send('Input.insertText', { text: ch });
    await page.waitForTimeout(40);
  }
}

test('시나리오 입력란은 한글 IME 입력을 중복 없이 받는다', async ({ page }) => {
  const cdp = await page.context().newCDPSession(page);
  await page.goto('/scenario');
  await page.getByRole('button', { name: '시나리오 만들기', exact: true }).click();

  await page.getByLabel('화풍', { exact: true }).selectOption({ label: '직접 입력' });
  const style = page.getByPlaceholder('예: 빛바랜 필름 색감과 낮은 채도');
  await style.click();
  await typeWithIme(page, cdp, '빛바랜 필름');
  await expect(style).toHaveValue('빛바랜 필름');

  await page.getByRole('button', { name: '캐릭터 추가' }).click();
  await page.getByLabel('캐릭터 1 이름').click();
  await typeWithIme(page, cdp, '지수');
  await expect(page.getByLabel('캐릭터 1 이름')).toHaveValue('지수');
  const character = page.getByLabel('캐릭터 묘사');
  await character.click();
  await typeWithIme(page, cdp, '검은 머리');
  await expect(character).toHaveValue('검은 머리');

  await page.getByRole('tab', { name: /씬 편집/ }).click();
  await page.getByRole('button', { name: '씬 추가', exact: true }).click();
  const description = page.getByLabel('장면 묘사');
  await description.click();
  await typeWithIme(page, cdp, '비 오는 골목');
  await expect(description).toHaveValue('비 오는 골목');

  // The value reached the shared store and survives a reload.
  await page.waitForTimeout(500);
  await page.reload();
  await page.getByRole('tab', { name: '공통 설정' }).click();
  await expect(page.getByPlaceholder('예: 빛바랜 필름 색감과 낮은 채도')).toHaveValue(
    '빛바랜 필름',
  );
});
