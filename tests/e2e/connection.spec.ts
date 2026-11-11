import { test, expect } from '@playwright/test';

test.beforeEach(async ({ request }) => {
  expect((await request.post('/api/state/reset')).ok()).toBe(true);
});

test('cold and cached connections are usable within one second; resume keeps the socket', async ({
  page,
}) => {
  let sockets = 0;
  page.on('websocket', () => sockets++);
  await page.goto('/settings');
  const started = Date.now();
  await page.getByRole('button', { name: '저장하고 연결 확인' }).click();
  await expect(page.getByText('서버에 연결했어요')).toBeVisible({ timeout: 1000 });
  expect(Date.now() - started).toBeLessThan(1000);
  await expect.poll(() => sockets).toBe(1);
  // The IDB schema has been persisted before delaying subsequent refreshes.
  await page.waitForFunction(
    () =>
      new Promise((resolve) => {
        const open = indexedDB.open('comfymui-db');
        open.onsuccess = () => {
          const db = open.result;
          const get = db.transaction('keyval').objectStore('keyval').get('cm-info-cache:/comfy');
          get.onsuccess = () => {
            resolve(!!get.result);
            db.close();
          };
        };
      }),
  );
  await page.route('**/comfy/object_info*', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 2500));
    await route.continue();
  });
  const resumed = Date.now();
  const checked = page.waitForResponse('**/comfy/queue');
  await page.evaluate(() => {
    window.dispatchEvent(new Event('focus'));
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await checked;
  await expect(page.getByText('서버에 연결했어요')).toBeVisible({ timeout: 1000 });
  expect(Date.now() - resumed).toBeLessThan(1000);
  expect(sockets).toBe(1);
  await page.getByRole('link', { name: '만들기', exact: true }).last().click();
  await expect(page.getByTestId('generate')).toBeEnabled();
});

test('a saved schema cannot report a disconnected backend as connected', async ({ page }) => {
  await page.goto('/settings');
  await page.getByRole('button', { name: '저장하고 연결 확인' }).click();
  await expect(page.getByText('서버에 연결했어요')).toBeVisible();
  await page.route('**/comfy/queue', (route) => route.abort('connectionrefused'));
  await page.getByRole('button', { name: '저장하고 연결 확인' }).click();
  await expect(page.getByText('서버에 연결했어요')).toHaveCount(0);
  await expect(page.getByText(/서버에 연결할 수 없습니다/)).toBeVisible();
});
