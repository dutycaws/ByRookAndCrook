import {describe,it,expect,vi} from 'vitest';
import {getNpcHistory} from '../../src/lib/server/npc-history';
vi.mock('$lib/server/community-npc-jobs/local-assets',()=>({localScenePublicUrl:(key:string)=>key}));
const current='11111111-1111-4111-8111-111111111111',past='22222222-2222-4222-8222-222222222222';
function client(){
 const rpc=vi.fn(async(name:string,args:any)=>{
  if(name==='npc_roster')return {data:[{instanceId:current,name:'Current resident',sceneStorageKey:'neutral-current'}],error:null};
  if(name==='npc_archived_roster')return {data:[{instanceId:past,name:'Past resident',sceneStorageKey:'neutral-past'}],error:null};
  if(name==='npc_journals')return {data:{[current]:{npcId:current,status:'active',questLifecycleStatus:'active',turns:[{turnId:'c',keeper:'Hello',npc:'Welcome',day:1}]},[past]:{npcId:past,status:'departed',questLifecycleStatus:'departed',farewellText:'Until next time.',turns:[{turnId:'p',keeper:'Farewell',npc:'Thank you',day:2}]}},error:null};
  if(name==='npc_quest_history_archive')return {data:{items:[],nextCursor:args.p_instance_id===past?'next-history':null},error:null};
  if(name==='npc_hospitality_history')return {data:[{instanceId:past,itemName:'Fennel Bread',goldEarned:16,itemKind:'food'}],error:null};
  throw new Error(`Unexpected RPC ${name}`);
 });return {rpc};
}
describe('shared NPC history reader',()=>{
 it('retains current/departed conversations, neutral artwork, archive cursor and hospitality in one contract',async()=>{
  const connection=client();const result=await getNpcHistory(connection as any,{includeArchived:true,requested:past,historyCursor:'cursor'});
  expect(result.residents.map(resident=>resident.instanceId)).toEqual([current,past]);
  expect(result.residents[1].sceneStorageKey).toBe('neutral-past');
  expect(result.journals[current].availability).toBe('present');expect(result.journals[past]).toMatchObject({availability:'departed',farewellText:'Until next time.',turns:[{id:'p',message:'Farewell',reply:'Thank you',day:2}],questArchive:{nextCursor:'next-history'}});
  expect(result.hospitality).toMatchObject([{instanceId:past,itemName:'Fennel Bread'}]);
  expect(connection.rpc).toHaveBeenCalledWith('npc_quest_history_archive',{p_instance_id:past,p_limit:20,p_cursor:'cursor'});
  expect(connection.rpc).toHaveBeenCalledWith('npc_quest_history_archive',{p_instance_id:current,p_limit:20,p_cursor:null});
 });
 it('returns the same complete history to focused Bar and Codex consumers',async()=>{
  const bar=await getNpcHistory(client() as any,{includeArchived:true});
  const codex=await getNpcHistory(client() as any,{includeArchived:true});expect(bar).toEqual(codex);
 });
 it('fails a broken history read instead of silently presenting incomplete journals',async()=>{
  const connection=client();connection.rpc.mockImplementation(async()=>({data:null,error:{message:'Ledger unavailable'}}) as any);
  await expect(getNpcHistory(connection as any,{includeArchived:true})).rejects.toMatchObject({message:'Ledger unavailable'});
 });
});
