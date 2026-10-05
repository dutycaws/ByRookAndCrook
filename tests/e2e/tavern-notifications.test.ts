import { expect, test } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { createBrewedTavern } from '../helpers/brewed-tavern';
import { getLocalTestDatabaseContainer } from '../helpers/local-supabase';

test.use({ video: process.env.ISSUE37_CAPTURE ? 'on' : 'retain-on-failure' });

test('a meaningful notice pauses, persists delivery, opens its report and retries read acknowledgement', async ({ page }) => {
  const player = await createBrewedTavern('tavern-notice-ui');
  try {
    const roster = await player.client.rpc('npc_roster', { p_limit: 20 });
    if (roster.error) throw roster.error;
    const resident = (roster.data as any)[0];
    for (const id of [player.saveId, resident.npcId, resident.versionId]) expect(id).toMatch(/^[0-9a-f-]{36}$/);
    execFileSync('docker', ['exec', getLocalTestDatabaseContainer(), 'psql', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-c',
      `insert into private.world_npc_arrival_receipts(save_id,day,action_id,candidate_count,result) values('${player.saveId}',99,'${crypto.randomUUID()}',1,jsonb_build_object('arrived',true,'npcId','${resident.npcId}','versionId','${resident.versionId}'));`
    ]);
    await page.clock.install();
    await page.goto('/login');
    await page.getByLabel('Email').fill(player.email);
    await page.getByLabel('Password').fill(player.password);
    await page.getByRole('button', { name: 'Open the ledger' }).click();
    await expect(page).toHaveURL(/\/garden$/);
    await expect(page.locator('.game-shell')).toHaveAttribute('data-hydrated', 'true');
    const notice = page.getByRole('region', { name: 'New tavern chronicle notice' });
    await expect(notice).toBeVisible();
    await expect(page.locator('[data-codex-nav]')).toHaveAccessibleName(/1 unread/);
    await notice.getByRole('link').focus();
    await page.clock.fastForward(7_000);
    await expect(notice).toBeVisible();
    await page.locator('[data-codex-nav]').focus();
    await page.clock.fastForward(7_000);
    await expect(notice).toHaveCount(0);
    await expect.poll(async () => {
      const reports = await player.client.rpc('codex_tavern_reports');
      return (reports.data as any[]).find((report) => report.day === 99)?.notified;
    }).toBe(true);
    await page.reload();
    await expect(notice).toHaveCount(0);
    await expect(page.locator('[data-codex-nav]')).toHaveAccessibleName(/1 unread/);

    execFileSync('docker', ['exec', getLocalTestDatabaseContainer(), 'psql', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-c',
      `insert into private.world_npc_arrival_receipts(save_id,day,action_id,candidate_count,result) select '${player.saveId}',day,gen_random_uuid(),1,jsonb_build_object('arrived',true,'npcId','${resident.npcId}','versionId','${resident.versionId}') from generate_series(100,210) day;`
    ]);
    await page.reload();
    await expect(notice).toBeVisible();
    await expect(notice.getByRole('link')).toHaveAttribute('href', /#tavern-report-/);
    let failRead = true;
    await page.route('**/api/codex/read', async (route) => {
      const body = route.request().postDataJSON();
      expect(body.reportIds.length).toBeLessThanOrEqual(100);
      if (!body.seenOnly && failRead) {
        failRead = false;
        await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ message: 'Could not save your reading place.' }) });
      } else await route.continue();
    });
    await notice.getByRole('link').click();
    await expect(page).toHaveURL(/#tavern-report-/);
    await expect(page.getByText(`${resident.name} has arrived at the tavern.`, { exact: true })).toHaveCount(112);
    await expect(page.getByRole('alert')).toContainText('Could not save');
    await page.getByRole('button', { name: 'Try again', exact: true }).click();
    await expect(page.getByRole('alert')).toHaveCount(0);
    await expect(page.locator('[data-codex-nav]')).toHaveAccessibleName('Codex');
    await page.reload();
    await expect(page.locator('[data-codex-nav]')).toHaveAccessibleName('Codex');
    await page.getByRole('link', { name: 'Bar', exact: true }).click();
    await expect(notice).toHaveCount(0);
  } finally {
    await player.admin.auth.admin.deleteUser(player.userId);
  }
});
