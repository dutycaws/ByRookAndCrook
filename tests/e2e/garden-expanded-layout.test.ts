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
  await expect(page.locator('[data-area-scene="garden"]')).toHaveAttribute('data-scene-ready', 'true');
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
  await expect(page.locator('[data-garden-action-menu][data-menu-pane="root"]')).toBeVisible();
}

async function closeMobileGardenActions(page: Page) {
  const close = page.getByRole('button', { name: 'Close plot actions' });
  if (await close.count()) await close.click();
  await expect(page.locator('[data-garden-action-menu]')).toHaveCount(0);
}

test('floating plot menus branch through plant, water, fertilize, and move previews', async ({ page }) => {
  test.setTimeout(60_000);
  const player = await createTestPlayer('garden-floating-menu-paths');
  try {
    await page.setViewportSize({ width: 1672, height: 930 });
    await loginAndCreate(page, player.email, player.password);
    const state = await getSnapshot(player.client);
    if (!state) throw new Error('Expected a garden snapshot.');
    execFileSync('docker', [
      'exec', 'supabase_db_by-rook-and-crook', 'psql', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1',
      '-c', `insert into public.garden_inventory(save_id,item_key,quantity) values ('${state.save.id}'::uuid,'amendment_n',3) on conflict(save_id,item_key) do update set quantity=excluded.quantity`
    ]);
    await page.reload();

    const empty = page.locator('[data-garden-cell][data-layout-key="c3"]');
    await empty.click();
    await openGardenActions(page);
    await page.locator('[data-garden-action="plant"]').click();
    const desktopParent = page.locator('[data-garden-menu-parent]');
    await expect(desktopParent).toBeVisible();
    const [parentBounds, viewportBounds] = await Promise.all([
      desktopParent.boundingBox(),
      page.locator('[data-garden-camera-viewport]').boundingBox()
    ]);
    expect(parentBounds!.x).toBeGreaterThanOrEqual(viewportBounds!.x - 1);
    expect(parentBounds!.x + parentBounds!.width).toBeLessThanOrEqual(viewportBounds!.x + viewportBounds!.width + 1);
    await desktopParent.getByRole('button', { name: 'Water' }).click();
    await expect(page.locator('[data-garden-action-menu][data-menu-pane="water"]')).toBeVisible();
    await desktopParent.getByRole('button', { name: 'Plant' }).click();
    await page.getByRole('button', { name: 'Preview planting' }).click();
    await expect(page.locator('[data-garden-action-menu][data-menu-pane="preview"]')).toContainText('Confirm Plant');
    await page.getByRole('button', { name: 'Close plot actions' }).click();

    await page.locator('[data-garden-cell][data-layout-key="c4"]').click();
    await page.locator('[data-garden-action="water"]').click();
    await page.getByLabel('Water amount').fill('17');
    await expect(page.locator('output').filter({ hasText: '17' })).toBeVisible();
    await page.locator('[data-batch-start="water"]').click();
    await page.locator('[data-garden-cell][data-layout-key="c3"]').click();
    await page.getByRole('button', { name: 'Done', exact: true }).click();
    await page.getByRole('button', { name: 'Preview water' }).click();
    await expect(page.locator('[data-garden-action-menu][data-menu-pane="preview"]')).toContainText('Confirm Water');
    await expect(page.locator('[data-garden-preview-targets]')).toContainText('c4, c3');
    await page.getByRole('button', { name: 'Close plot actions' }).click();

    await page.locator('[data-garden-cell][data-layout-key="c3"]').click();
    await page.locator('[data-garden-action="fertilize"]').click();
    await page.getByLabel('Fertilizer strength').fill('3');
    await expect(page.getByText('Heavy · 3')).toBeVisible();
    await page.getByRole('button', { name: 'Preview fertilize' }).click();
    await expect(page.locator('[data-garden-action-menu][data-menu-pane="preview"]')).toContainText('Confirm Fertilize');
    await page.getByRole('button', { name: 'Close plot actions' }).click();

    const planted = page.locator('[data-garden-cell][data-layout-key="c1"]');
    await planted.click();
    await page.locator('[data-garden-action="move"]').click();
    await empty.click();
    await expect(page.getByText('Destination: c3. Its occupant will swap.')).toBeVisible();
    await page.getByRole('button', { name: 'Preview move' }).click();
    await expect(page.locator('[data-garden-action-menu][data-menu-pane="preview"]')).toContainText('Confirm Move');
  } finally {
    await player.admin.auth.admin.deleteUser(player.userId);
  }
});

test('floating menu exposes contextual clover, removal, and compost previews', async ({ page }) => {
  const player = await createTestPlayer('garden-floating-contextual-actions');
  try {
    await loginAndCreate(page, player.email, player.password);
    let state = await getSnapshot(player.client);
    if (!state) throw new Error('Expected a garden snapshot.');
    const cloverCell = state.cells.find((cell) => cell.layoutKey === 'c3');
    const harvestCell = state.cells.find((cell) => cell.layoutKey === 'c0');
    if (!cloverCell || !harvestCell) throw new Error('Expected starter garden cells.');
    const planted = await commitGardenCommand(player.client, {
      saveId: state.save.id, actionId: crypto.randomUUID(), expectedRevision: state.save.revision,
      commandKind: 'plant', payload: { cellId: cloverCell.id, seedItemKey: 'seed_clover' }
    });
    execFileSync('docker', [
      'exec', 'supabase_db_by-rook-and-crook', 'psql', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1',
      '-c', `update public.garden_plants set growth_progress=60,age_days=3 where save_id='${state.save.id}'::uuid and cell_id='${cloverCell.id}'::uuid`
    ]);
    await harvestCrop(player.client, {
      saveId: state.save.id, cellId: harvestCell.id, actionId: crypto.randomUUID(), expectedRevision: planted.committedRevision
    });
    await page.reload();

    const clover = page.locator('[data-garden-cell][data-layout-key="c3"]');
    await clover.click();
    await page.locator('[data-garden-action="incorporate-clover"]').click();
    await page.getByRole('button', { name: 'Preview incorporation' }).click();
    await expect(page.locator('[data-garden-action-menu][data-menu-pane="preview"]')).toContainText('Confirm Incorporate clover');
    await page.getByRole('button', { name: 'Close plot actions' }).click();

    await clover.click();
    await page.locator('[data-garden-action="remove"]').click();
    await page.getByRole('button', { name: 'Preview removal' }).click();
    await expect(page.locator('[data-garden-action-menu][data-menu-pane="preview"]')).toContainText('Confirm Remove');
    await page.getByRole('button', { name: 'Close plot actions' }).click();

    await clover.click();
    await page.locator('[data-garden-action="compost"]').click();
    await page.getByRole('button', { name: 'Preview compost' }).click();
    await expect(page.locator('[data-garden-action-menu][data-menu-pane="preview"]')).toContainText('Confirm Compost');
  } finally {
    await player.admin.auth.admin.deleteUser(player.userId);
  }
});

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
    expect(geometry.width).toBeGreaterThanOrEqual(24);
    expect(geometry.height).toBeGreaterThanOrEqual(24);
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
    const expanded16 = await commitGardenCommand(player.client, {
      saveId: initialState.save.id,
      actionId: crypto.randomUUID(),
      expectedRevision: initialState.save.revision,
      commandKind: 'expand',
      payload: { plotCount: 16 }
    });
    await page.reload();
    await assertReachablePlots(page, 16);
    const fittedHexes = await page.locator('[data-garden-cell]').evaluateAll((cells) => {
      const byKey = new Map(cells.map((cell) => [cell.getAttribute('data-layout-key'), cell.getBoundingClientRect()]));
      const c1 = byKey.get('c1')!;
      const c2 = byKey.get('c2')!;
      const c4 = byKey.get('c4')!;
      return {
        sameRowGap: c2.left - c1.right,
        sameRowCenterY: Math.abs((c2.top + c2.height / 2) - (c1.top + c1.height / 2)),
        diagonalRowStep: Math.abs(c4.top - (c2.top + c2.height * 0.75))
      };
    });
    // Expansion may change fit scale; the transformed board must retain its
    // logical odd-r tessellation and keep every hit target inside the frame.
    expect(Math.abs(fittedHexes.sameRowGap)).toBeLessThanOrEqual(1);
    expect(fittedHexes.sameRowCenterY).toBeLessThanOrEqual(1);
    expect(fittedHexes.diagonalRowStep).toBeLessThanOrEqual(1);

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

test('the camera applies one world matrix to scenery, plots, and their floating-menu anchors', async ({ page }) => {
  const player = await createTestPlayer('garden-world-camera-matrix');
  try {
    await page.setViewportSize({ width: 1672, height: 930 });
    await loginAndCreate(page, player.email, player.password);
    const viewport = page.locator('[data-garden-camera-viewport]');
    const world = page.locator('[data-garden-world]');
    const anchor = page.locator('[data-garden-anchor]').first();
    const scenery = page.locator('[data-scene-layer="garden environment"]');
    const foreground = page.locator('[data-scene-layer="garden foreground foliage"]');

    expect(await Promise.all([anchor, scenery, foreground].map((locator) => locator.evaluate((node) =>
      node.closest('[data-garden-world]') === document.querySelector('[data-garden-world]')
    )))).toEqual([true, true, true]);
    expect(await page.locator('[data-garden-camera-controls]').evaluate((node) => !node.closest('[data-garden-world]'))).toBe(true);

    await page.getByRole('button', { name: 'Zoom in garden' }).click();
    await expect(viewport).toHaveAttribute('data-garden-camera-zoom', '125');
    // The control intentionally uses a short transform transition. Measure
    // pan after that same matrix has settled rather than midway through zoom.
    await page.waitForTimeout(220);
    const beforePan = await Promise.all([world, anchor, scenery].map((locator) => locator.boundingBox()));
    const cameraFrame = await viewport.boundingBox();
    if (!cameraFrame) throw new Error('Expected a garden camera frame.');
    await page.mouse.move(cameraFrame.x + cameraFrame.width / 2, cameraFrame.y + cameraFrame.height / 2);
    await page.mouse.down();
    await page.mouse.move(cameraFrame.x + cameraFrame.width / 2 + 94, cameraFrame.y + cameraFrame.height / 2 + 40, { steps: 3 });
    await page.mouse.up();
    const afterPan = await Promise.all([world, anchor, scenery].map((locator) => locator.boundingBox()));

    const [worldBefore, anchorBefore, sceneryBefore] = beforePan;
    const [worldAfter, anchorAfter, sceneryAfter] = afterPan;
    expect(worldBefore && anchorBefore && sceneryBefore && worldAfter && anchorAfter && sceneryAfter).toBeTruthy();
    expect(anchorAfter!.x - anchorBefore!.x).toBeCloseTo(worldAfter!.x - worldBefore!.x, 1);
    expect(sceneryAfter!.x - sceneryBefore!.x).toBeCloseTo(worldAfter!.x - worldBefore!.x, 1);
    const frame = await viewport.boundingBox();
    expect(anchorAfter!.x).toBeGreaterThanOrEqual(frame!.x - 1);
    expect(anchorAfter!.x + anchorAfter!.width).toBeLessThanOrEqual(frame!.x + frame!.width + 1);
  } finally {
    await player.admin.auth.admin.deleteUser(player.userId);
  }
});

test('a floating menu follows a transformed plot anchor and dismisses once it leaves the camera frame', async ({ page }) => {
  const player = await createTestPlayer('garden-camera-menu-anchor');
  try {
    await page.setViewportSize({ width: 1672, height: 930 });
    await loginAndCreate(page, player.email, player.password);
    const viewport = page.locator('[data-garden-camera-viewport]');
    const plot = page.locator('[data-garden-cell][data-layout-key="c1"]');
    const anchor = page.locator('[data-garden-anchor]').filter({ has: plot });
    await plot.click();
    const menu = page.locator('[data-garden-action-menu]');
    await expect(menu).toBeVisible();
    expect(await menu.evaluate((node) => !node.closest('[data-garden-world]'))).toBe(true);

    const anchorBox = await anchor.boundingBox();
    if (!anchorBox) throw new Error('Expected a plot anchor.');
    await page.mouse.move(anchorBox.x + anchorBox.width / 2, anchorBox.y + anchorBox.height / 2);
    await page.mouse.wheel(0, -300);
    await expect(viewport).not.toHaveAttribute('data-garden-camera-zoom', '100');
    await page.waitForTimeout(80);
    const [menuBox, movedAnchor, frame] = await Promise.all([menu.boundingBox(), anchor.boundingBox(), viewport.boundingBox()]);
    expect(menuBox && movedAnchor && frame).toBeTruthy();
    expect(menuBox!.x).toBeGreaterThanOrEqual(frame!.x - 1);
    expect(menuBox!.x + menuBox!.width).toBeLessThanOrEqual(frame!.x + frame!.width + 1);
    expect(Math.min(Math.abs(menuBox!.x - movedAnchor!.x - movedAnchor!.width), Math.abs(menuBox!.x + menuBox!.width - movedAnchor!.x))).toBeLessThanOrEqual(14);

    // Start from the hex so the menu sees a deliberate board gesture; camera
    // capture starts only after the drag threshold and moves it out of frame.
    await page.mouse.move(movedAnchor!.x + movedAnchor!.width / 2, movedAnchor!.y + movedAnchor!.height / 2);
    await page.mouse.down();
    await page.mouse.move(movedAnchor!.x - frame!.width, movedAnchor!.y, { steps: 4 });
    await page.mouse.up();
    await expect(menu).toHaveCount(0);
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
    await closeMobileGardenActions(page);
    let status = await visibleGardenStatus(page);
    await expect(status.getByRole('region', { name: 'Three-day forecast' })).toBeVisible();
    await expect(status.getByRole('region', { name: 'Threatened plots' })).toHaveCount(0);

    const waterlogged = page.locator('[data-garden-cell][data-layout-key="c4"]');
    await expect(waterlogged).toHaveAttribute('aria-label', /needs attention: Waterlogged soil/i);
    await expect(waterlogged.locator('[data-garden-attention]')).toHaveText('!');
    await waterlogged.focus();
    await page.keyboard.press('Enter');
    await openGardenActions(page);
    await expect(page.locator('[data-garden-action-menu]')).toContainText('Plot actions');
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
    await expect(page.locator('[data-area-scene="garden"]')).toHaveAttribute('data-scene-ready', 'true');
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

test('floating garden menus preserve dismissal focus and use a single mobile branch', async ({ page }) => {
  const player = await createTestPlayer('garden-actions-responsive');
  try {
    await loginAndCreate(page, player.email, player.password);
    await page.setViewportSize({ width: 1600, height: 900 });

    const plot = page.locator('[data-garden-cell][data-layout-key="c1"]');
    await plot.click();
    await openGardenActions(page);

    const menu = page.locator('[data-garden-action-menu]');
    await expect(menu).toBeVisible();
    await expect(page.getByRole('button', { name: 'Close plot actions' })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(menu).toHaveCount(0);
    await expect(plot).toBeFocused();

    await plot.click();
    await page.locator('[data-garden-action="water"]').click();
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.locator('[data-garden-menu-parent]')).toHaveCount(0);
    await expect(menu).toContainText(/c1\s*\/\s*Water/);
    await page.keyboard.press('Escape');
    await expect(menu).toContainText('Plot actions');
    await page.keyboard.press('Escape');
    await expect(menu).toHaveCount(0);
    await expect(plot).toBeFocused();
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
    await cloverCell.click();
    await expect(cloverCell).toHaveAttribute('aria-pressed', 'true');
    await openGardenActions(page);
    await page.locator('[data-garden-action="plant"]').click();
    await page.getByRole('button', { name: 'Preview planting' }).click();
    await expect(page.locator('[data-garden-action-menu][data-menu-pane="preview"]')).toContainText('Confirm Plant');
    await page.locator('[data-garden-confirm="plant"]').click();
    await expect(page.locator('[data-garden-action-menu]').getByRole('status')).toContainText(/planted|complete/i);
    await expect(page.locator('[data-garden-cell][data-layout-key="c3"]')).toHaveAttribute('aria-label', /Clover/);

    await page.locator('[data-garden-action="water"]').click();
    await page.locator('[data-batch-start="water"]').click();
    await expect(page.getByRole('region', { name: 'Batch care selection' })).toContainText('selected for water');
    await page.locator('[data-garden-cell][data-layout-key="c4"]').click();
    await page.getByRole('button', { name: 'Done', exact: true }).click();
    await page.getByRole('button', { name: 'Cancel selection' }).click();
    await page.locator('[data-batch-start="water"]').click();
    await expect(cloverCell).toBeFocused();
    await page.keyboard.press('ArrowRight');
    const secondBatchPlot = page.locator('[data-garden-cell][data-layout-key="c4"]');
    await expect(secondBatchPlot).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.locator('[data-garden-action-menu][data-menu-pane="water"]')).toBeVisible();
    await page.getByRole('button', { name: 'Done', exact: true }).click();
    await page.getByLabel('Water amount').fill('7');
    await page.getByRole('button', { name: 'Preview water' }).click();
    await expect(page.locator('[data-garden-preview-targets]')).toContainText('c3, c4');

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
    await page.locator('[data-garden-confirm="water"]').click();
    await expect(page.locator('[data-garden-action-menu]').getByRole('alert')).toContainText('outcome is unknown');
    await page.locator('[data-garden-confirm="water"]').click();
    await expect(page.locator('[data-garden-action-menu]').getByRole('status')).toContainText(/watered|complete/i);
    await expect(cloverCell).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('[data-garden-action-menu]')).toBeVisible();
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
    await compostCell.click();
    await expect(compostCell).toHaveAttribute('aria-pressed', 'true');
    await openGardenActions(page);

    await page.locator('[data-garden-action="move"]').click();
    await page.locator('[data-garden-cell][data-layout-key="c4"]').click();
    await page.getByRole('button', { name: 'Preview move' }).click();
    await expect(page.locator('[data-garden-action-menu][data-menu-pane="preview"]')).toContainText('Confirm Move');
    await page.getByRole('button', { name: 'Close plot actions' }).click();
    await compostCell.click();

    await page.locator('[data-garden-action="incorporate-clover"]').click();
    await expect(page.getByText('Established clover is sacrificed and releases local soil benefits over three days.')).toBeVisible();
    await page.getByRole('button', { name: 'Preview incorporation' }).click();
    await expect(page.locator('[data-garden-action-menu][data-menu-pane="preview"]')).toContainText('Confirm Incorporate clover');
    await page.getByRole('button', { name: 'Close plot actions' }).click();
    await compostCell.click();

    await page.locator('[data-garden-action="remove"]').click();
    await expect(page.getByText('This removes the plant permanently.')).toBeVisible();
    await page.getByRole('button', { name: 'Preview removal' }).click();
    await expect(page.locator('[data-garden-action-menu][data-menu-pane="preview"]')).toContainText('Confirm Remove');

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
    await compostTarget.click();
    await openGardenActions(page);
    await page.locator('[data-garden-action="compost"]').click();
    const compostSelect = page.getByLabel('Ingredient batch');
    await expect(compostSelect).toBeVisible();
    await expect(compostSelect.locator(`option[value="${harvest0.ingredientBatchId}"]`)).toHaveCount(0);
    await expect(compostSelect.locator(`option[value="${harvest1.ingredientBatchId}"]`)).toHaveCount(1);
  } finally {
    await player.admin.auth.admin.deleteUser(player.userId);
  }
});

test('contextual apiary controls preserve equipment, colony, feed, honey, and treatment rules', async ({ page }) => {
  test.setTimeout(120_000);
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
    await c3.click();
    await openGardenActions(page);
    await page.locator('[data-garden-action="apiary"]').click();
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
    await c5.click();
    await openGardenActions(page);
    await page.locator('[data-garden-action="apiary"]').click();
    await page.getByRole('button', { name: 'Preview hive installation' }).click();
    await page.getByRole('button', { name: 'Apply install hive' }).click();
    await expect(page.locator('[data-apiary-inspector]')).toContainText('Empty');

    await closeMobileGardenActions(page);
    const c2 = page.locator('[data-garden-cell][data-layout-key="c2"]');
    await c2.click();
    await openGardenActions(page);
    await page.locator('[data-garden-action="apiary"]').click();
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
