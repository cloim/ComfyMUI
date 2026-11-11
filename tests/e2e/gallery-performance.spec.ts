import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.route('**/api/state', (route) =>
    route.fulfill({
      json:
        route.request().method() === 'GET'
          ? {
              entries: {
                'cm-connection': {
                  value: { base: '/comfy', preview: false },
                  updatedAt: 1,
                  revision: 1,
                },
              },
            }
          : { updatedAt: {}, entries: {} },
    }),
  );
  await page.route('**/api/gallery', (route) =>
    route.fulfill({
      json: {
        available: true,
        items: Array.from({ length: 5000 }, (_, i) => ({
          filename: `gallery-${i}.png`,
          subfolder: '',
          type: 'output',
          mtime: 1800000000000 - i * 1000,
          size: 100,
          settings: {
            positive: `${i % 10 === 0 ? '찾을 ' : ''}장면 ${String(i).padStart(5, '0')}`,
            seed: i,
            model: 'Flux1.D/test-model.safetensors',
            architecture: 'flux',
            width: 512,
            height: 768,
            ...(i < 3
              ? { experiment: { id: 'experiment-demo', label: `LoRA ${[0.4, 0.7, 1][i]}` } }
              : {}),
          },
        })),
      },
    }),
  );
  await page.route(/\/comfy\/(view|thumb)\?/, (route) =>
    route.fulfill({
      contentType: 'image/svg+xml',
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="512" height="768"><rect width="512" height="768" fill="#d9dfd3"/></svg>',
    }),
  );
});

test('5000 records render only viewport cards and still reach the final image', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/gallery');
  await expect(page.getByText('표시 5000 / 5000개', { exact: true })).toBeVisible();
  const cards = page.locator('[data-ui-audit-card-type="gallery-item"]');
  expect(await cards.count()).toBeLessThan(80);
  const list = page.getByLabel('기록 목록', { exact: true });
  await list.evaluate((el) => {
    el.scrollTop = el.scrollHeight;
  });
  await expect(page.getByRole('img', { name: '장면 04999', exact: true })).toBeVisible();
  expect(await cards.count()).toBeLessThan(80);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('img', { name: '장면 04999', exact: true })).toBeVisible();
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(page.getByRole('img', { name: '장면 04999', exact: true })).toBeVisible();
});

test('search, scroll and experiment filters survive returning from another screen', async ({
  page,
}) => {
  await page.goto('/gallery');
  await page.getByLabel('기록 검색', { exact: true }).fill('찾을');
  await expect(page.getByText('표시 500 / 5000개', { exact: true })).toBeVisible();
  const list = page.getByLabel('기록 목록', { exact: true });
  await list.evaluate((el) => {
    el.scrollTop = 2000;
  });
  await expect.poll(() => list.evaluate((el) => el.scrollTop)).toBe(2000);
  await page
    .getByRole('navigation', { name: '모바일 메뉴' })
    .getByRole('link', { name: '만들기', exact: true })
    .click();
  await page
    .getByRole('navigation', { name: '모바일 메뉴' })
    .getByRole('link', { name: '기록', exact: true })
    .click();
  await expect(page.getByLabel('기록 검색', { exact: true })).toHaveValue('찾을');
  await expect
    .poll(() => page.getByLabel('기록 목록', { exact: true }).evaluate((el) => el.scrollTop))
    .toBe(2000);
  await page.getByLabel('기록 검색', { exact: true }).fill('');
  await page.getByLabel('실험 묶음 필터', { exact: true }).selectOption('experiment-demo');
  await expect(page.getByText('표시 3 / 5000개', { exact: true })).toBeVisible();
  await expect(
    page.getByRole('button', { name: '실험 묶음 보기: LoRA 0.7', exact: true }),
  ).toBeVisible();
  await page.getByRole('checkbox', { name: '이미지 선택' }).first().click();
  await page.getByRole('button', { name: '전체 선택', exact: true }).click();
  await expect(page.getByText('3개 선택', { exact: true })).toBeVisible();
  await page.setViewportSize({ width: 325, height: 667 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
