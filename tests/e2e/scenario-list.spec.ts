import { expect, test } from '@playwright/test';

// scenario.spec.ts starts from an empty scenario list, so nothing is left behind.
test.beforeEach(async ({ request }) => {
  expect((await request.post('/api/state/reset')).ok()).toBe(true);
});
// Closing the pages first lets their last pending writes land before the reset.
test.afterEach(async ({ page, request }) => {
  await page.context().close();
  expect((await request.post('/api/state/reset')).ok()).toBe(true);
});

test('저장된 시나리오 목록에서 시나리오를 열고 새로 만든다', async ({ page }) => {
  await page.goto('/scenario');
  await page.getByRole('button', { name: '시나리오 만들기', exact: true }).click();
  await page.getByLabel('시나리오 이름').fill('사무실에서');
  await page.getByRole('button', { name: '시나리오 목록' }).click();

  const list = page.getByRole('list', { name: '시나리오 목록' });
  await expect(page.getByRole('heading', { name: /저장된 시나리오/ })).toBeVisible();
  await expect(list.getByRole('button')).toHaveCount(1);
  await expect(list.getByRole('button', { name: '사무실에서 열기' })).toContainText('씬 0개');

  await page.getByRole('button', { name: '새 시나리오', exact: true }).click();
  await page.getByLabel('시나리오 이름').fill('비 오는 날');
  await page.getByRole('button', { name: '시나리오 목록' }).click();
  await expect(list.getByRole('button')).toHaveCount(2);

  await list.getByRole('button', { name: '사무실에서 열기' }).click();
  await expect(page.getByLabel('시나리오 이름')).toHaveValue('사무실에서');
  // The open scenario survives a reload; a new visit starts from the list.
  await page.reload();
  await expect(page.getByLabel('시나리오 이름')).toHaveValue('사무실에서');
  const fresh = await page.context().newPage();
  await fresh.goto('/scenario');
  await expect(fresh.getByRole('list', { name: '시나리오 목록' }).getByRole('button')).toHaveCount(
    2,
  );
});

test('장면 묘사에 이름을 쓰면 등장 캐릭터로 선택하고 빠진 캐릭터를 알린다', async ({ page }) => {
  await page.goto('/scenario');
  await page.getByRole('button', { name: '시나리오 만들기', exact: true }).click();
  await page.getByRole('button', { name: '캐릭터 추가' }).click();
  await page.getByLabel('캐릭터 1 이름').fill('omz');
  await page.getByRole('tab', { name: /씬 편집/ }).click();
  await page.getByRole('button', { name: '씬 추가', exact: true }).click();

  const cast = page
    .getByRole('group', { name: '등장 캐릭터' })
    .getByRole('button', { name: 'omz' });
  await expect(cast).toHaveAttribute('aria-pressed', 'false');
  await page.getByLabel('장면 묘사').fill('OMZ가 사무실에서 일한다');
  await expect(cast).toHaveAttribute('aria-pressed', 'true');

  // Removing the character keeps it removed, and the hint offers to add it back.
  await cast.click();
  await expect(cast).toHaveAttribute('aria-pressed', 'false');
  await page.getByLabel('장면 묘사').fill('OMZ가 사무실에서 열심히 일한다');
  await expect(cast).toHaveAttribute('aria-pressed', 'false');
  await expect(
    page.getByText(/장면 묘사에 나온 omz이\(가\) 등장 캐릭터로 선택되지 않았어요/),
  ).toBeVisible();
  await page.getByRole('button', { name: '등장 캐릭터로 선택' }).click();
  await expect(cast).toHaveAttribute('aria-pressed', 'true');
});
