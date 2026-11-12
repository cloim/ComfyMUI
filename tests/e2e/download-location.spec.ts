import { test, expect } from '@playwright/test';

for (const kind of ['model', 'lora'] as const) {
  for (const storage of ['volume', 'local'] as const) {
    test(`${kind} CivitAI download keeps ${storage} destination with automatic folders`, async ({
      page,
      request,
    }) => {
      expect((await request.post('/api/state/reset')).ok()).toBe(true);
      const folder = kind === 'model' ? 'diffusion_models' : 'loras';
      const volumeBase = storage === 'local' ? '/data/models-view' : '/data/models';
      const volumeRoot = `${volumeBase}/${folder}`;
      const localRoot = `/host-models/${folder}`;
      const endpoint = kind === 'model' ? 'checkpoints' : 'loras';
      await page.route(`**/comfy/api/lm/${endpoint}/roots`, (route) =>
        route.fulfill({
          json: {
            success: true,
            roots: [
              localRoot,
              `${volumeBase}/${kind === 'model' ? 'checkpoints' : 'loras'}`,
              volumeRoot,
            ],
          },
        }),
      );
      await page.goto('/settings');
      await page.getByRole('button', { name: '저장하고 연결 확인' }).click();
      await expect(page.getByText('서버에 연결했어요')).toBeVisible();
      await page.goto(kind === 'model' ? '/models' : '/loras');
      await page.getByRole('button', { name: 'CivitAI 다운로드' }).click();
      const dialog = page.getByRole('dialog');
      await dialog
        .getByLabel('CivitAI AIR 코드', { exact: true })
        .fill(
          kind === 'model'
            ? 'urn:air:flux1:checkpoint:civitai:705606@992100+5501'
            : 'urn:air:flux1:lora:civitai:840370@990500',
        );
      await dialog.getByRole('button', { name: 'CivitAI 조회' }).click();
      const location = dialog.getByLabel('다운로드 저장 위치');
      await expect(location).toHaveValue(volumeRoot);
      await expect(location.locator('option', { hasText: '로컬 모델 폴더' })).toHaveCount(1);
      const root = storage === 'local' ? localRoot : volumeRoot;
      await location.selectOption(root);
      for (const width of [325, 390, 1440]) {
        await page.setViewportSize({ width, height: 900 });
        await expect(location).toBeVisible();
        const box = await location.boundingBox();
        expect(box!.x).toBeGreaterThanOrEqual(0);
        expect(box!.x + box!.width).toBeLessThanOrEqual(width);
      }
      const download = page.waitForRequest(
        (r) => r.method() === 'POST' && r.url().endsWith('/api/lm/download-model'),
      );
      await dialog.getByRole('button', { name: '선택 버전 다운로드' }).click();
      expect((await download).postDataJSON()).toMatchObject({
        model_root: root,
        use_default_paths: true,
        use_save_dir_as_root: true,
        relative_path: '',
      });
    });
  }
}
