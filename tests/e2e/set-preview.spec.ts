import { test, expect } from '@playwright/test';

test.describe('Set preview image from gallery card', () => {
  test('opens set preview modal and sends replace-preview multipart request', async ({ page }) => {
    let replacedModelPath = '';
    let replacedKind = '';

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
          items: [
            {
              filename: 'output-test-01.png',
              subfolder: '',
              type: 'output',
              mtime: Date.now(),
              size: 2048,
              settings: {
                positive: 'A lovely sunny meadow landscape',
                seed: 12345,
                model: 'Flux1.D/test-flux-model.safetensors',
                architecture: 'flux',
                width: 512,
                height: 768,
                loras: [{ name: 'Flux1.D/detail_slider.safetensors', model: 0.8, clip: 0.8 }],
              },
            },
          ],
        },
      }),
    );

    await page.route(/\/comfy\/(view|thumb)\?/, (route) =>
      route.fulfill({
        contentType: 'image/png',
        body: Buffer.from('fake-image-bytes'),
      }),
    );

    await page.route('**/api/lm/checkpoints/list?*', (route) =>
      route.fulfill({
        json: {
          items: [
            {
              model_name: 'Test Flux Model',
              file_name: 'test-flux-model',
              folder: 'Flux1.D',
              file_path: '/models/diffusion_models/Flux1.D/test-flux-model.safetensors',
              preview_url: '/api/lm/previews?path=old_preview.webp',
              preview_nsfw_level: 0,
              base_model: 'Flux.1 D',
              sha256: 'abc123',
              file_size: 100,
              modified: 100,
              tags: [],
              from_civitai: true,
              notes: '',
              favorite: false,
              update_available: false,
            },
          ],
          total: 1,
          page: 1,
          page_size: 1000,
          total_pages: 1,
        },
      }),
    );

    await page.route('**/api/lm/loras/list?*', (route) =>
      route.fulfill({
        json: {
          items: [
            {
              model_name: 'Detail Slider',
              file_name: 'detail_slider',
              folder: 'Flux1.D',
              file_path: '/models/loras/Flux1.D/detail_slider.safetensors',
              preview_url: '',
              preview_nsfw_level: 0,
              base_model: 'Flux.1 D',
              sha256: 'lora123',
              file_size: 50,
              modified: 100,
              tags: [],
              from_civitai: true,
              usage_tips: '{}',
              notes: '',
              favorite: false,
              update_available: false,
            },
          ],
          total: 1,
          page: 1,
          page_size: 1000,
          total_pages: 1,
        },
      }),
    );

    await page.route('**/api/lm/*/replace-preview', async (route) => {
      const url = route.request().url();
      replacedKind = url.includes('checkpoints') ? 'checkpoints' : 'loras';
      const postData = route.request().postDataBuffer();
      if (postData) {
        const text = postData.toString('utf-8');
        const match = text.match(/name="model_path"\r?\n\r?\n([^\r\n]+)/);
        if (match) replacedModelPath = match[1];
      }
      await route.fulfill({
        json: {
          success: true,
          preview_url: '/api/lm/previews?path=new_preview.webp',
          preview_nsfw_level: 0,
        },
      });
    });

    await page.goto('/gallery');

    // 1. Check card has '대표 이미지로 설정' button
    const setPreviewBtn = page.getByRole('button', { name: '대표 이미지로 설정' });
    await expect(setPreviewBtn).toBeVisible();

    // 2. Click the button to open modal
    await setPreviewBtn.click();

    // 3. Verify modal opened
    const dialog = page.getByRole('dialog', { name: '대표 이미지 설정' });
    await expect(dialog).toBeVisible();

    // 4. Verify Model and LoRA sections are present
    await expect(dialog.getByText('체크포인트 모델')).toBeVisible();
    await expect(dialog.getByText('Test Flux Model')).toBeVisible();
    await expect(dialog.getByText('적용된 LoRA (1)')).toBeVisible();
    await expect(dialog.getByText('Detail Slider')).toBeVisible();

    // 5. Click '대표 이미지로 설정' for model
    const modelSetBtn = dialog.getByRole('button', { name: '대표 이미지로 설정' }).first();
    await modelSetBtn.click();

    // 6. Verify success state
    await expect(dialog.getByText('설정 완료')).toBeVisible();
    expect(replacedKind).toBe('checkpoints');
    expect(replacedModelPath).toBe('/models/diffusion_models/Flux1.D/test-flux-model.safetensors');
  });
});
