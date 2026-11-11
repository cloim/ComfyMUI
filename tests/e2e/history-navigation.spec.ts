import { test, expect, type Page } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  // Keep these navigation tests independent of saved settings and generation services.
  await page.route('**/api/state', (route) =>
    route.fulfill({
      json:
        route.request().method() === 'GET'
          ? {
              entries: {
                'cm-connection': { value: { base: '/comfy', preview: false }, updatedAt: 1 },
              },
            }
          : { updatedAt: {} },
    }),
  );
  await page.route('**/api/gallery', (route) =>
    route.fulfill({
      json: {
        available: true,
        items: ['슬라이드 첫 장', '제외할 장면', '슬라이드 마지막 장'].map((positive, i) => ({
          filename: `history-${i}.png`,
          subfolder: '',
          type: 'output',
          mtime: 1800000000000 - i * 1000,
          size: 100,
          settings: {
            positive,
            seed: i + 100,
            model: 'Flux1.D/test-model.safetensors',
            architecture: 'flux',
            width: 512,
            height: 768,
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
  await page.goto('/gallery');
  await expect(page.getByRole('button', { name: '완료 이미지 상세 보기' })).toHaveCount(3);
});

test('history arrows and keys follow filtered images and reuse the displayed settings', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByLabel('기록 검색', { exact: true }).fill('슬라이드');
  await page.getByRole('button', { name: '완료 이미지 상세 보기' }).first().click();
  const dialog = page.getByRole('dialog', { name: '생성 기록', exact: true });
  const previous = dialog.getByRole('button', { name: '이전 이미지', exact: true });
  const next = dialog.getByRole('button', { name: '다음 이미지', exact: true });
  await expect(dialog.getByRole('status')).toHaveText('1 / 2');
  await expect(previous).toBeDisabled();
  await next.click();
  await expect(dialog).toContainText('슬라이드 마지막 장');
  await expect(dialog.getByRole('img', { name: '생성한 이미지', exact: true })).toHaveAttribute(
    'src',
    /history-2.png/,
  );
  await expect(next).toBeDisabled();
  await page.keyboard.press('ArrowRight');
  await expect(dialog.getByRole('status')).toHaveText('2 / 2');
  await page.keyboard.press('ArrowLeft');
  await expect(dialog.getByRole('status')).toHaveText('1 / 2');
  await next.click();
  await previous.click();
  await expect(dialog).toContainText('슬라이드 첫 장');
  // The close button owns initial focus, so navigation also works outside the carousel body.
  await dialog.getByRole('button', { name: '닫기', exact: true }).focus();
  await page.keyboard.press('ArrowRight');
  await dialog.getByRole('link', { name: '설정 재사용' }).click();
  await expect(page.getByLabel('그리고 싶은 장면', { exact: true })).toHaveValue(
    '슬라이드 마지막 장',
  );
});

async function touchSwipe(page: Page, dx: number, dy = 0) {
  const image = page
    .getByRole('dialog', { name: '생성 기록', exact: true })
    .getByRole('img', { name: '생성한 이미지', exact: true });
  const box = (await image.boundingBox())!;
  const x = box.x + box.width / 2;
  const y = box.y + Math.min(box.height / 2, 100);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchMove',
    touchPoints: [{ x: x + dx, y: y + dy }],
  });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await cdp.detach();
}

test('touch swipes navigate without opening zoom, while taps and nested dialogs keep their actions', async ({
  page,
}) => {
  await page.getByRole('button', { name: '완료 이미지 상세 보기' }).first().click();
  const dialog = page.getByRole('dialog', { name: '생성 기록', exact: true });
  await expect(dialog.getByRole('status')).toHaveText('1 / 3');
  await touchSwipe(page, -80);
  await expect(dialog.getByRole('status')).toHaveText('2 / 3');
  await expect(page.getByRole('dialog')).toHaveCount(1);
  await touchSwipe(page, 80);
  await expect(dialog.getByRole('status')).toHaveText('1 / 3');
  await touchSwipe(page, 80);
  await expect(dialog.getByRole('status')).toHaveText('1 / 3');
  await touchSwipe(page, -15);
  await expect(dialog.getByRole('status')).toHaveText('1 / 3');
  await touchSwipe(page, -20, -70);
  await expect(dialog.getByRole('status')).toHaveText('1 / 3');
  await dialog.getByRole('button', { name: '이미지 크게 보기', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(2);
  await page.keyboard.press('ArrowRight');
  await expect(dialog.getByRole('status')).toHaveText('1 / 3');
  // Close the viewer with its own control to retain the history modal.
  await page.getByRole('dialog').last().getByRole('button', { name: /닫기/ }).click();
  await dialog.getByRole('button', { name: '업스케일', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(2);
  await page.keyboard.press('ArrowRight');
  await expect(dialog.getByRole('status')).toHaveText('1 / 3');
});

test('single filtered image disables both directions and fits a small viewport', async ({
  page,
}) => {
  await page.setViewportSize({ width: 325, height: 667 });
  await page.getByLabel('기록 검색', { exact: true }).fill('슬라이드 첫 장');
  await page.getByRole('button', { name: '완료 이미지 상세 보기' }).click();
  const dialog = page.getByRole('dialog', { name: '생성 기록', exact: true });
  await expect(dialog.getByRole('status')).toHaveText('1 / 1');
  await expect(dialog.getByRole('button', { name: '이전 이미지', exact: true })).toBeDisabled();
  await expect(dialog.getByRole('button', { name: '다음 이미지', exact: true })).toBeDisabled();
  expect(await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
  await page.screenshot({ path: 'docs/history-detail-325.png' });
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
});
