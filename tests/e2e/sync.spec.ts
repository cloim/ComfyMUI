import { test, expect, type APIRequestContext, type Page, type Route } from '@playwright/test';

test.beforeEach(async ({ request }) => {
  expect((await request.post('/api/state/reset')).ok()).toBe(true);
});

const blockWrites = (route: Route) =>
  route.request().method() === 'POST' ? route.abort('internetdisconnected') : route.continue();
async function reconnect(page: Page) {
  await page.unroute('**/api/state', blockWrites);
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
}
const serverPrompt = async (request: APIRequestContext) =>
  (await (await request.get('/api/state')).json()).entries['cm-settings']?.value.positive;

test('two devices preserve conflicting settings and recover an archived device draft', async ({
  browser,
  request,
  baseURL,
}) => {
  const a = await browser.newContext({ baseURL });
  const b = await browser.newContext({ baseURL });
  try {
    const first = await a.newPage();
    await first.goto('/create');
    await first.getByLabel('그리고 싶은 장면', { exact: true }).fill('공통 시작 설정');
    await expect
      .poll(
        async () =>
          (await (await request.get('/api/state')).json()).entries['cm-settings']?.value.positive,
      )
      .toBe('공통 시작 설정');
    const second = await b.newPage();
    await second.goto('/create');
    await expect(second.getByLabel('그리고 싶은 장면', { exact: true })).toHaveValue(
      '공통 시작 설정',
    );
    await second.route('**/api/state', blockWrites);
    await second.getByLabel('그리고 싶은 장면', { exact: true }).fill('휴대폰 오프라인 초안');
    await expect
      .poll(() =>
        second.evaluate(() =>
          JSON.parse(localStorage.getItem('cm-unsent-keys') || '[]').includes('cm-settings'),
        ),
      )
      .toBe(true);
    await first.getByLabel('그리고 싶은 장면', { exact: true }).fill('PC에서 바꾼 설정');
    await expect
      .poll(
        async () =>
          (await (await request.get('/api/state')).json()).entries['cm-settings']?.value.positive,
      )
      .toBe('PC에서 바꾼 설정');
    await reconnect(second);
    await second.getByRole('button', { name: '변경 비교', exact: true }).click();
    const dialog = second.getByRole('dialog');
    await expect(dialog.getByText('휴대폰 오프라인 초안', { exact: true })).toBeVisible();
    await expect(dialog.getByText('PC에서 바꾼 설정', { exact: true })).toBeVisible();
    await dialog.getByRole('button', { name: '서버 설정 사용', exact: true }).click();
    await expect(second.getByLabel('그리고 싶은 장면', { exact: true })).toHaveValue(
      'PC에서 바꾼 설정',
    );
    await dialog.getByRole('button', { name: '복원', exact: true }).click();
    await expect
      .poll(
        async () =>
          (await (await request.get('/api/state')).json()).entries['cm-settings']?.value.positive,
      )
      .toBe('휴대폰 오프라인 초안');
    await second.keyboard.press('Escape');
    await second.reload();
    await expect(second.getByLabel('그리고 싶은 장면', { exact: true })).toHaveValue(
      '휴대폰 오프라인 초안',
    );
  } finally {
    await a.close();
    await b.close();
  }
});

test('two devices editing the same setting can keep this device draft', async ({
  browser,
  request,
  baseURL,
}) => {
  const a = await browser.newContext({ baseURL });
  const b = await browser.newContext({ baseURL });
  try {
    const first = await a.newPage();
    await first.goto('/create');
    const firstPrompt = first.getByLabel('그리고 싶은 장면', { exact: true });
    await firstPrompt.fill('같은 설정');
    await expect.poll(() => serverPrompt(request)).toBe('같은 설정');
    const second = await b.newPage();
    await second.goto('/create');
    const secondPrompt = second.getByLabel('그리고 싶은 장면', { exact: true });
    await expect(secondPrompt).toHaveValue('같은 설정');
    await second.route('**/api/state', blockWrites);
    await secondPrompt.fill('휴대폰 버전');
    await expect
      .poll(() =>
        second.evaluate(() =>
          JSON.parse(localStorage.getItem('cm-unsent-keys') || '[]').includes('cm-settings'),
        ),
      )
      .toBe(true);
    await firstPrompt.fill('PC 버전');
    await expect.poll(() => serverPrompt(request)).toBe('PC 버전');
    await reconnect(second);
    await second.getByRole('button', { name: '변경 비교', exact: true }).click();
    await second
      .getByRole('dialog')
      .getByRole('button', { name: '이 기기 초안 사용', exact: true })
      .click();
    await expect.poll(() => serverPrompt(request)).toBe('휴대폰 버전');
    expect(
      await second.evaluate(
        () => JSON.parse(localStorage.getItem('cm-sync-archive') || '[]')[0].server.positive,
      ),
    ).toBe('PC 버전');
  } finally {
    await a.close();
    await b.close();
  }
});
