import {afterEach,describe,it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createBrewedTavern} from '../helpers/brewed-tavern';
import {getLocalTestDatabaseContainer} from '../helpers/local-supabase';
import {runDialogue} from '../../src/lib/server/dialogue/orchestrator';
import {fixtureProvider} from '../helpers/dialogue-provider';
import {fixturePromptRegistry} from '../helpers/prompt-registry-fixture';
const players:Array<Awaited<ReturnType<typeof createBrewedTavern>>>=[];
afterEach(async()=>{await Promise.all(players.splice(0).map(player=>player.admin.auth.admin.deleteUser(player.userId)));});
describe('targeted Resolve inventory cleanup',()=>{
 it('executes the migration cleanup against obsolete stock without resetting save, quests, residents or replies',async()=>{
  const player=await createBrewedTavern('resolve-migration-preservation');players.push(player);
  const roster=await (player.client.rpc as any)('npc_roster',{p_limit:20});if(roster.error)throw roster.error;const resident=roster.data[0];
  await runDialogue(player.admin,player.userId,{turnId:crypto.randomUUID(),npcId:resident.npcId,message:'How are you this evening?',expectedConversationSequence:0,interactionVersion:'dialogue-v2'},fixtureProvider(),{promptRegistry:fixturePromptRegistry()});
  const migration=readFileSync(new URL('../../supabase/migrations/20261005130442_issue_37_scene_cards.sql',import.meta.url),'utf8');
  const cleanup=migration.slice(migration.indexOf('-- Old completed receipts'),migration.indexOf('create or replace function public.complete_brew('));
  const sql=`begin;
  create temporary table preservation_before as select
   (select to_jsonb(s) from public.tavern_saves s where s.id='${player.saveId}') save,
   (select jsonb_agg(to_jsonb(q) order by q.id) from private.world_quests q where q.save_id='${player.saveId}') quests,
   (select jsonb_agg(to_jsonb(r) order by r.id) from private.world_npc_instances r where r.save_id='${player.saveId}') residents,
   (select jsonb_agg(result order by id) from private.world_npc_dialogue_turns where save_id='${player.saveId}') replies,
   (select count(*) from public.intent_cards where save_id='${player.saveId}' and card_key<>'resolve') card_count;
  alter table public.intent_card_catalog drop constraint intent_card_catalog_card_key_check;
  alter table public.intent_card_catalog add constraint intent_card_catalog_card_key_check check(card_key in ('charm','insight','flirt','rumor','resolve'));
  insert into public.intent_card_catalog values('resolve','intent-v1','Resolve','Legacy card','Legacy approach');
  insert into public.intent_cards(save_id,card_key,tier,source_kind,source_key) values('${player.saveId}','resolve','fine','starter','migration-obsolete-resolve');
  ${cleanup}
  do $verify$ begin
   if exists(select 1 from public.intent_cards where card_key='resolve') then raise exception 'Resolve stock retained';end if;
   if (select save from preservation_before) is distinct from (select to_jsonb(s) from public.tavern_saves s where s.id='${player.saveId}') then raise exception 'Save reset';end if;
   if (select quests from preservation_before) is distinct from (select jsonb_agg(to_jsonb(q) order by q.id) from private.world_quests q where q.save_id='${player.saveId}') then raise exception 'Quest progress reset';end if;
   if (select residents from preservation_before) is distinct from (select jsonb_agg(to_jsonb(r) order by r.id) from private.world_npc_instances r where r.save_id='${player.saveId}') then raise exception 'Resident progress reset';end if;
   if (select replies from preservation_before) is distinct from (select jsonb_agg(result order by id) from private.world_npc_dialogue_turns where save_id='${player.saveId}') then raise exception 'Reply history reset';end if;
   if (select card_count from preservation_before)<>(select count(*) from public.intent_cards where save_id='${player.saveId}') then raise exception 'Unrelated cards removed';end if;
  end $verify$;
  rollback;`;
  expect(()=>execFileSync('docker',['exec','-i',getLocalTestDatabaseContainer(),'psql','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1'],{input:sql})).not.toThrow();
 });
});
