import { expect, test } from '@playwright/test';
import { createBrewedTavern } from '../helpers/brewed-tavern';

test('the tavern shell preserves its scene, rails, composer, and controls across target widths', async ({ page }) => {
  const player = await createBrewedTavern('visual-layout');
  const pageErrors: string[] = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  try {
    await page.goto('/login');
    await page.getByLabel('Email').fill(player.email);
    await page.getByLabel('Password').fill(player.password);
    await page.getByRole('button', { name: 'Open the ledger' }).click();
    await expect(page).toHaveURL(/\/garden$/);
    await page.goto('/bar');

    for (const viewport of [
      { width: 1440, height: 900 },
      { width: 1672, height: 941 }
    ]) {
      await page.setViewportSize(viewport);
      const dashboard = await page.locator('.tavern-dashboard').boundingBox();
      const status = await page.locator('.tavern-status-rail').boundingBox();
      const scene = await page.locator('.tavern-scene').boundingBox();
      const guest = await page.locator('.guest-inspector').boundingBox();
      const composer = await page.locator('.npc-dialogue').boundingBox();
      expect(dashboard && status && scene && guest && composer).toBeTruthy();
      expect(status!.width / dashboard!.width).toBeGreaterThan(.13);
      expect(status!.width / dashboard!.width).toBeLessThan(.22);
      expect(scene!.width / dashboard!.width).toBeGreaterThan(.5);
      expect(scene!.width / dashboard!.width).toBeLessThan(.65);
      expect(guest!.width / dashboard!.width).toBeGreaterThan(.16);
      expect(guest!.width / dashboard!.width).toBeLessThan(.26);
      expect(composer!.width / dashboard!.width).toBeGreaterThan(.98);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    }

    await expect(page.getByRole('link', { name: 'Bakery', exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Pantry', exact: true })).toBeVisible();
    const intent = page.getByRole('group', { name: 'Choose your intent' });
    await expect(intent.getByRole('button').first()).toBeVisible();
    await expect(page.getByLabel('Offer hospitality')).toBeVisible();
    await intent.getByRole('button').nth(1).click();
    await expect(intent.getByRole('button').nth(1)).toHaveAttribute('aria-pressed', 'true');

    for (const viewport of [
      { width: 768, height: 1024 },
      { width: 390, height: 844 }
    ]) {
      await page.setViewportSize(viewport);
      await expect(page.locator('.tavern-scene')).toBeVisible();
      await expect(page.getByLabel('Your message')).toBeVisible();
      await expect(page.getByRole('button', { name: 'Speak', exact: true })).toBeVisible();
      await expect(page.getByLabel('Offer hospitality')).toBeVisible();
      await expect(page.getByText(/Relationship 45 \/ 100/).first()).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    }
    await expect(page.getByRole('link', { name: 'Bakery', exact: true })).toBeInViewport();
    await expect(page.getByLabel('Keeper menu')).toBeVisible();
    await page.getByLabel('Keeper menu').click();
    await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible();
    expect(pageErrors).toEqual([]);
  } finally {
    expect((await player.admin.auth.admin.deleteUser(player.userId)).error).toBeNull();
  }
});
