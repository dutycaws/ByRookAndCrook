begin;
create extension if not exists pgtap with schema extensions;
select plan(28);

insert into auth.users(id,email,role,aud)
values('35100000-0000-4000-8000-000000000001','disclosure-owner@example.test','authenticated','authenticated');
set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claim.sub='35100000-0000-4000-8000-000000000001';
select public.create_tavern();
reset role;

create temporary table pg_temp.fixture as
select save_row.id save_id,save_row.user_id,save_row.current_day,save_row.revision,
  lira.id lira_instance,lira.npc_id lira_npc,lira.version_id lira_version,
  torvin.id torvin_instance,torvin.npc_id torvin_npc,torvin.version_id torvin_version
from public.tavern_saves save_row
join private.world_npc_instances lira on lira.save_id=save_row.id
join private.npc_versions lira_package on lira_package.id=lira.version_id and lira_package.sheet#>>'{identity,name}'='Lira Nightwind'
join private.world_npc_instances torvin on torvin.save_id=save_row.id
join private.npc_versions torvin_package on torvin_package.id=torvin.version_id and torvin_package.sheet#>>'{identity,name}'='Torvin Ashbeard'
where save_row.user_id='35100000-0000-4000-8000-000000000001';

select is((select lira_version from pg_temp.fixture),'18181818-1818-4181-8181-18181818181a'::uuid,'the default Lira resident uses the current authored v2 release');
select is((select torvin_version from pg_temp.fixture),'28282828-2828-4282-8282-28282828282a'::uuid,'the default Torvin resident uses the current authored v2 release');
select is((select lira.relationship from private.world_npc_instances lira join pg_temp.fixture f on f.lira_instance=lira.id),45,'Lira begins at the existing acquaintance score');
select is((select torvin.relationship from private.world_npc_instances torvin join pg_temp.fixture f on f.torvin_instance=torvin.id),45,'Torvin begins at the existing acquaintance score');

insert into private.world_npc_dialogue_turns(
  id,save_id,instance_id,npc_id,version_id,actor_id,message,input_sequence,source_revision,day_number,status,lease_until
)
select '35100000-0000-4000-8000-000000000010'::uuid,save_id,lira_instance,lira_npc,lira_version,user_id,'What do you remember about the road?',0,revision,current_day,'completed',clock_timestamp()+interval '5 minutes' from pg_temp.fixture
union all
select '35100000-0000-4000-8000-000000000011'::uuid,save_id,torvin_instance,torvin_npc,torvin_version,user_id,'What do you remember about the miners?',0,revision,current_day,'completed',clock_timestamp()+interval '5 minutes' from pg_temp.fixture;
set local request.jwt.claim.role='service_role';

select is(public.npc_dialogue_context('35100000-0000-4000-8000-000000000001','35100000-0000-4000-8000-000000000010','relationships')->>'stage','acquaintance','Lira context reports the named starting stage');
select is(public.npc_dialogue_context('35100000-0000-4000-8000-000000000001','35100000-0000-4000-8000-000000000011','relationships')->>'stage','acquaintance','Torvin context reports the named starting stage');
select is(jsonb_array_length(public.npc_dialogue_context('35100000-0000-4000-8000-000000000001','35100000-0000-4000-8000-000000000010','relationships')->'facts'),1,'Lira shares only the baseline fact at 45');
select is(jsonb_array_length(public.npc_dialogue_context('35100000-0000-4000-8000-000000000001','35100000-0000-4000-8000-000000000011','relationships')->'facts'),1,'Torvin shares only the baseline fact at 45');
select ok(not public.npc_dialogue_context('35100000-0000-4000-8000-000000000001','35100000-0000-4000-8000-000000000010','relationships')->'facts' @> '[{"id":"old-regret"}]'::jsonb,'Lira does not reveal her private regret at acquaintance');
select ok(not public.npc_dialogue_context('35100000-0000-4000-8000-000000000001','35100000-0000-4000-8000-000000000011','relationships')->'facts' @> '[{"id":"miners-debt"}]'::jsonb,'Torvin does not reveal his private debt at acquaintance');

update private.world_npc_instances set relationship=64 where id in ((select lira_instance from pg_temp.fixture),(select torvin_instance from pg_temp.fixture));
select is(public.npc_dialogue_context('35100000-0000-4000-8000-000000000001','35100000-0000-4000-8000-000000000010','relationships')->>'stage','familiar','Lira reaches familiar at 64');
select is(public.npc_dialogue_context('35100000-0000-4000-8000-000000000001','35100000-0000-4000-8000-000000000011','relationships')->>'stage','familiar','Torvin reaches familiar at 64');
select is(jsonb_array_length(public.npc_dialogue_context('35100000-0000-4000-8000-000000000001','35100000-0000-4000-8000-000000000010','relationships')->'facts'),2,'Lira can disclose one additional fact at familiar');
select is(jsonb_array_length(public.npc_dialogue_context('35100000-0000-4000-8000-000000000001','35100000-0000-4000-8000-000000000011','relationships')->'facts'),2,'Torvin can disclose one additional fact at familiar');
select ok(not public.npc_dialogue_context('35100000-0000-4000-8000-000000000001','35100000-0000-4000-8000-000000000010','relationships')->'facts' @> '[{"id":"old-regret"}]'::jsonb,'Lira still withholds her regret below 65');
select ok(not public.npc_dialogue_context('35100000-0000-4000-8000-000000000001','35100000-0000-4000-8000-000000000011','relationships')->'facts' @> '[{"id":"miners-debt"}]'::jsonb,'Torvin still withholds his debt below 65');

update private.world_npc_instances set relationship=65 where id in ((select lira_instance from pg_temp.fixture),(select torvin_instance from pg_temp.fixture));
select is(public.npc_dialogue_context('35100000-0000-4000-8000-000000000001','35100000-0000-4000-8000-000000000010','relationships')->>'stage','trusted','Lira reaches trusted at 65');
select is(public.npc_dialogue_context('35100000-0000-4000-8000-000000000001','35100000-0000-4000-8000-000000000011','relationships')->>'stage','trusted','Torvin reaches trusted at 65');
select ok(public.npc_dialogue_context('35100000-0000-4000-8000-000000000001','35100000-0000-4000-8000-000000000010','relationships')->'facts' @> '[{"id":"old-regret"}]'::jsonb,'Lira discloses her authored regret at its trust threshold');
select ok(public.npc_dialogue_context('35100000-0000-4000-8000-000000000001','35100000-0000-4000-8000-000000000011','relationships')->'facts' @> '[{"id":"miners-debt"}]'::jsonb,'Torvin discloses his authored debt at its trust threshold');
select ok(not public.npc_dialogue_context('35100000-0000-4000-8000-000000000001','35100000-0000-4000-8000-000000000010','relationships')->'facts' @> '[{"id":"scrap-map-kept"}]'::jsonb,'Lira keeps her highest-threshold memory private below 80');
select ok(not public.npc_dialogue_context('35100000-0000-4000-8000-000000000001','35100000-0000-4000-8000-000000000011','relationships')->'facts' @> '[{"id":"miners-first-ledger"}]'::jsonb,'Torvin keeps his highest-threshold memory private below 80');

update private.world_npc_instances set relationship=80 where id in ((select lira_instance from pg_temp.fixture),(select torvin_instance from pg_temp.fixture));
select is(public.npc_dialogue_context('35100000-0000-4000-8000-000000000001','35100000-0000-4000-8000-000000000010','relationships')->>'stage','close','Lira reaches close at 80');
select is(public.npc_dialogue_context('35100000-0000-4000-8000-000000000001','35100000-0000-4000-8000-000000000011','relationships')->>'stage','close','Torvin reaches close at 80');
select is(jsonb_array_length(public.npc_dialogue_context('35100000-0000-4000-8000-000000000001','35100000-0000-4000-8000-000000000010','relationships')->'facts'),4,'Lira may share all four authored facts at close');
select is(jsonb_array_length(public.npc_dialogue_context('35100000-0000-4000-8000-000000000001','35100000-0000-4000-8000-000000000011','relationships')->'facts'),4,'Torvin may share all four authored facts at close');
select ok(public.npc_dialogue_context('35100000-0000-4000-8000-000000000001','35100000-0000-4000-8000-000000000010','relationships')->'facts' @> '[{"id":"scrap-map-kept"}]'::jsonb,'Lira''s final authored memory appears only at close');
select ok(public.npc_dialogue_context('35100000-0000-4000-8000-000000000001','35100000-0000-4000-8000-000000000011','relationships')->'facts' @> '[{"id":"miners-first-ledger"}]'::jsonb,'Torvin''s final authored memory appears only at close');

select * from finish();
rollback;
