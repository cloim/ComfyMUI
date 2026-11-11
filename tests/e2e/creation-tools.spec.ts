import { expect, test } from '@playwright/test';

test.beforeEach(async ({ request }) => {
  expect((await request.post('/api/state/reset')).ok()).toBe(true);
});

test('draft previews changes before generation and keeps the final target', async ({ page }) => {
  await page.goto('/create');
  await page.getByRole('button', { name: '빠른 시안', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByLabel('시안 설정 미리보기')).toBeVisible();
  expect(
    await page.evaluate(() => JSON.parse(localStorage.getItem('cm-jobs') || '[]').length),
  ).toBe(0);
  await page.setViewportSize({ width: 325, height: 667 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await dialog.getByRole('button', { name: '시안 1장 생성', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByText('생성 완료', { exact: true })).toBeVisible({ timeout: 15000 });
  await expect
    .poll(() =>
      page.evaluate(() => {
        const job = JSON.parse(localStorage.getItem('cm-jobs') || '[]')[0];
        return Boolean(
          job?.settings.draftTarget && job.settings.width <= 768 && job.settings.height <= 768,
        );
      }),
    )
    .toBe(true);
});

test('experiments validate values and create one fixed-seed group', async ({ page }) => {
  await page.goto('/create');
  await page.getByRole('button', { name: '조건별 실험', exact: true }).click();
  const dialog = page.getByRole('dialog');
  const values = dialog.getByRole('textbox', { name: '비교 값', exact: true });
  await values.fill('8, 8');
  await expect(dialog.getByRole('alert')).toContainText('중복');
  await expect(dialog.getByRole('button', { name: '0장 실험 생성', exact: true })).toBeDisabled();
  await values.fill('8, 12');
  await expect(dialog.getByLabel('실험 설정 미리보기')).toContainText('2장');
  await dialog.getByRole('button', { name: '2장 실험 생성', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect
    .poll(() =>
      page.evaluate(() => {
        const jobs = JSON.parse(localStorage.getItem('cm-jobs') || '[]');
        return jobs.filter((job: { settings: { experiment?: unknown } }) => job.settings.experiment)
          .length;
      }),
    )
    .toBe(2);
  const experiment = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('cm-jobs') || '[]').map(
      (job: {
        settings: {
          seed: number;
          random: boolean;
          steps: number;
          experiment: { id: string; label: string };
        };
      }) => job.settings,
    ),
  );
  expect(new Set(experiment.map((job: { seed: number }) => job.seed)).size).toBe(1);
  expect(
    new Set(experiment.map((job: { experiment: { id: string } }) => job.experiment.id)).size,
  ).toBe(1);
  expect(experiment.every((job: { random: boolean }) => !job.random)).toBe(true);
  expect(
    experiment.map((job: { steps: number }) => job.steps).sort((a: number, b: number) => a - b),
  ).toEqual([8, 12]);
});
