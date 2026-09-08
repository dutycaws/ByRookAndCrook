import { expect, test } from '@playwright/test';
import { createBrewedTavern } from '../helpers/brewed-tavern';
import { runDialogue } from '../../src/lib/server/dialogue/orchestrator';
import { fixtureProvider } from '../helpers/dialogue-provider';

test('dialogue recovers a lost result, consumes hospitality once, and carries a plan overnight', async ({page}) => {
  const player = await createBrewedTavern('dialogue-browser');
  const pageErrors: string[] = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  try {
    await page.goto('/login');
    await page.getByLabel('Email').fill(player.email);
    await page.getByLabel('Password').fill(player.password);
    await page.getByRole('button', {name:'Open the ledger'}).click();
    await expect(page).toHaveURL(/\/garden$/);
    await page.goto('/bar');
    const invalid = await page.request.post('/api/dialogue', {headers:{origin:'http://127.0.0.1:3000'}, data:{message:'Missing command fields'}});
    expect(invalid.status()).toBe(400);
    expect((await page.request.post('/api/dialogue', {headers:{origin:'https://foreign.example'},data:{}})).status()).toBe(403);
    expect((await page.request.get('/api/dialogue/not-a-turn')).status()).toBe(400);

    let requests = 0;
    await page.route('**/api/dialogue', async route => {
      requests++;
      const result = await runDialogue(player.admin, player.userId, route.request().postDataJSON(), fixtureProvider());
      // A committed reply survives a lost network response.
      if (requests === 1) await route.abort('failed');
      else await route.fulfill({status:200, contentType:'application/json', body:JSON.stringify(result)});
    });
    await page.getByLabel('Your message').fill('I thank you and advise you to scout, then negotiate.');
    await page.getByLabel('Offer a drink').selectOption({index:1});
    await page.getByLabel('Enhance with a card').selectOption({index:1});
    await page.getByRole('button', {name:'Speak',exact:true}).click();
    await expect(page.getByRole('button',{name:'Check reply'})).toBeEnabled();
    await page.getByRole('button',{name:'Check reply'}).click();
    await expect(page.getByText('Your last reply was saved.')).toBeVisible();
    await expect(page.locator('.npc-exchange')).toHaveCount(1);
    await expect(page.getByLabel('Tavern gold')).toContainText('90 gold');
    await expect(page.locator('.serving-history li')).toHaveCount(1);
    await expect(page.getByLabel('Your message')).toHaveValue('');
    await expect(page.getByLabel('Enhance with a card')).toBeDisabled();
    await page.reload();
    await expect(page.locator('.npc-exchange')).toHaveCount(1);
    await expect(page.locator('.npc-exchange')).toContainText('I agree. I will scout on my next outing, then try diplomacy on the following one.');
    await page.getByRole('button',{name:'Close and begin next day'}).click();
    await expect(page.getByText('The common room · Day 2',{exact:true})).toBeVisible();
    await expect(page.locator('.npc-intention')).toContainText('some preparation');
    await expect(page.locator('.npc-news')).toContainText('prepared for the agreed objective');
    await page.getByRole('button',{name:'Torvin Ashbeard Dwarven Merchant'}).click();
    await expect(page.locator('.npc-exchange')).toHaveCount(0);
    await expect(page.locator('.npc-intention')).toContainText('some preparation');
    expect(requests).toBe(1);
    expect(pageErrors).toEqual([]);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
    await page.evaluate(()=>window.scrollTo(0,0));
    await page.screenshot({path:`test-results/dialogue-${test.info().project.name}.png`,fullPage:true});
  } finally {
    expect((await player.admin.auth.admin.deleteUser(player.userId)).error).toBeNull();
  }
});

for (const phase of ['generating','committed','unconfirmed'] as const) {
  test(`cancelling a ${phase} reply preserves the authoritative result`, async ({page}) => {
    const player=await createBrewedTavern(`dialogue-cancel-${phase}`);
    let release!:()=>void;
    const held=new Promise<void>(resolve=>{release=resolve;});
    let ready!:()=>void;
    const reached=new Promise<void>(resolve=>{ready=resolve;});
    let finished:Promise<void>|undefined;
    try {
      await page.goto('/login');
      await page.getByLabel('Email').fill(player.email);
      await page.getByLabel('Password').fill(player.password);
      await page.getByRole('button',{name:'Open the ledger'}).click();
      await expect(page).toHaveURL(/\/garden$/);
      await page.goto('/bar');
      const fixture=fixtureProvider();
      await page.route('**/api/dialogue', route => {
        finished=(async()=>{
          try {
            const provider={async generate(...args:Parameters<typeof fixture.generate>) {
              if(phase==='generating'&&args[0]==='speak'){ready();await held;}
              return fixture.generate(...args);
            }};
            const result=await runDialogue(player.admin,player.userId,route.request().postDataJSON(),provider);
            if(phase!=='generating'){ready();await held;}
            await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(result)});
          } catch {
            await route.fulfill({status:409,contentType:'application/json',body:JSON.stringify({message:'The turn was cancelled.'})}).catch(()=>{});
          }
        })();
        return finished;
      });
      if(phase==='unconfirmed')await page.route('**/api/dialogue/*',route=>route.request().method()==='DELETE'
        ?route.fulfill({status:503,contentType:'application/json',body:'{"message":"Injected cancellation outage"}'})
        :route.continue());
      await page.getByLabel('Your message').fill('How is the quest going?');
      await page.getByLabel('Offer a drink').selectOption({index:1});
      await page.getByLabel('Enhance with a card').selectOption({index:1});
      await page.getByRole('button',{name:'Speak',exact:true}).click();
      await reached;
      await expect(page.getByRole('button',{name:'Cancel unfinished message'})).toBeEnabled();
      await page.getByRole('button',{name:'Cancel unfinished message'}).click();
      if(phase==='unconfirmed') {
        await expect(page.getByRole('alert')).toContainText('Cancellation could not be confirmed');
        await expect(page.getByLabel('Your message')).toBeDisabled();
        await page.getByRole('button',{name:'Check reply'}).click();
      }
      if(phase==='generating') {
        await expect(page.getByRole('status')).toContainText('Unfinished message cancelled.');
        await expect(page.getByLabel('Your message')).toBeEnabled();
        await expect(page.getByLabel('Your message')).toHaveValue('How is the quest going?');
      } else {
        await expect(page.getByRole('status')).toContainText('Your last reply was saved.');
        await expect(page.getByLabel('Your message')).toHaveValue('');
      }
      release();await finished;
      const stock=(await player.client.rpc('get_bar_snapshot')).data as any;
      expect(stock.history).toHaveLength(phase==='generating'?0:1);
      expect(stock.beverages).toHaveLength(phase==='generating'?1:0);
      expect(stock.cards).toHaveLength(phase==='generating'?1:0);
      await page.reload();
      await expect(page.locator('.npc-exchange')).toHaveCount(phase==='generating'?0:1);
      await expect(page.getByRole('button',{name:'Speak',exact:true})).toBeVisible();
    } finally {
      release();await finished;
      expect((await player.admin.auth.admin.deleteUser(player.userId)).error).toBeNull();
    }
  });
}

test('a rejected rewrite can be cancelled and rephrased after reloading',async({page})=>{
  const player=await createBrewedTavern('dialogue-rephrase');
  try {
    await page.goto('/login');
    await page.getByLabel('Email').fill(player.email);
    await page.getByLabel('Password').fill(player.password);
    await page.getByRole('button',{name:'Open the ledger'}).click();
    await expect(page).toHaveURL(/\/garden$/);
    await page.goto('/bar');
    let requests=0;
    await page.route('**/api/dialogue',async route=>{
      requests++;
      try {
        await runDialogue(player.admin,player.userId,route.request().postDataJSON(),fixtureProvider({rejectEveryReview:requests===1}));
        await route.abort('failed');
      } catch {
        await route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({code:'CONSISTENCY',message:'Cancel this message and rephrase it.'})});
      }
    });
    await page.getByLabel('Your message').fill('How is the quest going?');
    await page.getByRole('button',{name:'Speak',exact:true}).click();
    await expect(page.getByRole('button',{name:'Retry the same message'})).toBeDisabled();
    await page.reload();
    await expect(page.getByRole('status')).toContainText('This reply cannot be resumed.');
    await expect(page.getByRole('button',{name:'Retry the same message'})).toBeDisabled();
    await page.getByRole('button',{name:'Cancel unfinished message'}).click();
    await expect(page.getByLabel('Your message')).toBeEnabled();
    await page.getByLabel('Your message').fill('What do you know about the old road?');
    await page.getByRole('button',{name:'Speak',exact:true}).click();
    await expect(page.getByRole('button',{name:'Retry the same message'})).toBeEnabled();
    await page.getByRole('button',{name:'Check reply'}).click();
    await expect(page.getByRole('status')).toContainText('Your last reply was saved.');
    await expect(page.locator('.npc-exchange')).toHaveCount(1);
  } finally {
    expect((await player.admin.auth.admin.deleteUser(player.userId)).error).toBeNull();
  }
});
