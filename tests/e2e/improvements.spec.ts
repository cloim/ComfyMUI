import { test, expect, type Page, type WebSocketRoute } from '@playwright/test';

test.beforeEach(async ({ request }) => {
  expect((await request.post('/api/state/reset')).ok()).toBe(true);
});

async function connect(page: Page) {
  await page.goto('/settings');
  await page.getByRole('button', { name: '저장하고 연결 확인' }).click();
  await expect(page.getByText('서버에 연결했어요')).toBeVisible();
  await page.goto('/create');
  await page.evaluate(() => document.fonts.ready);
  await expect(page.getByRole('combobox', { name: '모델', exact: true })).not.toHaveValue('');
  await expect(page.getByTestId('generate')).toBeEnabled();
}

test('memory recovery previews a lower pixel budget before retrying', async ({ page }) => {
  await connect(page);
  await page.getByLabel('그리고 싶은 장면', { exact: true }).fill('execution-error portrait');
  await page.getByTestId('generate').click();
  await expect(page.getByText('mock out of memory', { exact: true })).toBeVisible();
  const original = await page.evaluate(
    () => JSON.parse(localStorage.getItem('cm-jobs')!)[0].settings,
  );
  await page.getByRole('button', { name: '해상도 낮춰 재시도', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '해상도 낮춰 재시도' });
  await expect(dialog).toContainText('Seed와 프롬프트는 유지');
  const nextRequest = page.waitForRequest(
    (req) => req.url().endsWith('/comfy/prompt') && req.method() === 'POST',
  );
  await dialog.getByRole('button', { name: '확인하고 생성', exact: true }).click();
  const settings = (await nextRequest).postDataJSON().extra_data.extra_pnginfo.comfymui;
  expect(settings.width * settings.height).toBeLessThan(original.width * original.height);
  expect(settings.seed).toBe(original.seed);
  expect(settings.batch).toBe(1);
});

test('a lost submission response resumes the existing server job without another POST', async ({
  page,
}) => {
  await connect(page);
  let posts = 0;
  let serverId = '';
  page.on('request', (req) => {
    if (req.url().endsWith('/comfy/prompt') && req.method() === 'POST') posts++;
  });
  await page.route(
    '**/comfy/prompt',
    async (route) => {
      const response = await route.fetch();
      serverId = (await response.json()).prompt_id;
      await route.abort('failed');
    },
    { times: 1 },
  );
  await page.getByLabel('그리고 싶은 장면', { exact: true }).fill('slow response-loss test');
  await page.getByTestId('generate').click();
  await page.getByRole('button', { name: '서버 작업 확인', exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('cm-jobs')!)[0].id))
    .toBe(serverId);
  expect(posts).toBe(1);
  await expect(page.getByRole('button', { name: '서버 작업 확인', exact: true })).toHaveCount(0);
});

test('progress bursts coalesce history saves while preserving editable prompt focus', async ({
  page,
}) => {
  let socket: WebSocketRoute | undefined;
  await page.routeWebSocket('**/comfy/ws**', (route) => {
    socket = route;
  });
  await page.addInitScript(() => {
    (window as any).historyWrites = 0;
    const write = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key === 'cm-jobs') (window as any).historyWrites++;
      return write.call(this, key, value);
    };
  });
  await connect(page);
  await expect.poll(() => Boolean(socket)).toBe(true);
  await page.getByLabel('그리고 싶은 장면', { exact: true }).fill('slow controlled progress');
  await page.getByTestId('generate').click();
  const job = await page.evaluate(() => JSON.parse(localStorage.getItem('cm-jobs')!)[0]);
  socket!.send(JSON.stringify({ type: 'execution_start', data: { prompt_id: job.id } }));
  await expect(page.getByText('모델 준비', { exact: true })).toBeVisible();
  await page.evaluate(() => {
    (window as any).historyWrites = 0;
  });
  const prompt = page.getByLabel('그리고 싶은 장면', { exact: true });
  await prompt.focus();
  for (let value = 1; value <= 50; value++)
    socket!.send(
      JSON.stringify({ type: 'progress', data: { prompt_id: job.id, value, max: 100 } }),
    );
  await expect(page.getByText('50%', { exact: true })).toBeVisible();
  await expect(prompt).toBeFocused();
  await prompt.press('End');
  await prompt.pressSequentially(' editable');
  await expect(prompt).toHaveValue('slow controlled progress editable');
  await expect
    .poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('cm-jobs')!)[0].progress))
    .toBe(50);
  expect(await page.evaluate(() => (window as any).historyWrites)).toBeLessThanOrEqual(3);
});

test('a completed submission with a lost response is recovered from its saved PNG token', async ({
  page,
}) => {
  await connect(page);
  let posts = 0;
  page.on('request', (req) => {
    if (req.url().endsWith('/comfy/prompt') && req.method() === 'POST') posts++;
  });
  await page.route(
    '**/comfy/prompt',
    async (route) => {
      const response = await route.fetch();
      const id = (await response.json()).prompt_id;
      await expect
        .poll(async () => {
          const history = await page.request.get(`/comfy/history/${id}`);
          return Boolean((await history.json())[id]?.status?.completed);
        })
        .toBe(true);
      await route.abort('failed');
    },
    { times: 1 },
  );
  await page.route('**/comfy/queue', (route) =>
    route.fulfill({ json: { queue_running: [], queue_pending: [] } }),
  );
  await page.getByLabel('그리고 싶은 장면', { exact: true }).fill('completed response-loss test');
  await page.getByTestId('generate').click();
  await page.getByRole('button', { name: '서버 작업 확인', exact: true }).click();
  await expect(page.getByText('생성 완료', { exact: true })).toBeVisible();
  const recovered = await page.evaluate(() => JSON.parse(localStorage.getItem('cm-jobs')!)[0]);
  expect(recovered.images).toHaveLength(1);
  expect(recovered.submissionUncertain).toBe(false);
  expect(posts).toBe(1);
});

test('power saving is the default and explicit power options persist', async ({ page }) => {
  await page.addInitScript(() => {
    (window as any).audioStarts = 0;
    Audio.prototype.play = async function () {
      (window as any).audioStarts++;
    };
  });
  await page.goto('/settings?tab=app');
  const saving = page.getByRole('switch', { name: '절전 모드', exact: true });
  const screen = page.getByRole('switch', { name: '생성 중 화면 유지', exact: true });
  const audio = page.getByRole('switch', { name: '백그라운드 연결 유지용 오디오', exact: true });
  await expect(saving).toBeChecked();
  await expect(screen).toBeDisabled();
  await expect(audio).toBeDisabled();
  await connect(page);
  await page.getByLabel('그리고 싶은 장면', { exact: true }).fill('slow power-policy check');
  await page.getByTestId('generate').click();
  await expect(page.getByText('서버 대기', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => (window as any).audioStarts)).toBe(0);
  await page.goto('/settings?tab=app');
  await saving.uncheck();
  await screen.check();
  await audio.check();
  await expect.poll(() => page.evaluate(() => (window as any).audioStarts)).toBeGreaterThan(0);
  await saving.check();
  await page.reload();
  await expect(saving).toBeChecked();
  await expect(screen).toBeChecked();
  await expect(screen).toBeDisabled();
  await expect(audio).toBeChecked();
  await expect(audio).toBeDisabled();
});
