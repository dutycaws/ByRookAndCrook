import { expect, test } from '@playwright/test';
import { createBrewedTavern } from '../helpers/brewed-tavern';

type Resident = { instanceId: string; name: string };

test('the archived resident selector updates the read-only inspector and honors deep links', async ({ page }) => {
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
    await page.goto(`/bar?archive=1&npc=${encodeURIComponent(deepLinkedResident.instanceId)}`);

    const selector = page.getByLabel('Select a past resident');
    const inspector = page.locator('.guest-inspector');
    await expect(selector).toBeVisible();
    await expect(selector).toBeEnabled();
    await expect(selector).toHaveValue(deepLinkedResident.instanceId);
    await expect(inspector.getByRole('heading', { name: deepLinkedResident.name, exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: `Talk with ${deepLinkedResident.name}`, exact: true })).toBeAttached();
    await expect(page.getByText('Read-only archive')).toBeVisible();

    await selector.selectOption(otherResident.instanceId);
    await expect(selector).toHaveValue(otherResident.instanceId);
    await expect(inspector.getByRole('heading', { name: otherResident.name, exact: true })).toBeVisible();
    await expect(inspector.getByRole('heading', { name: deepLinkedResident.name, exact: true })).toHaveCount(0);
    await expect(page.getByRole('heading', { name: `Talk with ${otherResident.name}`, exact: true })).toBeAttached();
    await expect(inspector.getByRole('button', { name: 'Confirm dismissal' })).toHaveCount(0);
  } finally {
    await player.admin.auth.admin.deleteUser(player.userId);
  }
});
