import { expect, test, type CDPSession, type Page } from '@playwright/test';

test.beforeEach(async ({ request }) => {
  expect((await request.post('/api/state/reset')).ok()).toBe(true);
});

// Simulates realistic Korean IME jamo-by-jamo composition updates before committing each syllable.
async function typeKoreanSyllables(page: Page, cdp: CDPSession, syllables: string[][]) {
  for (const steps of syllables) {
    for (const composing of steps) {
      await cdp.send('Input.imeSetComposition', {
        text: composing,
        selectionStart: composing.length,
        selectionEnd: composing.length,
      });
      await page.waitForTimeout(25);
    }
    const committed = steps[steps.length - 1];
    await cdp.send('Input.insertText', { text: committed });
    await page.waitForTimeout(25);
  }
}

test('번역 보관함이 열린 상태에서도 프롬프트 한글 IME 조합이 분리되지 않는다', async ({ page }) => {
  const cdp = await page.context().newCDPSession(page);
  await page.goto('/create');

  // Seed a translation pair matching the current prompt so '영문 번역' is shown below the textarea.
  await page.evaluate(() => {
    const settings = JSON.parse(localStorage.getItem('cm-settings') || '{}');
    const current = settings.positive || '';
    localStorage.setItem(
      'cm-prompt-translation',
      JSON.stringify({
        current,
        other: 'a quiet forest',
        showing: 'original',
      }),
    );
  });
  await page.reload();

  await expect(page.getByText('영문 번역', { exact: true })).toBeVisible();
  const prompt = page.locator('#positive');
  await prompt.click();
  await prompt.fill('');

  // Type '한글' via jamo-level IME composition steps.
  await typeKoreanSyllables(page, cdp, [
    ['ㅎ', '하', '한'],
    ['ㄱ', '그', '글'],
  ]);

  await expect(prompt).toHaveValue('한글');
  await expect(page.getByText('영문 번역', { exact: true })).toBeVisible();

  // Swapping to translation and back preserves the edited Korean text.
  await page.getByRole('button', { name: '번역문으로 전환', exact: true }).click();
  await expect(prompt).toHaveValue('a quiet forest');
  await expect(page.getByText('한국어 원문', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '원문으로 전환', exact: true }).click();
  await expect(prompt).toHaveValue('한글');
});

test('프롬프트 입력란의 조정된 높이가 새로고침 후에도 유지된다', async ({ page }) => {
  await page.goto('/create');
  const positive = page.locator('#positive');
  await expect(positive).toBeVisible();

  // Simulate user dragging the native vertical resize handle on positive prompt.
  await positive.evaluate((el: HTMLTextAreaElement) => {
    el.style.height = '240px';
  });
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem('cm-prompt-height')))
    .toBe('240');

  // Open negative prompt and resize it too.
  await page.getByRole('button', { name: '네거티브 프롬프트' }).click();
  const negative = page.locator('#negative');
  await expect(negative).toBeVisible();
  await negative.evaluate((el: HTMLTextAreaElement) => {
    el.style.height = '150px';
  });
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem('cm-negative-prompt-height')))
    .toBe('150');

  // Reload and verify both heights are restored.
  await page.reload();
  await expect(positive).toHaveCSS('height', '240px');
  await page.getByRole('button', { name: '네거티브 프롬프트' }).click();
  await expect(page.locator('#negative')).toHaveCSS('height', '150px');
});
