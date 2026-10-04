import { describe, expect, it } from 'vitest';
import { load } from '../../src/routes/(game)/bar/+page.server';
import { selectedBarPatron } from '$lib/game/bar-scene';

const torvin='11111111-1111-4111-8111-111111111111',lira='22222222-2222-4222-8222-222222222222';
const scout='33333333-3333-4333-8333-333333333333';
const failedScout={id:scout,origin:'authored_milestone',title:'Scout the camp',objective:'Map the camp and a safe approach.',outcome:'failed',activationDay:1,terminalDay:2,events:[{id:'44444444-4444-4444-8444-444444444444',day:2,outcome:'failed',text:'The camp remained concealed and the danger on the road persists.',publicNews:true}]};
async function loadBar(search='') {
  const calls:Array<{name:string;args?:Record<string,unknown>}>=[];
  const roster=[{instanceId:torvin,npcId:torvin,name:'Torvin',sceneStorageKey:''},{instanceId:lira,npcId:lira,name:'Lira',sceneStorageKey:''}];
  const pending={turnId:'55555555-5555-4555-8555-555555555555',status:'failed',message:'A pending message',error:'Saved retry state'};
  const supabase={rpc:async(name:string,args?:Record<string,unknown>)=>{
    calls.push({name,args});
    if(name==='npc_bar_summary')return {data:{save:{id:'66666666-6666-4666-8666-666666666666',revision:22,gold:25,currentDay:3},roster:[],offerings:{beverages:[],foods:[],intentCards:[]},recent:{hospitality:[],news:[],latestArrival:null}},error:null};
    if(name==='world_settlement_status')return {data:null,error:null};
    if(name==='npc_roster')return {data:roster,error:null};
    if(name==='npc_journals')return {data:{[torvin]:{npcId:torvin,status:'active',questLifecycleStatus:'active',turns:[]},[lira]:{npcId:lira,status:'active',questLifecycleStatus:'active',turns:[],pending}},error:null};
    if(name==='npc_quest_history_archive')return {data:{items:args?.p_instance_id===lira?[failedScout]:[],nextCursor:null},error:null};
    throw new Error(`Unexpected RPC ${name}`);
  }};
  const data=await load({locals:{getVerifiedUser:async()=>({id:'keeper'}),supabase},setHeaders:()=>{},url:new URL(`http://localhost/bar${search}`)} as any) as any;
  return {data,calls,pending};
}
describe('Bar locally selected resident quest archive',()=>{
  it('preloads Lira’s failed Scout archive when Torvin is first and selection changes locally',async()=>{
    const {data,calls,pending}=await loadBar();
    expect(data.snapshot.patrons[0].instanceId).toBe(torvin);
    const clicked=selectedBarPatron(data.snapshot.patrons,lira)!;
    expect(data.journals[clicked.instanceId].questArchive.items).toEqual([failedScout]);
    expect(data.journals[lira].pending).toEqual(pending);
    expect(calls.filter(c=>c.name==='npc_quest_history_archive')).toEqual([
      {name:'npc_quest_history_archive',args:{p_instance_id:torvin,p_limit:20,p_cursor:null}},
      {name:'npc_quest_history_archive',args:{p_instance_id:lira,p_limit:20,p_cursor:null}}
    ]);
  });
  it('applies the archive cursor only to the URL-selected resident',async()=>{
    const {calls}=await loadBar(`?npc=${lira}&questCursor=${scout}`);
    expect(calls.filter(c=>c.name==='npc_quest_history_archive')).toEqual([
      {name:'npc_quest_history_archive',args:{p_instance_id:torvin,p_limit:20,p_cursor:null}},
      {name:'npc_quest_history_archive',args:{p_instance_id:lira,p_limit:20,p_cursor:scout}}
    ]);
  });
});
