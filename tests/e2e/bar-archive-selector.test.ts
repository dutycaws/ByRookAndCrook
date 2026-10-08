import { expect, test } from '@playwright/test';
import { createBrewedTavern } from '../helpers/brewed-tavern';

type Resident = { instanceId: string; name: string };

test('the Codex past-resident destination updates the shared read-only journal and honors deep links', async ({ page, isMobile }) => {
  const player = await createBrewedTavern('bar-archive-selector');
  try {
    const rosterResult = await player.client.rpc('npc_roster', { p_limit: 20 });
    expect(rosterResult.error).toBeNull();
    const residents = rosterResult.data as unknown as Resident[];
    expect(residents.length).toBeGreaterThanOrEqual(2);

    for (const resident of residents.slice(0, 2)) {
      const result = await player.client.rpc('npc_dismiss', { p_instance: resident.instanceId });
      expect(result.error).toBeNull();
    }

    const archiveResult = await player.client.rpc('npc_archived_roster', { p_limit: 20 });
    expect(archiveResult.error).toBeNull();
    const archived = archiveResult.data as unknown as Resident[];
    expect(archived.length).toBeGreaterThanOrEqual(2);
    const deepLinkedResident = archived[0];
    const otherResident = archived.find((resident) => resident.instanceId !== deepLinkedResident.instanceId)!;

    await page.goto('/login');
    await page.getByLabel('Email').fill(player.email);
    await page.getByLabel('Password').fill(player.password);
    await page.getByRole('button', { name: 'Open the ledger' }).click();
    await expect(page).toHaveURL(/\/garden$/);
    await expect(page.locator('.game-shell')).toHaveAttribute('data-hydrated', 'true');
    await page.goto(`/codex?section=residents&resident=${encodeURIComponent(deepLinkedResident.instanceId)}`);
    await expect(page.locator('.game-shell')).toHaveAttribute('data-hydrated', 'true');
    const picker=page.getByRole('complementary',{name:'Current and past residents'});
    if (!isMobile) await expect(page.getByRole('heading',{name:'Past residents',exact:true})).toBeVisible();
    await expect(page.getByRole('article',{name:`History for ${deepLinkedResident.name}`})).toBeVisible();
    await expect(page.getByRole('textbox')).toHaveCount(0);
    await expect(page.getByRole('button',{name:'Send message'})).toHaveCount(0);
    if (isMobile) await page.getByRole('link', { name: '← All residents', exact: true }).click();
    await picker.getByRole('link',{name:new RegExp(otherResident.name)}).click();
    await expect(page).toHaveURL(new RegExp(`resident=${otherResident.instanceId}`));
    await expect(page.getByRole('article',{name:`History for ${otherResident.name}`})).toBeVisible();
    await expect(page.getByRole('article',{name:`History for ${deepLinkedResident.name}`})).toHaveCount(0);
    await expect(page.getByRole('button',{name:'Confirm dismissal'})).toHaveCount(0);
    await page.getByRole('link', { name: 'Bar', exact: true }).click();
    await expect(page.getByRole('group', { name: 'Scene characters' }).getByRole('button')).toHaveCount(0);
    await expect(page.getByRole('status')).toContainText('The common room is quiet.');
    await expect(page.getByRole('button', { name: /Keepsake slot 1, empty/ })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Past residents', exact: true })).toBeVisible();
  } finally {
    await player.admin.auth.admin.deleteUser(player.userId);
  }
});
