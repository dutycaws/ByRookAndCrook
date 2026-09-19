import { expect, test } from '@playwright/test';
import { createPlayableWorldFixture } from '../helpers/evolving-world-playable-fixture';
import { runDialogue } from '../../src/lib/server/dialogue/orchestrator';
import { fixtureProvider } from '../helpers/dialogue-provider';
import { fixturePromptRegistry } from '../helpers/prompt-registry-fixture';

const promptRegistry = fixturePromptRegistry();

test('a generated provision and promoted procedural resident stay playable through public shop and bar projections', async ({ page }) => {
  const fixture = await createPlayableWorldFixture();
  try {
    expect(fixture.days).toBeLessThanOrEqual(30);
    expect(fixture.drains).toBeGreaterThan(0);

    await page.goto('/login');
    await page.waitForLoadState('networkidle');
    await page.getByLabel('Email').fill(fixture.email);
    await page.getByLabel('Password').fill(fixture.password);
    await page.getByRole('button', { name: 'Open the ledger' }).click();
    await expect(page).toHaveURL(/\/garden$/);

    await page.goto('/shop');
    await page.waitForLoadState('networkidle');
    const supplies = page.locator('[aria-labelledby="generated-supplies-title"]');
    await expect(supplies.getByRole('heading', { name: 'New provisions' })).toBeVisible();
    await expect(supplies.getByRole('heading', { name: fixture.provisionName })).toHaveCount(1);
    await expect(supplies.getByLabel('Active successor quest')).toBeVisible();
    await supplies.getByRole('button', { name: 'Buy provision' }).click();
    await expect(supplies.getByRole('status')).toContainText('Provision purchased.');
    await page.reload();
    await page.waitForLoadState('networkidle');
    await expect(supplies.getByText(`1 × ${fixture.provisionName}`)).toBeVisible();
    await supplies.getByRole('button', { name: 'Prepare for quest' }).click();
    await expect(supplies.getByRole('status')).toContainText('Provision prepared for the successor quest.');
    await page.reload();
    await page.waitForLoadState('networkidle');
    await expect(supplies.getByText('1 provisions prepared')).toBeVisible();
    await expect(supplies.getByText(fixture.provisionName, { exact: true })).toHaveCount(1);

    const shopProjection = await fixture.client.rpc('world_generated_shop_projection', { p_save_id: fixture.saveId });
    expect(shopProjection.error).toBeNull();
    expect(JSON.stringify(shopProjection.data)).not.toMatch(/canonical|profile|prompt|storage|signed/i);
    expect((shopProjection.data as any).catalog).toHaveLength(1);
    expect((shopProjection.data as any).inventory).toHaveLength(0);
    expect((shopProjection.data as any).successorQuest.suppliesUsed).toBe(1);

    await page.goto('/bar');
    await expect(page.getByText(fixture.promotedNpcName, { exact: true }).first()).toBeVisible();
    const roster = await fixture.client.rpc('npc_roster', { p_limit: 20, p_query: fixture.promotedNpcName });
    expect(roster.error).toBeNull();
    const resident = (roster.data as any[]).find((entry) => entry.name === fixture.promotedNpcName);
    expect(resident).toBeTruthy();
    const journals = await fixture.client.rpc('npc_journals', { p_instance_ids: [resident.instanceId] });
    expect(journals.error).toBeNull();
    expect(resident.sceneStorageKey).toBeNull();
    expect(JSON.stringify({ roster: roster.data, journals: journals.data })).not.toMatch(/canonical|profileRevision|prompt|signedUrl/i);
    expect((roster.data as any[]).filter((entry) => entry.name === fixture.promotedNpcName)).toHaveLength(1);

    await page.route('**/api/dialogue', async (route) => {
      const result = await runDialogue(fixture.admin, fixture.userId, route.request().postDataJSON(), fixtureProvider(), { promptRegistry });
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(result) });
    });
    await page.getByText(fixture.promotedNpcName, { exact: true }).first().click();
    await page.getByLabel('Your message').fill('I thank you and advise you to scout the safer route.');
    await page.getByRole('button', { name: 'Speak', exact: true }).click();
    await expect(page.getByText('I agree. I will scout on my next outing, then try diplomacy on the following one.').first()).toBeVisible();
    const afterDialogue = await fixture.client.rpc('npc_journals', { p_instance_ids: [resident.instanceId] });
    expect(JSON.stringify(afterDialogue.data)).not.toMatch(/canonical|profile|prompt|storage|signed/i);
  } finally {
    // Procedural canonical history is intentionally append-only, so this played
    // save cannot be removed through an auth-user cascade.
  }
});
