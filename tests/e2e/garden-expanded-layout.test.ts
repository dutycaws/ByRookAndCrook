import { expect, test, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { advanceDay, commitGardenCommand, getSnapshot, harvestCrop, startBrew } from '../../src/lib/server/game';
import { createTestPlayer } from '../helpers/local-supabase';

async function loginAndCreate(page: Page, email: string, password: string) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Open the ledger' }).click();
  await page.getByRole('button', { name: 'Start tavern' }).click();
  await expect(page.getByRole('heading', { name: 'Hex garden' })).toBeVisible();
  await expect(page.locator('main')).toHaveAttribute('data-hydrated', 'true');
}

async function visibleGardenStatus(page: Page) {
  const mobileStatus = page.locator('.mobile-status');
  if (await mobileStatus.isVisible()) {
    await mobileStatus.locator(':scope > summary').click();
    return mobileStatus;
  }
  return page.locator('.desktop-status');
}

async function openGardenActions(page: Page) {
  const actions = page.getByRole('button', { name: 'Actions', exact: true });
  await actions.click();
  if (page.viewportSize()?.width && page.viewportSize()!.width <= 620) {
    await expect(page.locator('dialog[open]')).toBeVisible();
  } else {
    await expect(actions).toHaveAttribute('aria-expanded', 'true');
  }
}

async function closeMobileGardenActions(page: Page) {
  if (page.viewportSize()?.width && page.viewportSize()!.width <= 620) {
    await page.getByRole('button', { name: 'Close actions' }).click();
    await expect(page.locator('dialog[open]')).toHaveCount(0);
  }
}

async function assertReachablePlots(page: Page, count: number) {
  const cells = page.locator('[data-garden-cell]');
  await expect(cells).toHaveCount(count);
  await expect(page.locator('[data-garden-grid]')).toHaveAttribute('aria-label', `Tavern garden, ${count} unlocked plots`);
  for (let index = 0; index < count; index += 1) {
    const cell = cells.nth(index);
    await cell.scrollIntoViewIfNeeded();
    const geometry = await cell.evaluate((element) => {
      const hit = element.getBoundingClientRect();
      const viewport = element.closest('[data-garden-viewport]')!.getBoundingClientRect();
      return {
        width: hit.width,
        height: hit.height,
        reachable: hit.left >= viewport.left - 1 && hit.right <= viewport.right + 1
          && hit.top >= viewport.top - 1 && hit.bottom <= viewport.bottom + 1
      };
    });
    expect(geometry.width).toBeGreaterThanOrEqual(44);
    expect(geometry.height).toBeGreaterThanOrEqual(44);
    expect(geometry.reachable).toBe(true);
  }
}

test('the garden preserves keyboard geometry while expanding from 12 to 24 plots', async ({ page }) => {
  const player = await createTestPlayer('garden-expanded-layout');
  try {
    await loginAndCreate(page, player.email, player.password);
    await page.setViewportSize({ width: 1440, height: 900 });
    await assertReachablePlots(page, 12);
    await expect(page.locator('[data-garden-cell][data-layout-key="c12"]')).toHaveCount(0);

    const c1 = page.locator('[data-garden-cell][data-layout-key="c1"]');
    await c1.focus();
    await page.keyboard.press('ArrowRight');
    const c2 = page.locator('[data-garden-cell][data-layout-key="c2"]');
    await expect(c2).toBeFocused();
    await expect(c2).toHaveAttribute('aria-pressed', 'true');
    await page.keyboard.press('ArrowDown');
    const c5 = page.locator('[data-garden-cell][data-layout-key="c5"]');
    await expect(c5).toBeFocused();
    await expect(c5).toHaveAttribute('aria-pressed', 'true');
    await page.keyboard.press('ArrowLeft');
    await expect(page.locator('[data-garden-cell][data-layout-key="c4"]')).toBeFocused();
    await page.keyboard.press('ArrowUp');
    await expect(c1).toBeFocused();

    const initialState = await getSnapshot(player.client);
    if (!initialState) throw new Error('Expected a tavern snapshot after creation.');
    execFileSync('docker', [
      'exec', 'supabase_db_by-rook-and-crook', 'psql', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1',
      '-c', `update public.tavern_saves set gold=240 where id='${initialState.save.id}'::uuid`
    ]);
    await c1.scrollIntoViewIfNeeded();
    const original = await c1.boundingBox();
    const expanded16 = await commitGardenCommand(player.client, {
      saveId: initialState.save.id,
      actionId: crypto.randomUUID(),
      expectedRevision: initialState.save.revision,
      commandKind: 'expand',
      payload: { plotCount: 16 }
    });
    await page.reload();
    await assertReachablePlots(page, 16);
    const c1After16 = page.locator('[data-garden-cell][data-layout-key="c1"]');
    await c1After16.scrollIntoViewIfNeeded();
    const after16 = await c1After16.boundingBox();
    expect(Math.abs(after16!.x - original!.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(after16!.y - original!.y)).toBeLessThanOrEqual(1);

    const expandedState = await getSnapshot(player.client);
    if (!expandedState) throw new Error('Expected a tavern snapshot after first expansion.');
    expect(expandedState.save.revision).toBe(expanded16.committedRevision);
    await commitGardenCommand(player.client, {
      saveId: expandedState.save.id,
      actionId: crypto.randomUUID(),
      expectedRevision: expandedState.save.revision,
      commandKind: 'expand',
      payload: { plotCount: 24 }
    });
    await page.reload();
    await assertReachablePlots(page, 24);

    await page.setViewportSize({ width: 390, height: 844 });
    await assertReachablePlots(page, 24);
    await page.locator('[data-garden-cell][data-layout-key="c23"]').focus();
    await expect(page.locator('[data-garden-cell][data-layout-key="c23"]')).toBeFocused();
  } finally {
    await player.admin.auth.admin.deleteUser(player.userId);
  }
});

test('keyboard inspection exposes soil, plant, colony, forecast, and daily-report causes', async ({ page }) => {
  const player = await createTestPlayer('garden-inspection');
  try {
    await loginAndCreate(page, player.email, player.password);
    const plant = page.locator('[data-garden-cell][data-layout-key="c1"]');
    await plant.focus();
    await page.keyboard.press('Space');
    await expect(page.locator('[data-garden-inspector]')).toContainText('Fennel');
    await expect(page.locator('[data-soil-diagnostic]')).toContainText('Nitrogen');
    await expect(page.locator('[data-soil-diagnostic]')).toContainText('Site light');
    let status = await visibleGardenStatus(page);
    await expect(status.getByRole('region', { name: 'Three-day forecast' })).toBeVisible();
    await expect(status.getByRole('region', { name: 'Threatened plots' })).toHaveCount(0);

    const waterlogged = page.locator('[data-garden-cell][data-layout-key="c4"]');
    await expect(waterlogged).toHaveAttribute('aria-label', /needs attention: Waterlogged soil/i);
    await expect(waterlogged.locator('[data-garden-attention]')).toHaveText('!');
    if (!page.viewportSize()?.width || page.viewportSize()!.width > 620) await openGardenActions(page);
    await waterlogged.focus();
    await page.keyboard.press('Enter');
    await expect(waterlogged).toBeFocused();
    if (!page.viewportSize()?.width || page.viewportSize()!.width > 620) {
      await expect(page.getByRole('button', { name: 'Actions', exact: true })).toHaveAttribute('aria-expanded', 'false');
    }
    await expect(page.locator('[data-garden-inspector]')).toContainText('Pepper');
    await expect(page.locator('[data-garden-symptom]')).toContainText('Waterlogged soil');
    await expect(page.locator('[data-garden-symptom]')).toContainText("Moisture is above this species' preferred range; more water will increase stress.");

    const hive = page.locator('[data-garden-cell][data-layout-key="c2"]');
    await hive.focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('[data-apiary-inspector]')).toContainText('Equipment');
    await expect(page.getByLabel('Colony health pressures')).toContainText('Varroa');
    await expect(page.getByLabel('Colony health pressures')).toContainText('Chalkbrood');
    await expect(page.getByLabel('Colony health pressures')).toContainText('Nosema');

    const state = await getSnapshot(player.client);
    if (!state) throw new Error('Expected a tavern snapshot before day advance.');
    const colonyId = state.cells.find((cell) => cell.layoutKey === 'c2')?.hive?.colony?.id;
    if (!colonyId) throw new Error('Expected the starter colony.');
    execFileSync('docker', [
      'exec', 'supabase_db_by-rook-and-crook', 'psql', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1',
      '-c', `update public.apiary_colonies set health=20,varroa_pressure=70,threat_days=1 where id='${colonyId}'::uuid`
    ]);
    await page.reload();
    await expect(page.locator('main')).toHaveAttribute('data-hydrated', 'true');
    status = await visibleGardenStatus(page);
    const threatenedColony = page.locator('[data-garden-cell][data-layout-key="c2"]');
    await expect(threatenedColony).toHaveAttribute('aria-label', /needs attention:.*colony-loss warning/i);
    await threatenedColony.focus();
    await expect(threatenedColony).toBeFocused();
    await threatenedColony.press('Enter');
    await expect(page.locator('[data-garden-inspector]')).toContainText('Colony loss warning');
    await expect(page.locator('[data-garden-inspector]')).toContainText('Sustained starvation or severe untreated illness can permanently remove this colony.');

    const stressedState = await getSnapshot(player.client);
    if (!stressedState) throw new Error('Expected the stressed garden snapshot.');
    await advanceDay(player.client, {
      saveId: stressedState.save.id,
      actionId: crypto.randomUUID(),
      expectedRevision: stressedState.save.revision
    });
    await page.reload();
    await expect(page.locator('main')).toHaveAttribute('data-hydrated', 'true');
    status = await visibleGardenStatus(page);
    await expect(status.getByText('Latest garden report')).toBeVisible();
    await expect(status.locator('.daily-report')).toContainText('The colony may be lost after another day without corrective care.');
  } finally {
    await player.admin.auth.admin.deleteUser(player.userId);
  }
});

test('garden Actions preserve state and focus across Escape and responsive breakpoints', async ({ page }) => {
  const player = await createTestPlayer('garden-actions-responsive');
  try {
    await loginAndCreate(page, player.email, player.password);
    await page.setViewportSize({ width: 1000, height: 800 });

    const plot = page.locator('[data-garden-cell][data-layout-key="c1"]');
    await plot.focus();
    await plot.press('Enter');
    await openGardenActions(page);

    const trigger = page.getByRole('button', { name: 'Actions', exact: true });
    const firstAction = page.getByRole('button', { name: 'Add plots for water' });
    await firstAction.focus();
    await page.keyboard.press('Escape');
    await expect(trigger).toHaveAttribute('aria-expanded', 'false');
    await expect(trigger).toBeFocused();

    await openGardenActions(page);
    await firstAction.focus();
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.locator('dialog[open]')).toBeVisible();
    await expect(firstAction).toBeFocused();

    await page.setViewportSize({ width: 1000, height: 800 });
    await expect(page.locator('dialog[open]')).toHaveCount(0);
    await expect(trigger).toHaveAttribute('aria-expanded', 'true');
    await expect(firstAction).toBeFocused();

    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.locator('dialog[open]')).toBeVisible();
    await page.getByRole('button', { name: 'Close actions' }).click();
    await expect(page.locator('dialog[open]')).toHaveCount(0);
    await expect(trigger).toBeFocused();
    await page.setViewportSize({ width: 1000, height: 800 });
    await expect(trigger).toHaveAttribute('aria-expanded', 'false');
  } finally {
    await player.admin.auth.admin.deleteUser(player.userId);
  }
});

test('garden controls preview and recover replayable planting and batch care', async ({ page }) => {
  const player = await createTestPlayer('garden-care-ui');
  const actionIds: string[] = [];
  const pageErrors: Error[] = [];
  page.on('pageerror', (error) => pageErrors.push(error));
  let dropNextCommit = true;
  try {
    await loginAndCreate(page, player.email, player.password);
    const state = await getSnapshot(player.client);
    if (!state) throw new Error('Expected a tavern snapshot for care controls.');
    execFileSync('docker', [
      'exec', 'supabase_db_by-rook-and-crook', 'psql', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1',
      '-c', `insert into public.garden_inventory(save_id,item_key,quantity) values ('${state.save.id}'::uuid,'amendment_n',3) on conflict(save_id,item_key) do update set quantity=excluded.quantity`
    ]);
    await page.reload();
    await expect(page.locator('main')).toHaveAttribute('data-hydrated', 'true');

    const cloverCell = page.locator('[data-garden-cell][data-layout-key="c3"]');
    await cloverCell.focus();
    await cloverCell.press('Enter');
    await expect(cloverCell).toHaveAttribute('aria-pressed', 'true');
    await openGardenActions(page);
    await page.getByRole('button', { name: 'Preview planting' }).click();
    await expect(page.locator('[data-garden-preview]')).toContainText('plant seed');
    await page.getByRole('button', { name: 'Apply plant seed' }).click();
    await expect(page.locator('.workbench').getByRole('status')).toContainText(/complete|updated/i);
    await expect(page.locator('[data-garden-cell][data-layout-key="c3"]')).toHaveAttribute('aria-label', /Clover/);

    await page.getByRole('button', { name: 'Add plots for water' }).click();
    await expect(page.getByRole('region', { name: 'Batch care selection' })).toContainText('selected for water');
    await page.locator('[data-garden-cell][data-layout-key="c4"]').click();
    await page.getByRole('button', { name: 'Done', exact: true }).click();
    await page.getByRole('button', { name: 'Cancel batch' }).click();
    await expect(page.getByRole('button', { name: 'Add plots for water' })).toBeFocused();
    await page.getByRole('button', { name: 'Add plots for water' }).click();
    await page.locator('[data-garden-cell][data-layout-key="c4"]').click();
    await page.getByRole('button', { name: 'Done', exact: true }).click();
    await page.getByLabel('Water dose').fill('7');
    await page.getByRole('button', { name: 'Preview water' }).click();
    await expect(page.locator('[data-garden-preview]')).toContainText('target Count2');
    await expect(page.locator('[data-garden-preview]')).toContainText('same Dose Per Target7');

    await page.route(
      (url) => url.pathname === '/garden' && url.search === '?/command',
      async (route) => {
        const payload = new URLSearchParams(route.request().postData() ?? '');
        actionIds.push(payload.get('actionId') ?? '');
        if (dropNextCommit) {
          dropNextCommit = false;
          await route.fetch();
          await route.abort('failed');
          return;
        }
        await route.continue();
      }
    );
    await page.getByRole('button', { name: 'Apply water plots' }).click();
    await expect(page.locator('.workbench').getByRole('alert')).toContainText('outcome is unknown');
    await page.getByRole('button', { name: 'Retry water plots' }).click();
    await expect(page.locator('.workbench').getByRole('status')).toContainText(/complete|updated/i);
    await expect(cloverCell).toHaveAttribute('aria-pressed', 'true');
    if (page.viewportSize()?.width && page.viewportSize()!.width <= 620) {
      await expect(page.locator('dialog[open]')).toBeVisible();
    } else {
      await expect(page.getByRole('button', { name: 'Actions', exact: true })).toHaveAttribute('aria-expanded', 'true');
    }
    expect(actionIds).toHaveLength(2);
    expect(actionIds[0]).not.toBe('');
    expect(actionIds[1]).toBe(actionIds[0]);
    expect(pageErrors).toEqual([]);

  } finally {
    await player.admin.auth.admin.deleteUser(player.userId);
  }
});

test('garden lifecycle controls stay reachable and protect craft-reserved compost inputs', async ({ page }) => {
  const player = await createTestPlayer('garden-lifecycle-ui');
  try {
    await loginAndCreate(page, player.email, player.password);
    let state = await getSnapshot(player.client);
    if (!state) throw new Error('Expected a tavern snapshot for lifecycle controls.');
    const c3 = state.cells.find((cell) => cell.layoutKey === 'c3')!;
    await commitGardenCommand(player.client, {
      saveId: state.save.id,
      actionId: crypto.randomUUID(),
      expectedRevision: state.save.revision,
      commandKind: 'plant',
      payload: { cellId: c3.id, seedItemKey: 'seed_clover' }
    });
    execFileSync('docker', [
      'exec', 'supabase_db_by-rook-and-crook', 'psql', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1',
      '-c', `update public.garden_plants set growth_progress=60,age_days=3 where save_id='${state.save.id}'::uuid and cell_id='${c3.id}'::uuid`
    ]);
    await page.reload();
    await expect(page.locator('main')).toHaveAttribute('data-hydrated', 'true');
    const compostCell = page.locator('[data-garden-cell][data-layout-key="c3"]');
    await compostCell.focus();
    await compostCell.press('Enter');
    await expect(compostCell).toHaveAttribute('aria-pressed', 'true');
    await openGardenActions(page);

    await page.getByText('Move or swap c3', { exact: true }).click();
    await page.getByRole('button', { name: 'Preview move or swap' }).click();
    await expect(page.locator('[data-garden-preview]')).toContainText('move or swap');
    await expect(page.locator('[data-garden-preview]')).toContainText('Availability is checked again');

    await page.getByText('Plant lifecycle actions', { exact: true }).click();
    await page.getByRole('button', { name: 'Preview clover incorporation' }).click();
    await expect(page.locator('[data-garden-preview]')).toContainText('incorporate clover');
    await expect(page.getByText('Established clover is sacrificed and releases local soil benefits over three days.')).toBeVisible();

    await page.getByRole('button', { name: 'Preview removal' }).click();
    await expect(page.locator('[data-garden-preview]')).toContainText('remove plant');
    await expect(page.getByText('Removal is permanent. Seedlings that are too young are removed without creating compost.')).toBeVisible();

    state = await getSnapshot(player.client);
    if (!state) throw new Error('Expected a snapshot before harvest reservations.');
    const c0 = state.cells.find((cell) => cell.layoutKey === 'c0')!;
    const c1 = state.cells.find((cell) => cell.layoutKey === 'c1')!;
    const harvest0 = await harvestCrop(player.client, {
      saveId: state.save.id, cellId: c0.id, actionId: crypto.randomUUID(), expectedRevision: state.save.revision
    });
    const harvest1 = await harvestCrop(player.client, {
      saveId: state.save.id, cellId: c1.id, actionId: crypto.randomUUID(), expectedRevision: harvest0.committedRevision
    });
    await startBrew(player.client, {
      saveId: state.save.id, ingredientBatchId: harvest0.ingredientBatchId,
      actionId: crypto.randomUUID(), expectedRevision: harvest1.committedRevision
    });
    await page.reload();
    await expect(page.locator('main')).toHaveAttribute('data-hydrated', 'true');
    const compostTarget = page.locator('[data-garden-cell][data-layout-key="c3"]');
    await compostTarget.focus();
    await compostTarget.press('Enter');
    await openGardenActions(page);
    await page.getByText('Compost a pantry ingredient', { exact: true }).click();
    const compostSelect = page.getByLabel('Ingredient batch');
    await expect(compostSelect).toBeVisible();
    await expect(compostSelect.locator(`option[value="${harvest0.ingredientBatchId}"]`)).toHaveCount(0);
    await expect(compostSelect.locator(`option[value="${harvest1.ingredientBatchId}"]`)).toHaveCount(1);
  } finally {
    await player.admin.auth.admin.deleteUser(player.userId);
  }
});

test('contextual apiary controls preserve equipment, colony, feed, honey, and treatment rules', async ({ page }) => {
  const player = await createTestPlayer('garden-apiary-ui');
  try {
    await loginAndCreate(page, player.email, player.password);
    const state = await getSnapshot(player.client);
    if (!state) throw new Error('Expected a tavern snapshot for apiary controls.');
    const starterColony = state.cells.find((cell) => cell.layoutKey === 'c2')?.hive?.colony;
    if (!starterColony) throw new Error('Expected the starter colony.');
    execFileSync('docker', [
      'exec', 'supabase_db_by-rook-and-crook', 'psql', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1',
      '-c', `update public.tavern_saves set gold=150 where id='${state.save.id}'::uuid; insert into public.garden_inventory(save_id,item_key,quantity) values ('${state.save.id}'::uuid,'hive_equipment',2),('${state.save.id}'::uuid,'replacement_colony',1),('${state.save.id}'::uuid,'bee_feed',2),('${state.save.id}'::uuid,'treatment_varroa',1) on conflict(save_id,item_key) do update set quantity=excluded.quantity; update public.apiary_colonies set adults=12000,brood=3000,food_stores=100,floral_honey=12 where id='${starterColony.id}'::uuid`
    ]);
    await page.reload();
    await expect(page.locator('main')).toHaveAttribute('data-hydrated', 'true');

    const c3 = page.locator('[data-garden-cell][data-layout-key="c3"]');
    await c3.focus();
    await c3.press('Enter');
    await openGardenActions(page);
    await page.getByRole('button', { name: 'Preview hive installation' }).click();
    await expect(page.locator('[data-provision-preview]')).toContainText('available Equipment2');
    await page.getByRole('button', { name: 'Apply install hive' }).click();
    await expect(c3).toHaveAttribute('aria-label', /beehive/);
    await expect(page.locator('[data-apiary-inspector]')).toContainText('Empty');

    await page.getByRole('button', { name: 'Preview colony installation' }).click();
    await expect(page.locator('[data-provision-preview]')).toContainText('available Colonies1');
    await page.getByRole('button', { name: 'Apply install colony' }).click();
    await expect(page.locator('[data-apiary-inspector]')).toContainText('Installed');

    await closeMobileGardenActions(page);
    const c5 = page.locator('[data-garden-cell][data-layout-key="c5"]');
    await c5.scrollIntoViewIfNeeded();
    await c5.focus();
    await c5.press('Enter');
    await openGardenActions(page);
    await page.getByRole('button', { name: 'Preview hive installation' }).click();
    await page.getByRole('button', { name: 'Apply install hive' }).click();
    await expect(page.locator('[data-apiary-inspector]')).toContainText('Empty');

    await closeMobileGardenActions(page);
    const c2 = page.locator('[data-garden-cell][data-layout-key="c2"]');
    await c2.focus();
    await c2.press('Enter');
    await openGardenActions(page);
    await page.getByRole('button', { name: 'Preview feeding' }).click();
    await expect(page.locator('[data-provision-preview]')).toContainText('floral Honey After12');
    await page.getByRole('button', { name: 'Apply feed colony' }).click();
    await expect(page.locator('[data-provision-preview]')).toHaveCount(0);
    await expect(page.locator('[data-garden-inspector]')).toContainText('Purchased feed18');
    const afterFeed = await getSnapshot(player.client);
    const fedColony = afterFeed?.cells.find((cell) => cell.layoutKey === 'c2')?.hive?.colony;
    expect(fedColony?.floralHoney).toBe(12);
    expect(fedColony?.feedStores).toBe(18);

    await page.getByLabel('Honey units').fill('8');
    await page.getByRole('button', { name: 'Preview safe extraction' }).click();
    await expect(page.locator('[data-provision-preview]')).toContainText('extractable Surplus8');
    await page.getByRole('button', { name: 'Apply extract honey' }).click();
    await expect(page.locator('[data-provision-preview]')).toHaveCount(0);
    const afterHoney = await getSnapshot(player.client);
    const honey = afterHoney?.ingredients.find((batch) => batch.sourceKind === 'honey');
    expect(honey?.quantity).toBe(8);
    expect(afterHoney?.cells.find((cell) => cell.layoutKey === 'c2')?.hive?.colony?.floralHoney).toBe(4);

    const splitPreview = page.getByRole('button', { name: 'Preview colony split' });
    await splitPreview.focus();
    await splitPreview.press('Enter');
    await expect(page.locator('[data-provision-preview]')).toContainText('"adults":10000');
    await page.getByRole('button', { name: 'Apply split colony' }).press('Enter');
    await expect(page.locator('[data-provision-preview]')).toHaveCount(0);
    const afterSplit = await getSnapshot(player.client);
    expect(afterSplit?.cells.find((cell) => cell.layoutKey === 'c5')?.hive?.hasColony).toBe(true);

    await page.getByRole('button', { name: 'Preview treatment' }).click();
    await expect(page.locator('[data-provision-preview]')).toContainText('no-honey-production-or-extraction');
    await page.getByRole('button', { name: 'Apply treat colony' }).click();
    await expect(page.locator('[data-garden-inspector]')).toContainText('Varroa active');
    await expect(page.locator('[data-garden-inspector]')).toContainText('Honey production and extraction are paused.');

    await page.getByRole('button', { name: 'Preview safe extraction' }).click();
    await expect(page.locator('[data-provision-preview]').getByRole('alert')).toContainText('cannot be completed');
  } finally {
    await player.admin.auth.admin.deleteUser(player.userId);
  }
});
