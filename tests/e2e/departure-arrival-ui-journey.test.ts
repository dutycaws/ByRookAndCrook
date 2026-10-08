import { expect, test } from '@playwright/test';
import {
  createLiraDepartureArrivalFixture,
  resolveActiveQuestForLifecycle,
  runQuestLifecycleTransition,
  settleQuestLifecycleDay,
  type QuestLifecycleFixture
} from '../helpers/evolving-world-playable-fixture';

async function login(page: import('@playwright/test').Page, fixture: QuestLifecycleFixture) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(fixture.email);
  await page.getByLabel('Password').fill(fixture.password);
  await page.getByRole('button', { name: 'Open the ledger' }).click();
  await expect(page).toHaveURL(/\/garden$/);
}

async function closeVisibleDay(
  page: import('@playwright/test').Page,
  fixture: QuestLifecycleFixture,
  nextDay: number
) {
  const priorSettlementResult = await fixture.client.rpc('world_settlement_status', { p_save_id: fixture.saveId });
  expect(priorSettlementResult.error).toBeNull();
  const priorSettlementId = (priorSettlementResult.data as { id?: string } | null)?.id;
  const closeForm = page.locator('form[action="?/close"]');
  const closeButton = closeForm.locator('button');
  await expect(closeForm).toHaveCount(1);
  const closeResponse = page.waitForResponse((response) =>
    response.request().method() === 'POST' && new URL(response.url()).search === '?/close'
  );
  await closeButton.click();
  const actionResponse = await closeResponse;
  const actionBody = await actionResponse.text();
  expect(actionResponse.ok(), `Close action returned ${actionResponse.status()} at ${actionResponse.url()}\n${actionBody.slice(0, 1200)}`)
    .toBe(true);
  let actionResult: { type?: string } | null = null;
  try {
    actionResult = JSON.parse(actionBody) as { type?: string };
  } catch {
    // The body is included in the assertion below if the action did not return
    // the enhanced form's success payload.
  }
  expect(actionResult, `Close action did not succeed: ${actionBody.slice(0, 1200)}`).toMatchObject({ type: 'success' });

  let lastObserved: Record<string, unknown> = {};
  try {
    await expect.poll(async () => {
      const [settlementResult, saveResult] = await Promise.all([
        fixture.client.rpc('world_settlement_status', { p_save_id: fixture.saveId }),
        fixture.client.from('tavern_saves').select('current_day,revision').eq('id', fixture.saveId).single()
      ]);
      const settlement = settlementResult.data as { id?: string; dayNumber?: number; status?: string } | null;
      lastObserved = {
        pageUrl: page.url(),
        visibleMainText: (await page.locator('main').innerText().catch(() => '')).slice(0, 500),
        save: saveResult.data,
        saveError: saveResult.error?.message ?? null,
        settlement: settlementResult.data,
        settlementError: settlementResult.error?.message ?? null
      };
      return Boolean(settlement?.id && settlement.dayNumber === nextDay - 1
        && (!priorSettlementId || settlement.id !== priorSettlementId));
    }, { timeout: 20_000 }).toBe(true);
  } catch (cause) {
    throw new Error([
      `Close for nextDay=${nextDay} did not expose the expected new settlement.`,
      `POST status=${actionResponse.status()} url=${actionResponse.url()} location=${actionResponse.headers().location ?? '(none)'}`,
      `POST body=${actionBody}`,
      `last observed state=${JSON.stringify(lastObserved)}`,
      cause instanceof Error ? cause.message : String(cause)
    ].join('\n'), { cause });
  }

  await settleQuestLifecycleDay(fixture);
  await page.reload();
  await expect(page.getByText(`The common room · Day ${nextDay}`, { exact: true })).toBeVisible();
}

test('warned Lira departs to the archive and Torvin arrives when her farewell day closes', async ({ page }) => {
  test.setTimeout(120_000);
  const fixture = await createLiraDepartureArrivalFixture();
  try {
    await login(page, fixture);
    const journalResult = await fixture.client.rpc('npc_journals', { p_instance_ids: [fixture.liraInstanceId] });
    expect(journalResult.error).toBeNull();
    const liraJournal = (journalResult.data as Record<string, {
      currentQuest?: { id: string };
      questHistory?: Array<{ questId?: string; outcome: string }>;
    }>)[fixture.liraInstanceId];
    const setbacksInJournal = liraJournal.questHistory?.filter((event) => event.outcome === 'setback') ?? [];
    expect(setbacksInJournal).toHaveLength(2);
    expect(setbacksInJournal.every((event) => event.questId === liraJournal.currentQuest?.id)).toBe(true);
    await page.goto('/bar');
    const liraButton = page.getByRole('button', { name: /Speak with Lira Nightwind:/ });
    await expect(liraButton).toBeVisible();
    await liraButton.click();
    await expect(page.getByRole('button', { name: /Speak with Torvin Ashbeard:/ })).toHaveCount(0);
    await expect(page.getByText('The common room · Day 2', { exact: true })).toBeVisible();

    const setbacks = page.locator('[aria-label="Recent quest setbacks"] li');
    await expect(setbacks).toHaveCount(2);
    await expect(setbacks.nth(0)).toContainText('The first failed attempt cost time and left travelers exposed.');
    await expect(setbacks.nth(1)).toContainText('Lira has warned you once already.');

    await closeVisibleDay(page, fixture, 3);
    const terminalEventId = resolveActiveQuestForLifecycle(fixture, 3, 99);
    await closeVisibleDay(page, fixture, 4);
    const departure = await runQuestLifecycleTransition(fixture, terminalEventId, 'departure');
    expect(departure.outcome).toMatchObject({ status: 'completed', kind: 'departure' });
    expect(departure.replay).toMatchObject({ status: 'completed', terminalEventId, kind: 'departure' });
    await page.reload();
    await expect(page.getByRole('button', { name: /Speak with Lira Nightwind:/ })).toBeVisible();
    await page.getByRole('button', { name: /Speak with Lira Nightwind:/ }).click();
    await expect(page.getByRole('note').filter({ hasText: 'Leaving after the tavern closes.' })).toBeVisible();

    const beforeFarewellClose = await fixture.client.rpc('npc_roster', { p_limit: 20, p_query: 'Lira Nightwind' });
    expect(beforeFarewellClose.error).toBeNull();
    expect(beforeFarewellClose.data).toEqual(expect.arrayContaining([
      expect.objectContaining({ instanceId: fixture.liraInstanceId, name: 'Lira Nightwind' })
    ]));

    await closeVisibleDay(page, fixture, 5);
    await expect(page.getByRole('button', { name: /Speak with Lira Nightwind:/ })).toHaveCount(0);
    const torvinButton = page.getByRole('button', { name: /Speak with Torvin Ashbeard:/ });
    await expect(torvinButton).toBeVisible();
    await torvinButton.click();
    await expect(torvinButton).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('button', { name: /Speak with Lira Nightwind:/ })).toHaveCount(0);
    const playableRoster = await fixture.client.rpc('npc_roster', { p_limit: 20 });
    expect(playableRoster.error).toBeNull();
    expect(playableRoster.data).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'Torvin Ashbeard' })
    ]));
    expect(playableRoster.data).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ instanceId: fixture.liraInstanceId })
    ]));

    const archive = await fixture.client.rpc('npc_archived_roster', { p_limit: 20, p_query: 'Lira Nightwind' });
    expect(archive.error).toBeNull();
    expect(archive.data).toEqual(expect.arrayContaining([
      expect.objectContaining({ instanceId: fixture.liraInstanceId, name: 'Lira Nightwind', status: 'departed' })
    ]));
    await page.getByRole('button', { name: 'View dismissed guests' }).click();
    await expect(page).toHaveURL(/\/bar\?archive=1$/);
    await page.getByLabel('Select resident').selectOption(fixture.liraInstanceId);
    const history = page.locator('[aria-label="Quest archive"]');
    await expect(history).toBeVisible();
    await expect(history).toContainText('failed');
    await expect(history).toContainText('The first failed attempt cost time and left travelers exposed.');
    await expect(history).toContainText('Lira has warned you once already.');
  } finally {
    const deleted = await fixture.admin.auth.admin.deleteUser(fixture.userId);
    if (deleted.error && !/database error deleting user/i.test(deleted.error.message)) throw deleted.error;
  }
});
