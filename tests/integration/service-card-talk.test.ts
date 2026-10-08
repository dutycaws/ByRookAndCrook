import {afterEach,describe,it,expect} from 'vitest';
import {createBrewedTavern} from '../helpers/brewed-tavern';
import {createBakedTavern} from '../helpers/baked-tavern';
import {fixtureProvider} from '../helpers/dialogue-provider';
import {fixturePromptRegistry} from '../helpers/prompt-registry-fixture';
import {runDialogue} from '../../src/lib/server/dialogue/orchestrator';
import {parseBarSnapshot} from '../../src/lib/game/serving';
import {serviceCardStacks} from '../../src/lib/game/service-cards';
const players:Array<Awaited<ReturnType<typeof createBrewedTavern>>|Awaited<ReturnType<typeof createBakedTavern>>>=[];
afterEach(async()=>{await Promise.all(players.splice(0).map(player=>player.admin.auth.admin.deleteUser(player.userId)));});
const promptRegistry=fixturePromptRegistry();
async function bar(player:typeof players[number]) {
 const r=await player.client.rpc('npc_bar_summary');if(r.error)throw r.error;
 const stock=parseBarSnapshot(r.data!)!;
 const roster=await (player.client.rpc as any)('npc_roster',{p_limit:20,p_cursor:null,p_query:null});if(roster.error)throw roster.error;
 stock.roster=roster.data as any;return stock;
}
describe('inventory service-card Talk transaction',()=>{
 for(const kind of ['beverage','food'] as const) it(`serves one actual crafted ${kind} with provenance, retry and reward parity`,async()=>{
  const player=kind==='beverage'?await createBrewedTavern('service-talk-drink'):await createBakedTavern('service-talk-food');players.push(player);
  const before=await bar(player);const resident=before.roster[0];
  const [stack]=serviceCardStacks(kind==='beverage'?before.beverages:before.foods);
  expect(stack).toMatchObject({ingredientType:'fennel',quantity:1});
  expect(stack.name).toBe(kind==='food'?'Fennel Bread':'Fennel Mead');
  const command={turnId:crypto.randomUUID(),npcId:resident.npcId,message:'Please accept this offering while we talk.',expectedConversationSequence:resident.sequence,interactionVersion:'dialogue-v2' as const,offering:{kind,itemId:stack.itemIds[0]}};
  await expect(runDialogue(player.admin,player.userId,command,fixtureProvider({failStage:'speak'}),{promptRegistry})).rejects.toThrow();
  const context=await player.admin.rpc('npc_dialogue_context',{p_actor:player.userId,p_turn_id:command.turnId,p_category:'base'});
  expect(context.error).toBeNull();expect((context.data as any).hospitality).toMatchObject({itemId:stack.itemIds[0],itemName:stack.name,ingredientType:'fennel',ingredientName:'Fennel',qualityIndex:stack.qualityIndex,productKey:stack.productKey});
  expect(JSON.stringify((context.data as any).hospitality)).not.toMatch(/ingredientQuality|sourceQuality|batchId/);
  const failed=await bar(player);expect(failed.save.gold).toBe(before.save.gold);expect([...failed.foods,...failed.beverages].map(item=>item.id)).toContain(stack.itemIds[0]);
  const completed=await runDialogue(player.admin,player.userId,command,fixtureProvider(),{promptRegistry});
  const receipt=(completed.result as any).serving;
  expect(receipt).toMatchObject({itemId:stack.itemIds[0],itemName:stack.name,ingredientType:'fennel',ingredientName:'Fennel',qualityIndex:stack.qualityIndex,goldEarned:[1,3,6,10,16,25,40][stack.qualityIndex]});
  const after=await bar(player);expect(after.save.gold).toBe(before.save.gold+receipt.goldEarned);expect(after.intentCards).toHaveLength(before.intentCards.length);expect([...after.foods,...after.beverages].map(item=>item.id)).not.toContain(stack.itemIds[0]);
  const replay=await runDialogue(player.admin,player.userId,command,fixtureProvider(),{promptRegistry});expect(replay.result).toEqual(completed.result);expect((await bar(player)).save.gold).toBe(after.save.gold);
  const history=await (player.client.rpc as any)('npc_hospitality_history',{p_instance_ids:[resident.instanceId]});expect(history.error).toBeNull();expect(history.data).toHaveLength(1);expect(history.data[0]).toMatchObject({itemName:stack.name,ingredientType:'fennel',ingredientName:'Fennel'});
  await expect(runDialogue(player.admin,player.userId,{...command,turnId:crypto.randomUUID(),expectedConversationSequence:resident.sequence+1},fixtureProvider(),{promptRegistry})).rejects.toThrow();expect((await bar(player)).save.gold).toBe(after.save.gold);
 });
 it('rejects competing service and conversation cards before any resource is spent',async()=>{
  const player=await createBrewedTavern('service-conflicting-card');players.push(player);const before=await bar(player);
  await expect(runDialogue(player.admin,player.userId,{turnId:crypto.randomUUID(),npcId:before.roster[0].npcId,message:'An offering.',expectedConversationSequence:0,interactionVersion:'dialogue-v2',intentCardId:before.intentCards[0].id,offering:{kind:'beverage',itemId:before.beverages[0].id}},fixtureProvider(),{promptRegistry})).rejects.toThrow();
  const after=await bar(player);expect(after.save).toEqual(before.save);expect(after.beverages).toEqual(before.beverages);expect(after.intentCards).toEqual(before.intentCards);
 });
});
