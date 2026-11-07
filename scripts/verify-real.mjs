// Run explicitly against an idle local ComfyUI: node scripts/verify-real.mjs
// This requests one small, non-sensitive scene and saves evidence under ignored docs/.
import { chromium } from '@playwright/test';
import { writeFileSync, mkdirSync } from 'node:fs';
const base = 'http://127.0.0.1:4173';
const queue = await (await fetch(base + '/comfy/queue')).json();
if (queue.queue_running.length || queue.queue_pending.length)
  throw Error('서버가 대기 상태일 때 검증해 주세요');
const info = await (await fetch(base + '/comfy/object_info')).json();
const models = info.UNETLoader.input.required.unet_name[0];
const model = models.find((v) => /(^|[\\/])flux1-dev-fp8\.safetensors$/i.test(v));
if (!model) throw Error('검증용 Flux.1 diffusion 모델을 확인해 주세요');
mkdirSync('docs', { recursive: true });
const browser = await chromium.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
});
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  page.on('pageerror', (e) => console.log('Page error: ' + e.message));
  await page.goto(base + '/settings');
  await page.getByRole('button', { name: '저장하고 연결 확인' }).click();
  await page.getByText('서버에 연결했어요').waitFor();
  await page.goto(base + '/create');
  await page.getByRole('tab', { name: /^Flux1/ }).click();
  await page.getByRole('button', { name: '모델 선택', exact: true }).click();
  await page.getByRole('button', { name: model, exact: true }).click();
  await page
    .getByLabel('그리고 싶은 장면', { exact: true })
    .fill(
      'A peaceful mountain cabin in a pine forest, morning sunlight, watercolor landscape, no people',
    );
  await page.getByRole('button', { name: '고급 설정', exact: true }).click();
  for (const [label, value] of [
    ['너비', '256'],
    ['높이', '256'],
    ['Steps', '4'],
    ['CFG', '1'],
  ])
    await page.getByLabel(label, { exact: true }).fill(value);
  await page.getByRole('button', { name: '설정 완료' }).click();
  const sent = page.waitForRequest(
    (r) => r.url().endsWith('/comfy/prompt') && r.method() === 'POST',
  );
  await page.getByTestId('generate').click();
  const body = (await sent).postDataJSON();
  writeFileSync('docs/real-request.json', JSON.stringify(body, null, 2));
  console.log('실제 Flux.1 생성 요청 전송: 256x256, 4 steps');
  const started = Date.now();
  let job;
  for (let n = 0; n < 180; n++) {
    await page.waitForTimeout(5000);
    job = await page.evaluate(() => JSON.parse(localStorage.getItem('cm-jobs') || '[]')[0]);
    console.log(`${Math.round((Date.now() - started) / 1000)}s ${job?.status} ${job?.progress}%`);
    if (['complete', 'error', 'cancelled'].includes(job?.status)) break;
  }
  writeFileSync('docs/real-generation.json', JSON.stringify(job, null, 2));
  if (job?.status !== 'complete') throw Error(job?.error || '실제 생성 제한 시간 초과');
  const url = base + '/comfy/view?' + new URLSearchParams(job.images[0]);
  const response = await fetch(url);
  if (!response.ok) throw Error('생성 이미지 조회 실패');
  writeFileSync('docs/real-result.png', Buffer.from(await response.arrayBuffer()));
  await page
    .getByRole('navigation', { name: '모바일 메뉴' })
    .getByRole('link', { name: '기록', exact: true })
    .click();
  await page.getByRole('button', { name: '완료 이미지 상세 보기' }).click();
  await page.screenshot({ path: 'docs/real-mobile.png' });
  console.log(`실제 생성과 UI 결과 표시 완료: ${job.id}, 이미지 ${job.images.length}개`);
} finally {
  await browser.close();
}
