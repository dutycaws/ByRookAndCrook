import {afterEach,describe,it,expect} from 'vitest';
import {execFileSync} from 'node:child_process';
import {createTestPlayer,getLocalTestDatabaseContainer} from '../helpers/local-supabase';
const players:Array<Awaited<ReturnType<typeof createTestPlayer>>>=[];
afterEach(async()=>{await Promise.all(players.splice(0).map(player=>player.admin.auth.admin.deleteUser(player.userId)));});
async function fixture(prefix:string){const player=await createTestPlayer(prefix);players.push(player);const created=await player.client.rpc('create_tavern');if(created.error)throw created.error;return {...player,saveId:(created.data as any).saveId};}
async function reports(player:typeof players[number]){const r=await (player.client.rpc as any)('codex_tavern_reports');if(r.error)throw r.error;return r.data as Array<{id:string;day:number;unread:boolean;notified:boolean;text:string;instanceId:string}>;}
describe('persistent tavern Codex reports',()=>{
 it('keeps delivery separate from read, deduplicates, and isolates taverns',async()=>{
  const owner=await fixture('codex-report-owner');const other=await fixture('codex-report-other');
  const roster=await (owner.client.rpc as any)('npc_roster',{p_limit:20,p_cursor:null,p_query:null});if(roster.error)throw roster.error;const resident=(roster.data as any)[0];
  const uuid=/^[0-9a-f-]{36}$/;expect(uuid.test(owner.saveId)&&uuid.test(resident.npcId)&&uuid.test(resident.versionId)).toBe(true);
  execFileSync('docker',['exec',getLocalTestDatabaseContainer(),'psql','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1','-c',`insert into private.world_npc_arrival_receipts(save_id,day,action_id,candidate_count,result) values('${owner.saveId}',99,'${crypto.randomUUID()}',1,jsonb_build_object('arrived',true,'npcId','${resident.npcId}','versionId','${resident.versionId}'));`]);
  const report=(await reports(owner)).find(report=>report.day===99)!;expect(report).toMatchObject({unread:true,notified:false,instanceId:resident.instanceId});expect(report.text).toContain('has arrived');
  expect((await reports(other)).map(report=>report.id)).not.toContain(report.id);
  const foreign=await (other.client.rpc as any)('codex_reports_ack',{p_report_ids:[report.id],p_read:true});expect(foreign.error).toBeNull();expect((await reports(owner)).find(item=>item.id===report.id)?.unread).toBe(true);
  const ack=()=> (owner.client.rpc as any)('codex_reports_ack',{p_report_ids:[report.id],p_read:false});expect((await ack()).error).toBeNull();expect((await ack()).error).toBeNull();
  expect((await reports(owner)).find(item=>item.id===report.id)).toMatchObject({unread:true,notified:true});
  const read=await (owner.client.rpc as any)('codex_reports_ack',{p_report_ids:[report.id],p_read:true});expect(read.error).toBeNull();expect((await reports(owner)).find(item=>item.id===report.id)).toMatchObject({unread:false,notified:true});
  expect((await reports(owner)).filter(item=>item.id===report.id)).toHaveLength(1);
 });
});
