import {expect,test,type Page,type Locator} from '@playwright/test';
import {createBrewedTavern} from '../helpers/brewed-tavern';
import {createTestPlayer} from '../helpers/local-supabase';
import {parseBarSnapshot} from '../../src/lib/game/serving';
import {runDialogue} from '../../src/lib/server/dialogue/orchestrator';
import {fixtureProvider} from '../helpers/dialogue-provider';
import {fixturePromptRegistry} from '../helpers/prompt-registry-fixture';
import type {DialogueInput} from '../../src/lib/game/dialogue';

test.use({ video: process.env.ISSUE37_CAPTURE ? 'on' : 'retain-on-failure' });
async function motionBeat(page: Page) { if (process.env.ISSUE37_CAPTURE) await page.waitForTimeout(650); }
async function capture(page: Page, label: string) {
 if (process.env.ISSUE37_CAPTURE) await page.screenshot({path:`/tmp/rook-right-folio/${test.info().project.name}-${label}.png`,fullPage:true});
}
async function openBar(page:Page,player:Pick<Awaited<ReturnType<typeof createBrewedTavern>>,'email'|'password'>){
 await page.goto('/login');await page.getByLabel('Email').fill(player.email);await page.getByLabel('Password').fill(player.password);await page.getByRole('button',{name:'Open the ledger'}).click();await expect(page).toHaveURL(/\/garden$/);await expect(page.locator('.game-shell')).toHaveAttribute('data-hydrated','true');await page.goto('/bar');
 await expect(page.locator('[data-area-scene="bar"]')).toHaveAttribute('data-scene-ready','true');
}
function residents(page:Page){return page.getByRole('group',{name:'Scene characters'}).getByRole('button');}
async function nameOf(actor:Locator){const label=await actor.getAttribute('aria-label');const name=label?.match(/Speak with (.+?): /)?.[1]??label?.replace(/^Speak with /,'');if(!name)throw Error('Resident label missing');return name;}

test('overview, focus, transient Escape and drafts connect without unrelated panels',async({page})=>{
 const player=await createBrewedTavern('bar-scene-focus');try{
  await openBar(page,player);await expect(residents(page)).toHaveCount(2);for(const actor of await residents(page).all())await expect(actor).toHaveAttribute('aria-pressed','false');await expect(page.getByRole('button',{name:'Talk',exact:true})).toHaveCount(0);
  const first=residents(page).first();await first.focus();await first.press('ArrowRight');await expect(residents(page).last()).toBeFocused();await residents(page).last().press('ArrowLeft');await expect(first).toBeFocused();const name=await nameOf(first);await first.click();await motionBeat(page);
  await expect(page.getByRole('button',{name:'Return to the tavern room',exact:true})).toBeVisible();await expect(page.getByRole('toolbar',{name:'Your intent and hospitality cards'})).toBeVisible();await expect(page.getByRole('tablist',{name:/Actions for/})).toHaveCount(0);await capture(page,'hand');
  await page.locator('[data-card-index="0"]').click();await motionBeat(page);const composer=page.getByRole('textbox',{name:`Your message to ${name}`});await composer.fill('A draft for this resident.');
  await page.locator('[data-bar-control="journal"]').click();await expect(composer).toBeHidden();await expect(page.locator('[data-bar-control="journal-close"]')).toBeFocused();await expect(page.getByRole('region',{name:`${name} journal entries`})).toBeVisible();await motionBeat(page);await capture(page,'journal');
  await page.locator('[data-bar-control="journal-close"]').press('Escape');await expect(composer).toHaveValue('A draft for this resident.');await expect(page.locator('[data-bar-control="journal"]')).toBeFocused();await composer.press('Escape');await expect(composer).toBeHidden();await expect(page.locator('[data-card-index][aria-pressed="true"]')).toBeFocused();
  await page.keyboard.press('Escape');await expect(first).toBeFocused();await expect(residents(page)).toHaveCount(2);await expect(page.getByRole('group',{name:'Keepsake display slots'})).toBeVisible();
  await residents(page).last().click();await page.locator('[data-card-index="0"]').click();await motionBeat(page);await expect(page.getByRole('textbox')).toHaveValue('');await page.getByRole('button',{name:'Close conversation'}).click();await page.locator('[data-bar-control="back"]').click();
  await page.getByRole('button',{name:new RegExp(`Speak with ${name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}`)}).click();await page.locator('[data-card-index="0"]').click();await motionBeat(page);await expect(page.getByRole('textbox')).toHaveValue('A draft for this resident.');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
 }finally{await player.admin.auth.admin.deleteUser(player.userId);}
});

test('an inventory card opens Talk directly and retries the same concrete serving exactly once',async({page})=>{
 const player=await createBrewedTavern('bar-service-retry');const commands:DialogueInput[]=[];const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));try{
  await openBar(page,player);await residents(page).last().click();await motionBeat(page);const hand=page.getByRole('toolbar',{name:'Your intent and hospitality cards'});await expect(hand).toBeVisible();
  await hand.getByRole('button').first().press('End');await expect(hand.getByRole('button').last()).toBeFocused();await hand.getByRole('button',{name:/From the cellar\. Fennel Mead/}).click();await expect(hand).toBeVisible();await expect(page.getByRole('combobox')).toHaveCount(0);await motionBeat(page);await expect(page.getByRole('textbox')).toBeVisible();
  await page.getByRole('textbox').fill('Please enjoy this drink while we talk.');await page.route('**/api/dialogue',async route=>{
   if(route.request().method()!=='POST'){await route.continue();return;}const command=route.request().postDataJSON() as DialogueInput;commands.push(command);
   const result=await runDialogue(player.admin,player.userId,command,fixtureProvider(),{promptRegistry:fixturePromptRegistry()});
   if(commands.length===1)await route.abort('failed');else await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(result)});
  });
  await page.getByRole('button',{name:'Speak & serve',exact:true}).click();await expect(page.getByRole('alert')).toBeVisible();
  await page.locator('[data-bar-control="journal"]').click();await expect(page.getByRole('textbox')).toBeHidden();await page.locator('[data-bar-control="journal-close"]').press('Escape');await expect(page.getByRole('textbox')).toHaveValue('Please enjoy this drink while we talk.');await expect(page.getByRole('alert')).toBeVisible();
  await page.getByRole('textbox').press('Escape');await expect(page.getByRole('textbox')).toBeHidden();await expect(page.getByRole('button',{name:'Return to unfinished reply'})).toBeVisible();
  await page.getByRole('button',{name:'Return to unfinished reply'}).click();await expect(page.getByRole('alert')).toBeVisible();
  await page.getByRole('button',{name:'Retry the same message'}).click();await expect(page.getByRole('alert')).toHaveCount(0);expect(commands).toHaveLength(2);expect(commands[0]).toEqual(commands[1]);expect(commands[0].intentCardId).toBeNull();expect(commands[0].offering?.itemId).toBe(player.brew.beverageId);
  await expect(page.getByRole('article',{name:/Latest exchange with/})).toContainText('Please enjoy this drink while we talk.');await expect(page.getByRole('button',{name:'Send message',exact:true})).toBeDisabled();await motionBeat(page);await capture(page,'serving-replay');
  const snapshot=await player.client.rpc('npc_bar_summary');expect(snapshot.error).toBeNull();expect((snapshot.data as any).offerings.beverages).toHaveLength(0);expect((snapshot.data as any).recent.hospitality).toHaveLength(1);
  await page.getByRole('button',{name:'Close conversation'}).click();await expect(hand.getByRole('button',{name:/From the cellar/})).toHaveCount(0);expect(errors).toEqual([]);
 }finally{await player.admin.auth.admin.deleteUser(player.userId);}
});

test('reduced motion preserves card dismissal, overview return and contextual empty keepsake slots',async({page})=>{
 await page.emulateMedia({reducedMotion:'reduce'});const player=await createBrewedTavern('bar-reduced-motion');try{
  await openBar(page,player);await residents(page).first().click();await motionBeat(page);await page.getByRole('toolbar',{name:'Your intent and hospitality cards'}).getByRole('button',{name:/From the cellar\. Fennel Mead/}).click();
  await motionBeat(page);expect(await page.locator('[data-card-index][aria-pressed="true"]').evaluate(el=>getComputedStyle(el).transform)).toBe('none');await capture(page,'reduced-motion-chat');await page.getByRole('button',{name:'Close conversation'}).click();await page.locator('[data-bar-control="back"]').click();
  const slot=page.getByRole('button',{name:/Keepsake slot 1, empty/});await slot.click();await expect(page.locator('#keepsake-manager')).toBeVisible();await page.locator('[aria-label="Close keepsake details"]').press('Escape');await expect(page.locator('#keepsake-manager')).toHaveCount(0);await expect(slot).toBeFocused();
  const snapshot=await player.client.rpc('npc_bar_summary');expect((snapshot.data as any).offerings.beverages).toHaveLength(1);expect((snapshot.data as any).recent.hospitality).toHaveLength(0);
 }finally{await player.admin.auth.admin.deleteUser(player.userId);}
});

test('an empty hand keeps crafting destinations, journal, and room return available', async ({page}) => {
 const player=await createTestPlayer('bar-empty-hand');
 try {
  const created=await player.client.rpc('create_tavern');expect(created.error).toBeNull();
  const snapshot=parseBarSnapshot((await player.client.rpc('npc_bar_summary')).data)!;
  const roster=await player.client.rpc('npc_roster',{p_limit:20});expect(roster.error).toBeNull();
  const resident=(roster.data as unknown as {npcId:string;sequence:number}[])[0];
  // Reach empty stock through real card consumption; issued cards are immutable.
  for (const [index,card] of snapshot.intentCards.entries()) await runDialogue(player.admin,player.userId,{
   turnId:crypto.randomUUID(),npcId:resident.npcId,message:'Please share news of your plans.',intentCardId:card.id,
   expectedConversationSequence:resident.sequence+index,interactionVersion:'dialogue-v2'
  },fixtureProvider(),{promptRegistry:fixturePromptRegistry()});
  await openBar(page,player);await residents(page).first().click();
  await expect(page.getByText('Your hand is empty.',{exact:false})).toBeVisible();
  const destinations=page.getByRole('navigation',{name:'Places to prepare cards'});
  await expect(destinations.getByRole('link',{name:'Shop · intent cards'})).toHaveAttribute('href','/shop');
  await expect(destinations.getByRole('link',{name:'Brewery · drinks'})).toHaveAttribute('href','/brewery');
  await expect(destinations.getByRole('link',{name:'Bakery · food'})).toHaveAttribute('href','/bakery');
  await motionBeat(page);await capture(page,'empty-hand');
  await page.locator('[data-bar-control="journal"]').click();await expect(page.getByRole('button',{name:'Close journal'})).toBeFocused();
  await page.getByRole('button',{name:'Close journal'}).press('Escape');await page.locator('[data-bar-control="back"]').click();
  await page.getByRole('button',{name:/Keepsake slot 1, empty/}).click();
  await expect(page.getByText('Your first keepsake arrives',{exact:false})).toBeVisible();await capture(page,'empty-collection');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 } finally {await player.admin.auth.admin.deleteUser(player.userId);}
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
