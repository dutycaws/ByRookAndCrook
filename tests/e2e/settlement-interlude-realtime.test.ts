import { expect, test } from '@playwright/test';

const settlementId = '11111111-1111-4111-8111-111111111111';

function receipt(status: 'processing' | 'completed' | 'unavailable') {
  return {
    settlement: {
      id: settlementId,
      dayNumber: 2,
      status,
      progress: { completed: status === 'processing' ? 2 : 8, total: 8 },
      publicDigest: null,
      publicSummary: null,
      morningNews: null
    }
  };
}

async function openProbe(page: import('@playwright/test').Page, statusForRequest: (request: number) => 'processing' | 'completed' | 'unavailable') {
  await page.clock.install();
  let requests = 0;
  await page.route('**/api/world-settlements/**', async (route) => {
    requests += 1;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(receipt(statusForRequest(requests)))
    });
  });
  await page.setExtraHTTPHeaders({ 'x-settlement-poll-probe': 'enabled' });
  await page.goto('/__settlement_poll_probe');
  await expect(page.locator('[data-settlement-state="processing"]')).toBeVisible();
  await expect(page.getByTestId('settlement-channel-count')).toHaveText('1');
  await expect.poll(() => requests).toBe(1);
  return { getRequests: () => requests };
}

test('private settlement notifications, reconnects, focus and visibility refresh without polling', async ({ page }) => {
  const { getRequests } = await openProbe(page, (request) => request >= 5 ? 'completed' : 'processing');

  await page.clock.runFor(5 * 60_000);
  expect(getRequests()).toBe(1);

  await page.getByTestId('send-unrelated-settlement-change').click();
  expect(getRequests()).toBe(1);

  await page.getByTestId('send-settlement-change').click();
  await expect.poll(getRequests).toBe(2);
  await expect(page.locator('[data-settlement-state="processing"]')).toBeVisible();

  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect.poll(getRequests).toBe(3);

  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    document.dispatchEvent(new Event('visibilitychange'));
    Object.defineProperty(document, 'hidden', { configurable: true, value: false });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect.poll(getRequests).toBe(4);

  const initialLoadCount = Number(await page.getByTestId('settlement-load-count').textContent());
  await page.getByTestId('reconnect-settlement-channel').click();
  await expect(page.locator('[data-settlement-state="completed"]')).toBeVisible();
  await expect(page.getByTestId('settlement-load-count')).toHaveText(String(initialLoadCount + 1));
  await expect(page.getByTestId('settlement-channel-count')).toHaveText('0');
  expect(getRequests()).toBe(5);

  await page.clock.runFor(5 * 60_000);
  expect(getRequests()).toBe(5);
});

test('manual Check for morning remains available and terminal unavailable unsubscribes', async ({ page }) => {
  const { getRequests } = await openProbe(page, (request) => request >= 2 ? 'unavailable' : 'processing');

  await expect(page.getByRole('button', { name: 'Check for morning' })).toBeVisible();
  const initialLoadCount = Number(await page.getByTestId('settlement-load-count').textContent());
  await page.getByRole('button', { name: 'Check for morning' }).click();

  await expect(page.locator('[data-settlement-state="unavailable"]')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Overnight report unavailable' })).toBeVisible();
  await expect(page.getByTestId('settlement-load-count')).toHaveText(String(initialLoadCount + 1));
  await expect(page.getByTestId('settlement-channel-count')).toHaveText('0');
  expect(getRequests()).toBe(2);
});
