import { test, expect } from '@playwright/test';
import { writeFileSync } from 'node:fs';

test.beforeEach(async ({ request, page }) => {
  expect((await request.post('/api/state/reset')).ok()).toBe(true);
  await page.goto('/settings');
  await page.getByRole('button', { name: '저장하고 연결 확인' }).click();
  await expect(page.getByText('서버에 연결했어요')).toBeVisible();
  await page.goto('/create');
  await page
    .getByLabel('모델', { exact: true })
    .selectOption({ label: 'Flux1.D/test-model.safetensors' });
});

test('LoRA image cards, responsive layout, search and duplicate prevention', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.getByRole('button', { name: '추가', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'LoRA 추가', exact: true });
  await expect(
    dialog.getByRole('img', { name: 'Flux Soft Portrait LoRA 대표 이미지' }),
  ).toBeVisible();
  await expect(dialog.getByRole('combobox')).toHaveCount(0);
  await expect(
    dialog.getByRole('button', { name: 'Krea2/style.safetensors', exact: true }),
  ).toHaveCount(0);
  // A same-named LoRA from another folder must not supply this card's image.
  await expect(
    dialog.getByRole('button', { name: 'Flux1.D/style.safetensors', exact: true }).getByRole('img'),
  ).toHaveCount(0);

  const auditPath = 'file:///C:/Users/cloim/.agents/skills/balance/scripts/ui-audit.mjs';
  const { auditDom } = await import(auditPath);
  const audits = [];
  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 390, height: 844 },
    { width: 325, height: 667 },
  ]) {
    await page.setViewportSize(viewport);
    await page.evaluate(() => document.fonts.ready);
    const audit = (await page.evaluate(auditDom)) as {
      findings: { severity: string }[];
      skipped: string[];
    };
    audits.push({ viewport, ...audit });
    expect(
      audit.findings.filter((finding: { severity: string }) => finding.severity === 'error'),
    ).toEqual([]);
    const box = await dialog.boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width);
    await page.screenshot({ path: `docs/lora-picker-${viewport.width}.png` });
  }
  writeFileSync('docs/lora-picker-ui-audit.json', JSON.stringify(audits, null, 2));
  await dialog.getByRole('searchbox', { name: '추가할 LoRA 검색' }).fill('lighting');
  await expect(
    dialog.getByRole('button', { name: 'Flux1.D/soft.safetensors', exact: true }),
  ).toBeVisible();
  await expect(
    dialog.getByRole('button', { name: 'Flux1.D/film.safetensors', exact: true }),
  ).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Flux1.D/soft.safetensors', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  const loras = await page.evaluate(() => JSON.parse(localStorage.getItem('cm-settings')!).loras);
  expect(loras).toEqual([{ name: 'Flux1.D/soft.safetensors', model: 0.8, clip: 0.8 }]);
  await page.getByRole('button', { name: '추가', exact: true }).click();
  await expect(
    dialog.getByRole('button', { name: 'Flux1.D/style.safetensors', exact: true }),
  ).toBeVisible();
  await expect(
    dialog.getByRole('button', { name: 'Flux1.D/soft.safetensors', exact: true }),
  ).toHaveCount(0);
  await dialog.getByRole('searchbox').fill('no-match');
  await expect(dialog.getByRole('status')).toBeVisible();
  await dialog.getByRole('button', { name: '검색 초기화' }).click();
  await expect(
    dialog.getByRole('button', { name: 'Flux1.D/style.safetensors', exact: true }),
  ).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('LoRA metadata failure keeps file selection available and retry restores images', async ({
  page,
}) => {
  await page.route('**/api/lm/loras/list?*', (route) =>
    route.fulfill({ status: 503, json: { error: 'unavailable' } }),
  );
  await page.getByRole('button', { name: '추가', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'LoRA 추가' });
  await expect(dialog.getByText(/파일명으로도 선택할 수 있어요/)).toBeVisible();
  await expect(
    dialog.getByRole('button', { name: 'Flux1.D/soft.safetensors', exact: true }),
  ).toBeEnabled();
  await page.unroute('**/api/lm/loras/list?*');
  await page.route('**/api/lm/previews?*', (route) => route.fulfill({ status: 404 }));
  await dialog.getByRole('button', { name: '다시 시도' }).click();
  const card = dialog.getByRole('button', { name: 'Flux1.D/soft.safetensors', exact: true });
  await expect(card.getByText('파일명으로 선택')).toBeVisible();
  await card.click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByLabel('LoRA 1 모델 강도', { exact: true })).toBeVisible();
});

test('LoRA metadata pagination and local search', async ({ page }) => {
  let requests = 0;
  await page.route('**/api/lm/loras/list?*', async (route) => {
    requests++;
    const response = await route.fetch();
    const data = await response.json();
    const secondPage = new URL(route.request().url()).searchParams.get('page') === '2';
    const item = data.items.find((item: { file_name: string }) => item.file_name === 'soft');
    await route.fulfill({
      json: {
        ...data,
        page: secondPage ? 2 : 1,
        total_pages: 2,
        items: secondPage
          ? [
              {
                ...item,
                file_name: 'film',
                model_name: 'Film From Second Page',
                file_path: 'E:/ComfyUI/models/loras/Flux1.D/film.safetensors',
              },
            ]
          : [item],
      },
    });
  });
  await page.getByRole('button', { name: '추가', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'LoRA 추가' });
  await expect(dialog.getByText('Film From Second Page')).toBeVisible();
  expect(requests).toBe(2);
  await dialog.getByRole('searchbox').fill('Film From Second Page');
  await expect(
    dialog.getByRole('button', { name: 'Flux1.D/film.safetensors', exact: true }),
  ).toBeVisible();
  await expect(
    dialog.getByRole('button', { name: 'Flux1.D/soft.safetensors', exact: true }),
  ).toHaveCount(0);
  await dialog.getByRole('searchbox').fill('');
  await expect(
    dialog.getByRole('button', { name: 'Flux1.D/soft.safetensors', exact: true }),
  ).toBeVisible();
  expect(requests).toBe(2);
});

test('model labels and LoRA strength HTML tooltip support hover and click', async ({ page }) => {
  const model = page.getByLabel('모델', { exact: true });
  await expect(model.locator('option:checked')).toHaveText('Flux1.D/test-model.safetensors');
  await expect(model.locator('option').filter({ hasText: '(체크포인트)' })).toHaveCount(0);
  await expect(model.locator('option').filter({ hasText: '(GGUF)' }).first()).toBeAttached();
  const help = page.getByRole('button', { name: 'LoRA 강도 도움말' });
  await help.hover();
  const tip = page.getByRole('tooltip');
  await expect(tip).toContainText('모델 강도');
  await expect(tip).toContainText('CLIP 강도');
  await expect(tip.locator('b')).toHaveCount(2);
  await help.click();
  await page.getByRole('heading', { name: 'LoRA', exact: true }).hover();
  await expect(tip).toBeVisible();
  const box = await tip.boundingBox();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(390);
  await page.getByRole('heading', { name: 'LoRA', exact: true }).click();
  await expect(tip).toHaveCount(0);
});
