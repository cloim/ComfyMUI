import { test, expect, type Page, type Route } from '@playwright/test';
import { defaults } from '../../src/domain';
const presetSettings = {
  ...defaults,
  model: 'Flux1.D/test-model.safetensors',
  clip1: 'clip_l.safetensors',
  clip2: 't5xxl.safetensors',
  vae: 'ae.safetensors',
};

test.beforeEach(async ({ request }) => {
  expect((await request.post('/api/state/reset')).ok()).toBe(true);
});

const blockWrites = (route: Route) =>
  route.request().method() === 'POST' ? route.abort('internetdisconnected') : route.continue();
async function reconnect(page: Page) {
  await page.unroute('**/api/state', blockWrites);
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
}
async function renamePreset(page: Page, from: string, to: string) {
  await page.getByRole('button', { name: `${from} 수정`, exact: true }).click();
  await page.getByLabel('프리셋 이름', { exact: true }).fill(to);
  await page.getByRole('button', { name: '저장', exact: true }).click();
  await expect(page.getByRole('heading', { name: to, exact: true })).toBeVisible();
}

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

test('two devices merge edits to different preset IDs without losing either edit', async ({
  browser,
  request,
  baseURL,
}) => {
  const presets = [
    {
      id: 'preset-a',
      name: '프리셋 A',
      description: '',
      color: 'olive',
      updatedAt: 1,
      settings: presetSettings,
    },
    {
      id: 'preset-b',
      name: '프리셋 B',
      description: '',
      color: 'olive',
      updatedAt: 1,
      settings: presetSettings,
    },
  ];
  expect(
    (
      await request.post('/api/state', {
        data: { values: { 'cm-presets': presets }, revisions: { 'cm-presets': 0 } },
      })
    ).ok(),
  ).toBe(true);
  const a = await browser.newContext({ baseURL });
  const b = await browser.newContext({ baseURL });
  try {
    const first = await a.newPage(),
      second = await b.newPage();
    await first.goto('/presets');
    await second.goto('/presets');
    await expect(second.getByRole('heading', { name: '프리셋 A', exact: true })).toBeVisible();
    await second.route('**/api/state', blockWrites);
    await renamePreset(second, '프리셋 A', '휴대폰의 A');
    await renamePreset(first, '프리셋 B', 'PC의 B');
    await expect
      .poll(async () =>
        (await (await request.get('/api/state')).json()).entries['cm-presets']?.value.map(
          (p: any) => p.name,
        ),
      )
      .toEqual(['프리셋 A', 'PC의 B']);
    await reconnect(second);
    await expect
      .poll(async () =>
        (await (await request.get('/api/state')).json()).entries['cm-presets']?.value.map(
          (p: any) => p.name,
        ),
      )
      .toEqual(['휴대폰의 A', 'PC의 B']);
    await expect(second.getByRole('heading', { name: '휴대폰의 A', exact: true })).toBeVisible();
    await expect(second.getByRole('heading', { name: 'PC의 B', exact: true })).toBeVisible();
    expect(
      await second.evaluate(() =>
        JSON.parse(localStorage.getItem('cm-sync-conflicts') || '[]').some(
          (c: any) => c.key === 'cm-presets',
        ),
      ),
    ).toBe(false);
  } finally {
    await a.close();
    await b.close();
  }
});

test('two devices editing the same preset require an explicit choice', async ({
  browser,
  request,
  baseURL,
}) => {
  const preset = {
    id: 'shared',
    name: '같은 프리셋',
    description: '',
    color: 'olive',
    updatedAt: 1,
    settings: presetSettings,
  };
  await request.post('/api/state', {
    data: { values: { 'cm-presets': [preset] }, revisions: { 'cm-presets': 0 } },
  });
  const a = await browser.newContext({ baseURL });
  const b = await browser.newContext({ baseURL });
  try {
    const first = await a.newPage(),
      second = await b.newPage();
    await first.goto('/presets');
    await second.goto('/presets');
    await expect(second.getByRole('heading', { name: '같은 프리셋', exact: true })).toBeVisible();
    await second.route('**/api/state', blockWrites);
    await renamePreset(second, '같은 프리셋', '휴대폰 버전');
    await renamePreset(first, '같은 프리셋', 'PC 버전');
    await expect
      .poll(
        async () =>
          (await (await request.get('/api/state')).json()).entries['cm-presets']?.value[0].name,
      )
      .toBe('PC 버전');
    await reconnect(second);
    await second.getByRole('button', { name: '변경 비교', exact: true }).click();
    await second
      .getByRole('dialog')
      .getByRole('button', { name: '이 기기 초안 사용', exact: true })
      .click();
    await expect
      .poll(
        async () =>
          (await (await request.get('/api/state')).json()).entries['cm-presets']?.value[0].name,
      )
      .toBe('휴대폰 버전');
    expect(
      await second.evaluate(
        () => JSON.parse(localStorage.getItem('cm-sync-archive') || '[]')[0].server[0].name,
      ),
    ).toBe('PC 버전');
  } finally {
    await a.close();
    await b.close();
  }
});
