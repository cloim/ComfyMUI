import { test, expect } from '@playwright/test';

test.beforeEach(async ({ request }) => {
  expect((await request.post('/api/state/reset')).ok()).toBe(true);
});

test('mobile viewport keeps shell aligned and hides bottom nav when virtual keyboard opens', async ({
  page,
}) => {
  await page.goto('/create');

  // 1. Viewport meta opts into resizes-content so Android keyboards resize the layout viewport.
  const viewportContent = await page.locator('meta[name="viewport"]').getAttribute('content');
  expect(viewportContent).toContain('interactive-widget=resizes-content');

  const mobileNav = page.getByRole('navigation', { name: '모바일 메뉴' });
  const header = page.locator('header');
  await expect(mobileNav).toBeVisible();
  expect((await header.boundingBox())!.y).toBe(0);

  // 2. Simulate resizes-content keyboard opening while editing the prompt textarea.
  const prompt = page.locator('textarea').first();
  await prompt.click();
  await page.setViewportSize({ width: 390, height: 480 });

  await expect(mobileNav).toBeHidden();
  const resizedHeader = await header.boundingBox();
  expect(resizedHeader!.y).toBe(0);
  const appHeight = await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue('--app-height').trim(),
  );
  expect(appHeight).toBe('480px');

  // Restore viewport height (keyboard closed): bottom nav reappears.
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(mobileNav).toBeVisible();

  // 3. Simulate resizes-visual fallback (e.g. iOS Safari) where visualViewport shrinks and pans down.
  await page.evaluate(() => {
    const vv = window.visualViewport!;
    Object.defineProperty(vv, 'height', { configurable: true, get: () => 500 });
    Object.defineProperty(vv, 'offsetTop', { configurable: true, get: () => 180 });
    Object.defineProperty(vv, 'scale', { configurable: true, get: () => 1 });
    vv.dispatchEvent(new Event('resize'));
    vv.dispatchEvent(new Event('scroll'));
  });

  await expect(mobileNav).toBeHidden();
  const vars = await page.evaluate(() => {
    const style = getComputedStyle(document.documentElement);
    const shell = document.querySelector('#root > div') as HTMLElement;
    const rect = shell.getBoundingClientRect();
    return {
      appHeight: style.getPropertyValue('--app-height').trim(),
      appOffsetTop: style.getPropertyValue('--app-offset-top').trim(),
      shellTop: rect.top,
      shellHeight: rect.height,
    };
  });
  expect(vars.appHeight).toBe('500px');
  expect(vars.appOffsetTop).toBe('180px');
  expect(vars.shellTop).toBe(180);
  expect(vars.shellHeight).toBe(500);
});
