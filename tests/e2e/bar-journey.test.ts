import {expect,test,type Page,type Locator} from '@playwright/test';
import {createBrewedTavern} from '../helpers/brewed-tavern';
import {runDialogue} from '../../src/lib/server/dialogue/orchestrator';
import {fixtureProvider} from '../helpers/dialogue-provider';
import {fixturePromptRegistry} from '../helpers/prompt-registry-fixture';
import type {DialogueInput} from '../../src/lib/game/dialogue';

test.use({ video: process.env.ISSUE37_CAPTURE ? 'on' : 'retain-on-failure' });
async function motionBeat(page: Page) { if (process.env.ISSUE37_CAPTURE) await page.waitForTimeout(650); }
async function openBar(page:Page,player:Awaited<ReturnType<typeof createBrewedTavern>>){
 await page.goto('/login');await page.getByLabel('Email').fill(player.email);await page.getByLabel('Password').fill(player.password);await page.getByRole('button',{name:'Open the ledger'}).click();await expect(page).toHaveURL(/\/garden$/);await expect(page.locator('.game-shell')).toHaveAttribute('data-hydrated','true');await page.goto('/bar');
 await expect(page.locator('[data-area-scene="bar"]')).toHaveAttribute('data-scene-ready','true');
}
function residents(page:Page){return page.getByRole('group',{name:'Scene characters'}).getByRole('button');}
async function nameOf(actor:Locator){const label=await actor.getAttribute('aria-label');const name=label?.match(/Speak with (.+?): /)?.[1]??label?.replace(/^Speak with /,'');if(!name)throw Error('Resident label missing');return name;}

test('overview, focus, transient Escape and drafts connect without unrelated panels',async({page})=>{
 const player=await createBrewedTavern('bar-scene-focus');try{
  await openBar(page,player);await expect(residents(page)).toHaveCount(2);for(const actor of await residents(page).all())await expect(actor).toHaveAttribute('aria-pressed','false');await expect(page.getByRole('button',{name:'Talk',exact:true})).toHaveCount(0);
  const first=residents(page).first();await first.focus();await first.press('ArrowRight');await expect(residents(page).last()).toBeFocused();await residents(page).last().press('ArrowLeft');await expect(first).toBeFocused();const name=await nameOf(first);await first.click();await motionBeat(page);
  await expect(page.getByRole('button',{name:'Back to bar',exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'Talk',exact:true})).toBeVisible();await expect(page.getByRole('tablist',{name:/Actions for/})).toHaveCount(0);
  await page.getByRole('button',{name:'Talk',exact:true}).click();await motionBeat(page);const composer=page.getByRole('textbox',{name:`Your message to ${name}`});await composer.fill('A draft for this resident.');await composer.press('Escape');await expect(composer).toBeHidden();await expect(page.locator('[data-bar-control="talk"]')).toBeFocused();
  await page.locator('[data-bar-control="back"]').click();await expect(residents(page)).toHaveCount(2);await expect(page.getByRole('group',{name:'Keepsake display slots'})).toBeVisible();
  await residents(page).last().click();await page.getByRole('button',{name:'Talk',exact:true}).click();await motionBeat(page);await expect(page.getByRole('textbox')).toHaveValue('');await page.getByRole('button',{name:'Close talk'}).click();await page.locator('[data-bar-control="back"]').click();
  await page.getByRole('button',{name:new RegExp(`Speak with ${name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}`)}).click();await page.getByRole('button',{name:'Talk',exact:true}).click();await motionBeat(page);await expect(page.getByRole('textbox')).toHaveValue('A draft for this resident.');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
 }finally{await player.admin.auth.admin.deleteUser(player.userId);}
});

test('an inventory card opens Talk directly and retries the same concrete serving exactly once',async({page})=>{
 const player=await createBrewedTavern('bar-service-retry');const commands:DialogueInput[]=[];const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));try{
  await openBar(page,player);await residents(page).last().click();await page.getByRole('button',{name:'Open the card deck',exact:true}).click();await motionBeat(page);const hand=page.getByRole('toolbar',{name:'Choose an intent or hospitality card'});await expect(hand).toBeVisible();
  await hand.getByRole('button').first().press('End');await expect(hand.getByRole('button').last()).toBeFocused();await hand.getByRole('button',{name:/From the cellar\. Fennel Mead/}).click();await expect(hand).toBeHidden();await expect(page.getByRole('combobox')).toHaveCount(0);await motionBeat(page);await expect(page.getByRole('button',{name:'Remove card'})).toBeVisible();
  await page.getByRole('textbox').fill('Please enjoy this drink while we talk.');await page.route('**/api/dialogue',async route=>{
   if(route.request().method()!=='POST'){await route.continue();return;}const command=route.request().postDataJSON() as DialogueInput;commands.push(command);
   const result=await runDialogue(player.admin,player.userId,command,fixtureProvider(),{promptRegistry:fixturePromptRegistry()});
   if(commands.length===1)await route.abort('failed');else await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(result)});
  });
  await page.getByRole('button',{name:'Speak & serve',exact:true}).click();await expect(page.getByRole('alert')).toBeVisible();await page.getByRole('button',{name:'Retry the same message'}).click();await expect(page.getByRole('alert')).toHaveCount(0);expect(commands).toHaveLength(2);expect(commands[0]).toEqual(commands[1]);expect(commands[0].intentCardId).toBeNull();expect(commands[0].offering?.itemId).toBe(player.brew.beverageId);
  const snapshot=await player.client.rpc('npc_bar_summary');expect(snapshot.error).toBeNull();expect((snapshot.data as any).offerings.beverages).toHaveLength(0);expect((snapshot.data as any).recent.hospitality).toHaveLength(1);
  await page.getByRole('button',{name:/Open the card deck/}).click();await expect(hand.getByRole('button',{name:/From the cellar/})).toHaveCount(0);expect(errors).toEqual([]);
 }finally{await player.admin.auth.admin.deleteUser(player.userId);}
});

test('reduced motion preserves card dismissal, overview return and contextual empty keepsake slots',async({page})=>{
 await page.emulateMedia({reducedMotion:'reduce'});const player=await createBrewedTavern('bar-reduced-motion');try{
  await openBar(page,player);await residents(page).first().click();await page.getByRole('button',{name:'Open the card deck',exact:true}).click();await motionBeat(page);await page.getByRole('toolbar',{name:'Choose an intent or hospitality card'}).getByRole('button',{name:/From the cellar\. Fennel Mead/}).click();
  await motionBeat(page);expect(await page.locator('.selected-card-row .tavern-card').evaluate(el=>getComputedStyle(el).animationName)).toBe('none');await page.getByRole('button',{name:'Remove card'}).click();await expect(page.getByRole('button',{name:'Remove card'})).toHaveCount(0);await page.getByRole('button',{name:'Close talk'}).click();await page.locator('[data-bar-control="back"]').click();
  const slot=page.getByRole('button',{name:/Keepsake slot 1, empty/});await slot.click();await expect(page.getByRole('dialog')).toBeVisible();await page.getByRole('dialog').press('Escape');await expect(page.getByRole('dialog')).toHaveCount(0);await expect(slot).toBeFocused();
  const snapshot=await player.client.rpc('npc_bar_summary');expect((snapshot.data as any).offerings.beverages).toHaveLength(1);expect((snapshot.data as any).recent.hospitality).toHaveLength(0);
 }finally{await player.admin.auth.admin.deleteUser(player.userId);}
});

test('End evening opens a dismissible dialog and retries the same close into settlement', async ({ page }) => {
  const player = await createBrewedTavern('bar-close-evening');
  try {
    await openBar(page, player);
    await page.getByRole('button', { name: 'End evening', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'End evening?' });
    await expect(dialog).toBeVisible();
    await dialog.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'End evening', exact: true })).toBeFocused();
    const commands: string[] = [];
    await page.route('**/bar?*/close', async (route) => {
      commands.push(route.request().postData() ?? '');
      if (commands.length === 1) await route.abort('failed');
      else await route.continue();
    });
    await page.getByRole('button', { name: 'End evening', exact: true }).click();
    await dialog.getByRole('button', { name: 'Close and begin the next day', exact: true }).click();
    await expect(dialog.getByRole('alert')).toBeVisible();
    await dialog.getByRole('button', { name: 'Retry the same close', exact: true }).click();
    await expect(page.locator('[data-settlement-state="queued"]')).toBeVisible();
    expect(commands).toHaveLength(2);
    expect(commands[0]).toBe(commands[1]);
    await expect(page.getByRole('button', { name: 'Check for morning', exact: true })).toBeVisible();
    const snapshot = await player.client.rpc('get_tavern_snapshot');
    expect((snapshot.data as any).save.currentDay).toBe(2);
  } finally {
    await player.admin.auth.admin.deleteUser(player.userId);
  }
});

test('a failed Bar load gives a focused retry and returns to the usable overview', async ({ page }) => {
  const player = await createBrewedTavern('bar-load-retry');
  try {
    await openBar(page, player);
    await page.getByRole('link', { name: 'Garden', exact: true }).click();
    await expect(page).toHaveURL(/\/garden$/);
    await page.route('**/bar/__data.json*', async (route) => {
      const response = await route.fetch();
      const body = await response.json();
      body.nodes[body.nodes.length - 1] = { type: 'error', error: { message: 'The bar journal is unavailable.' }, status: 500 };
      await route.fulfill({ response, json: body });
    });
    await page.getByRole('link', { name: 'Bar', exact: true }).click();
    const retry = page.getByRole('button', { name: 'Try this page again' });
    await expect(retry).toBeVisible();
    await expect(page.locator('#route-error-title')).toBeFocused();
    await expect(page.getByRole('link', { name: 'Return to the bar', exact: true })).toBeVisible();
    await retry.click();
    await expect(page.locator('[data-area-scene="bar"]')).toHaveAttribute('data-scene-ready', 'true');
    await expect(residents(page)).toHaveCount(2);
    await expect(page.getByRole('button', { name: 'Talk', exact: true })).toHaveCount(0);
  } finally {
    await player.admin.auth.admin.deleteUser(player.userId);
  }
});
