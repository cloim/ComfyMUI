import { test, expect, type Page } from '@playwright/test';
import { defaults, type Job } from '../../src/domain';

const firstImageTime = 1800000000000;
const firstJob: Job = {
  id: 'prompt-first',
  requestToken: 'request-first',
  base: '/comfy',
  status: 'complete',
  progress: 100,
  createdAt: firstImageTime - 30_000,
  startedAt: firstImageTime - 13_000,
  completedAt: firstImageTime - 500,
  settings: { ...defaults, positive: '슬라이드 첫 장' },
  images: [{ filename: 'history-0.png', subfolder: '', type: 'output' }],
};

test.beforeEach(async ({ page }) => {
  // Keep these navigation tests independent of saved settings and generation services.
  await page.addInitScript(
    (job) => localStorage.setItem('cm-jobs', JSON.stringify([job])),
    firstJob,
  );
  const deletedFiles = new Set<string>();
  await page.route('**/api/outputs/delete', (route) => {
    const files = route.request().postDataJSON().files as { filename: string }[];
    const deleted = files.map((file) => file.filename);
    for (const filename of deleted) deletedFiles.add(filename);
    return route.fulfill({ json: { deleted, missing: [], failed: [] } });
  });
  await page.route('**/api/state', (route) =>
    route.fulfill({
      json:
        route.request().method() === 'GET'
          ? {
              entries: {
                'cm-connection': { value: { base: '/comfy' }, updatedAt: 1 },
              },
            }
          : { updatedAt: {} },
    }),
  );
  await page.route('**/api/gallery', (route) =>
    route.fulfill({
      json: {
        available: true,
        items: ['슬라이드 첫 장', '제외할 장면', '슬라이드 마지막 장']
          .map((positive, i) => ({
            filename: `history-${i}.png`,
            subfolder: '',
            type: 'output',
            mtime: firstImageTime - i * 1000,
            size: i === 0 ? 1_572_864 : 100,
            requestToken: i === 0 ? firstJob.requestToken : undefined,
            settings: {
              positive,
              seed: i + 100,
              model: 'Flux1.D/test-model.safetensors',
              architecture: 'flux',
              width: 512,
              height: 768,
            },
          }))
          .filter((file) => !deletedFiles.has(file.filename)),
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
  await expect(dialog.getByText('최근 생성', { exact: true })).toHaveCount(0);
  await expect(dialog.getByText('생성 소요 시간', { exact: true })).toBeVisible();
  await expect(dialog.getByText('12.5초', { exact: true })).toBeVisible();
  await expect(dialog.getByText('파일 크기', { exact: true })).toBeVisible();
  await expect(dialog.getByText('1.5 MB', { exact: true })).toBeVisible();
  await expect(previous).toBeDisabled();
  await next.click();
  await expect(dialog).toContainText('슬라이드 마지막 장');
  await expect(dialog.getByText('정보 없음', { exact: true })).toBeVisible();
  await expect(dialog.getByText('100 B', { exact: true })).toBeVisible();
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

test('history without a gallery index reads the original size from image headers', async ({
  page,
}) => {
  await page.route('**/api/gallery', (route) => route.fulfill({ json: { available: false } }));
  await page.route('**/comfy/view?*', (route) =>
    route.request().method() === 'HEAD'
      ? route.fulfill({ headers: { 'content-type': 'image/png', 'content-length': '2048' } })
      : route.fallback(),
  );
  await page.reload();
  await page.getByRole('button', { name: '완료 이미지 상세 보기' }).click();
  const dialog = page.getByRole('dialog', { name: '생성 기록', exact: true });
  await expect(dialog.getByText('12.5초', { exact: true })).toBeVisible();
  await expect(dialog.getByText('2 KB', { exact: true })).toBeVisible();
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

test('detail modal displays delete icon button on top right of image and triggers deletion', async ({
  page,
}) => {
  await page.getByRole('button', { name: '완료 이미지 상세 보기' }).first().click();
  const dialog = page.getByRole('dialog', { name: '생성 기록', exact: true });
  await expect(dialog).toBeVisible();

  // Delete button on top right of the image
  const deleteBtn = dialog.getByRole('button', { name: '기록 삭제', exact: true });
  await expect(deleteBtn).toBeVisible();

  // Click delete button -> confirmation dialog opens
  await deleteBtn.click();
  const confirmDialog = page.getByRole('dialog', { name: /삭제할까요\?/ });
  await expect(confirmDialog).toBeVisible();

  // Cancel keeping item
  await confirmDialog.getByRole('button', { name: '유지하기' }).click();
  await expect(confirmDialog).toHaveCount(0);
  await expect(dialog).toBeVisible();
});

test('deleting image in detail modal shows next image, or closes modal if no next image', async ({
  page,
}) => {
  // Open the first image
  await page.getByRole('button', { name: '완료 이미지 상세 보기' }).first().click();
  const dialog = page.getByRole('dialog', { name: '생성 기록', exact: true });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('status')).toHaveText('1 / 3');
  await expect(dialog).toContainText('슬라이드 첫 장');

  // Delete the first image
  await dialog.getByRole('button', { name: '기록 삭제', exact: true }).click();
  const confirmDialog = page.getByRole('dialog', { name: /삭제할까요\?/ });
  await expect(confirmDialog).toBeVisible();
  await confirmDialog.getByRole('button', { name: /삭제/ }).click();
  await expect(confirmDialog).toHaveCount(0);

  // Modal stays open and shows the next image (was 2nd, now 1st of 2)
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('status')).toHaveText('1 / 2');
  await expect(dialog).toContainText('제외할 장면');

  // Navigate to the last image
  await dialog.getByRole('button', { name: '다음 이미지', exact: true }).click();
  await expect(dialog.getByRole('status')).toHaveText('2 / 2');
  await expect(dialog).toContainText('슬라이드 마지막 장');

  // Delete the last image
  await dialog.getByRole('button', { name: '기록 삭제', exact: true }).click();
  const confirmDialog2 = page.getByRole('dialog', { name: /삭제할까요\?/ });
  await expect(confirmDialog2).toBeVisible();
  await confirmDialog2.getByRole('button', { name: /삭제/ }).click();
  await expect(confirmDialog2).toHaveCount(0);

  // Since there is no next image, modal closes
  await expect(dialog).toHaveCount(0);
});
