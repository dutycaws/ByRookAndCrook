begin;
create extension if not exists pgtap with schema extensions;
select plan(53);

select has_function('private','trinket_collection',array['uuid'],'a save-scoped collection projection is installed');
select has_function('private','trinket_effect_totals',array['uuid'],'active effect totals are game-owned');
select has_function('private','world_grant_initial_quest_trinket',array['uuid','uuid'],'first authored milestone grant is installed');
select has_function('public','npc_swap_trinket',array['uuid','uuid','smallint','uuid','bigint'],'revision-fenced collection swaps are installed');
select ok(has_function_privilege('authenticated','private.trinket_effect_totals(uuid)','execute'),'authenticated calls may read their own effect totals');
select ok(has_function_privilege('service_role','private.trinket_effect_totals(uuid)','execute'),'server calls may read effect totals');
select ok(not has_function_privilege('anon','private.trinket_effect_totals(uuid)','execute'),'anonymous callers cannot inspect effect totals');
select ok(has_function_privilege('authenticated','public.npc_swap_trinket(uuid,uuid,smallint,uuid,bigint)','execute'),'authenticated players may arrange their own keepsakes');
select ok(not has_function_privilege('anon','public.npc_swap_trinket(uuid,uuid,smallint,uuid,bigint)','execute'),'anonymous callers cannot arrange keepsakes');
select ok(has_function_privilege('service_role','private.world_grant_initial_quest_trinket(uuid,uuid)','execute'),'only the server can grant quest keepsakes');
select ok(not has_function_privilege('authenticated','private.world_grant_initial_quest_trinket(uuid,uuid)','execute'),'players cannot grant quest keepsakes directly');

insert into auth.users(id,email,role,aud) values
  ('35000000-0000-4000-8000-000000000001','trinket-owner@example.test','authenticated','authenticated'),
  ('35000000-0000-4000-8000-000000000002','trinket-other@example.test','authenticated','authenticated'),
  ('35000000-0000-4000-8000-000000000003','trinket-new-save@example.test','authenticated','authenticated');
insert into public.tavern_saves(id,user_id,current_day,revision) values
  ('35000000-0000-4000-8000-000000000011','35000000-0000-4000-8000-000000000001',4,0),
  ('35000000-0000-4000-8000-000000000012','35000000-0000-4000-8000-000000000002',4,0);

create temporary table pg_temp.trinket_fixture (
  fixture_index integer primary key,
  save_id uuid not null,
  npc_id uuid not null,
  version_id uuid not null,
  instance_id uuid not null,
  quest_id uuid not null,
  success_event_id uuid,
  trinket_id uuid
);

set local request.jwt.claim.role='service_role';
do $fixture$
declare
  source_sheet jsonb;
  source_option_ids text[];
  authored_sheet jsonb;
  reward_kind text;
  artwork text;
  save_for_fixture uuid;
  npc_for_fixture uuid;
  version_for_fixture uuid;
  resident_row record;
  quest_for_fixture uuid;
  event_row private.world_quest_events;
  index_value integer;
begin
  select version.sheet,package.capability_option_ids
    into source_sheet,source_option_ids
  from private.npc_versions version
  join private.npc_version_resident_packages package on package.version_id=version.id
  where version.id='18181818-1818-4181-8181-18181818181a';

  for index_value in 1..8 loop
    save_for_fixture:=case when index_value between 1 and 5
      then '35000000-0000-4000-8000-000000000011'::uuid
      else '35000000-0000-4000-8000-000000000012'::uuid end;
    npc_for_fixture:=('35000000-0000-4000-8000-'||lpad(index_value::text,12,'0'))::uuid;
    version_for_fixture:=('35000000-0000-4000-8001-'||lpad((100+index_value)::text,12,'0'))::uuid;

    reward_kind:=case index_value
      when 1 then 'food_revenue' when 2 then 'drink_revenue' when 3 then 'harvest_quality'
      when 4 then 'food_revenue' when 5 then 'harvest_quality' else 'drink_revenue' end;
    artwork:=case index_value
      when 1 then 'copper-leaf' when 2 then 'brass-seal' when 3 then 'seed-glass'
      when 4 then 'copper-leaf' when 5 then 'seed-glass' else 'brass-seal' end;

    authored_sheet:=jsonb_set(source_sheet,'{identity,name}',to_jsonb('Keepsake Keeper '||index_value));
    if index_value<=6 then
      authored_sheet:=jsonb_set(authored_sheet,'{campaign,initialQuestTrinket,catalogId}',to_jsonb(reward_kind));
      authored_sheet:=jsonb_set(authored_sheet,'{campaign,initialQuestTrinket,artworkId}',to_jsonb(artwork));
      authored_sheet:=jsonb_set(authored_sheet,'{campaign,initialQuestTrinket,name}',to_jsonb('Keeper Token '||index_value));
      authored_sheet:=jsonb_set(authored_sheet,'{campaign,initialQuestTrinket,dedication}',to_jsonb('A remembered deed from the first road quest, kept safe for the return journey.'::text));
    end if;

    if index_value=6 then
      authored_sheet:=jsonb_set(authored_sheet,'{campaign,milestones,0,startingPlan}', '[{"action":"attempt","approach":"scouting"}]'::jsonb);
      authored_sheet:=jsonb_set(authored_sheet,'{campaign,milestones,0,failureCondition}', '{"type":"attempt_allowance_exhausted","maxAttempts":3}'::jsonb);
      authored_sheet:=jsonb_set(authored_sheet,'{campaign,milestones,0,permanentLoss}', '{"kind":"departed","warning":"The road is becoming too dangerous for the keeper to continue.","outcome":"The keeper leaves after three failed attempts."}'::jsonb);
      authored_sheet:=jsonb_set(authored_sheet,'{campaign,milestones,0,warnings}', '[{"afterSetbacks":1,"text":"The first setback makes the road more dangerous; prepare before trying again."},{"afterSetbacks":2,"text":"One more setback will make this road too costly for the keeper to continue."}]'::jsonb);
    elsif index_value=7 then
      authored_sheet:=jsonb_set(authored_sheet,'{campaign,milestones,0,startingPlan}', '[{"action":"abandon","approach":"scouting"}]'::jsonb);
    elsif index_value=8 then
      authored_sheet:=jsonb_set(authored_sheet,'{campaign,milestones,0,startingPlan}', '[{"action":"prepare","approach":"scouting"},{"action":"attempt","approach":"scouting"}]'::jsonb);
      authored_sheet:=jsonb_set(authored_sheet,'{campaign,initialQuestTrinket}',
        (source_sheet#>'{campaign,initialQuestTrinket}')-'artworkId');
    end if;

    perform private.npc_install_first_party_release(
      npc_for_fixture,'trinket_keeper_'||index_value,100+index_value,version_for_fixture,
      'trinket_fixture_v1',1,false,authored_sheet,source_option_ids
    );
    select * into resident_row from private.world_materialize_resident_from_version(
      save_for_fixture,npc_for_fixture,version_for_fixture,4
    );
    select quest.id into quest_for_fixture from private.world_quests quest
      where quest.save_id=save_for_fixture and quest.instance_id=resident_row.instance_id
        and quest.origin='authored_milestone' and quest.authored_milestone_index=0;
    insert into pg_temp.trinket_fixture(fixture_index,save_id,npc_id,version_id,instance_id,quest_id)
    values(index_value,save_for_fixture,npc_for_fixture,version_for_fixture,resident_row.instance_id,quest_for_fixture);

    if index_value between 1 and 5 then
      perform private.world_resolve_quest_step(quest_for_fixture,4,null);
      event_row:=private.world_resolve_quest_step(quest_for_fixture,5,0);
      update pg_temp.trinket_fixture set success_event_id=event_row.id
      where fixture_index=index_value;
    elsif index_value=6 then
      perform private.world_resolve_quest_step(quest_for_fixture,4,99);
      perform private.world_resolve_quest_step(quest_for_fixture,5,99);
      event_row:=private.world_resolve_quest_step(quest_for_fixture,6,99);
      update pg_temp.trinket_fixture set success_event_id=event_row.id where fixture_index=index_value;
    elsif index_value=7 then
      event_row:=private.world_resolve_quest_step(quest_for_fixture,4,null);
      update pg_temp.trinket_fixture set success_event_id=event_row.id where fixture_index=index_value;
    end if;
  end loop;
end
$fixture$;

create temporary table pg_temp.first_party_release_fixture (
  old_save_id uuid not null,
  old_instance_id uuid not null,
  old_version_id uuid not null,
  old_package_id uuid not null,
  old_package_hash text not null,
  new_save_id uuid not null
);
do $release$
declare
  lira_id uuid;
  v1_id uuid:='18181818-1818-4181-8181-181818181819';
  v2_id uuid:='18181818-1818-4181-8181-18181818181a';
  identity_key text;
  roster_order integer;
  v1_sheet jsonb;
  v2_sheet jsonb;
  v1_options text[];
  v2_options text[];
  v1_number integer;
  v2_number integer;
  resident_row record;
  new_tavern jsonb;
  new_save_id uuid;
begin
  select catalog.npc_id,catalog.identity_key,catalog.starting_roster_order
    into lira_id,identity_key,roster_order
  from private.npc_first_party_catalog_identities catalog
  where catalog.identity_key='lira';
  select version.sheet,version.version_number,release.release_key,package.capability_option_ids
    into v1_sheet,v1_number,identity_key,v1_options
  from private.npc_versions version
  join private.npc_first_party_catalog_releases release on release.version_id=version.id
  join private.npc_version_resident_packages package on package.version_id=version.id
  where version.id=v1_id;
  perform private.npc_install_first_party_release(
    lira_id,'lira',roster_order,v1_id,identity_key,v1_number,true,v1_sheet,v1_options
  );
  select * into resident_row from private.world_materialize_resident_from_version(
    '35000000-0000-4000-8000-000000000012',lira_id,v1_id,4
  );

  select version.sheet,version.version_number,release.release_key,package.capability_option_ids
    into v2_sheet,v2_number,identity_key,v2_options
  from private.npc_versions version
  join private.npc_first_party_catalog_releases release on release.version_id=version.id
  join private.npc_version_resident_packages package on package.version_id=version.id
  where version.id=v2_id;
  perform private.npc_install_first_party_release(
    lira_id,'lira',roster_order,v2_id,identity_key,v2_number,true,v2_sheet,v2_options
  );

  perform set_config('request.jwt.claim.role','authenticated',true);
  perform set_config('request.jwt.claim.sub','35000000-0000-4000-8000-000000000003',true);
  new_tavern:=public.create_tavern();
  new_save_id:=(new_tavern->>'saveId')::uuid;
  insert into pg_temp.first_party_release_fixture(
    old_save_id,old_instance_id,old_version_id,old_package_id,old_package_hash,new_save_id
  ) select '35000000-0000-4000-8000-000000000012',resident_row.instance_id,resident_row.version_id,
      pin.package_id,pin.package_hash,new_save_id
    from private.world_resident_package_pins pin where pin.instance_id=resident_row.instance_id;
end
$release$;

select is((select resident.version_id from private.world_npc_instances resident
  join pg_temp.first_party_release_fixture fixture on fixture.old_instance_id=resident.id),
  '18181818-1818-4181-8181-181818181819'::uuid,'a resident materialized from V1 stays on its pinned version after V2 publication');
select is((select pin.package_id from private.world_resident_package_pins pin
  join pg_temp.first_party_release_fixture fixture on fixture.old_instance_id=pin.instance_id),
  (select old_package_id from pg_temp.first_party_release_fixture),'the resident keeps the exact immutable V1 package pin');
select is((select pin.package_hash from private.world_resident_package_pins pin
  join pg_temp.first_party_release_fixture fixture on fixture.old_instance_id=pin.instance_id),
  (select old_package_hash from pg_temp.first_party_release_fixture),'publication leaves the resident package fingerprint unchanged');
select is((select active_version_id from private.npc_first_party_catalog_identities where identity_key='lira'),
  '18181818-1818-4181-8181-18181818181a'::uuid,'the new V2 release becomes active for future residents');
select is((select resident.version_id from private.world_npc_instances resident
  join pg_temp.first_party_release_fixture fixture on fixture.new_save_id=resident.save_id
  where resident.npc_id='18181818-1818-4181-8181-181818181818'),
  '18181818-1818-4181-8181-18181818181a'::uuid,'a new save materializes the Lira V2 release');
select is((select resident.version_id from private.world_npc_instances resident
  join pg_temp.first_party_release_fixture fixture on fixture.new_save_id=resident.save_id
  where resident.npc_id='28282828-2828-4282-8282-282828282828'),
  '28282828-2828-4282-8282-28282828282a'::uuid,'a new save materializes the Torvin V2 release');

select is((select count(*)::integer from private.world_quest_events event
  join pg_temp.trinket_fixture fixture on fixture.quest_id=event.quest_id
  where fixture.fixture_index between 1 and 5 and event.outcome='succeeded'),5,'five actual initial authored quests succeed');
select is((select count(*)::integer from private.world_owned_trinkets item
  where item.save_id='35000000-0000-4000-8000-000000000011'),5,'each successful first authored milestone grants one durable keepsake');
select is((select count(*)::integer from private.world_owned_trinkets item
  where item.save_id='35000000-0000-4000-8000-000000000011' and item.active_slot is not null),4,'the first four rewards fill the four active places');
select is((select count(*)::integer from private.world_owned_trinkets item
  where item.save_id='35000000-0000-4000-8000-000000000011' and item.active_slot is null),1,'the fifth reward remains collected in overflow');
select is((select array_agg(item.active_slot order by fixture.fixture_index)
  from private.world_owned_trinkets item join pg_temp.trinket_fixture fixture on fixture.instance_id=item.source_instance_id
  where fixture.fixture_index between 1 and 4),array[0,1,2,3]::smallint[],'initial rewards fill the lowest open slot in order');
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','35000000-0000-4000-8000-000000000001',true);
select is(jsonb_array_length(private.trinket_collection('35000000-0000-4000-8000-000000000011')),5,'the owner projection retains active and overflow keepsakes');
select is(jsonb_array_length(public.npc_bar_summary()#>'{trinkets,collection}'),5,'the bounded Bar page projection includes active and overflow keepsakes');
select set_config('request.jwt.claim.role','service_role',true);
select is(private.world_grant_initial_quest_trinket(
  (select quest_id from pg_temp.trinket_fixture where fixture_index=1),
  (select success_event_id from pg_temp.trinket_fixture where fixture_index=1)
), (select result from private.world_quest_trinket_grant_receipts
  where source_event_id=(select success_event_id from pg_temp.trinket_fixture where fixture_index=1)),
  'replaying the grant for one terminal event returns its original durable receipt');

select set_config('request.jwt.claim.role','authenticated',true);
select is((select food_revenue_basis_points from private.trinket_effect_totals('35000000-0000-4000-8000-000000000011')),1000,'active food keepsakes sum to ten percent');
select is((select drink_revenue_basis_points from private.trinket_effect_totals('35000000-0000-4000-8000-000000000011')),500,'active drink keepsakes sum to five percent');
select is((select harvest_quality from private.trinket_effect_totals('35000000-0000-4000-8000-000000000011')),1::smallint,'active harvest keepsakes add one quality');
select set_config('request.jwt.claim.sub','35000000-0000-4000-8000-000000000002',true);
select is((select food_revenue_basis_points from private.trinket_effect_totals('35000000-0000-4000-8000-000000000011')),0,'another player cannot inspect a save’s food effect totals');
select is((select jsonb_array_length(private.trinket_collection('35000000-0000-4000-8000-000000000011'))),0,'another player cannot inspect a save’s trinket collection');

select is((select outcome from private.world_quest_events where id=(select success_event_id from pg_temp.trinket_fixture where fixture_index=6)),'failed','the exhausted first-quest failure gate produces a terminal failure');
select is((select count(*)::integer from private.world_owned_trinkets item where item.source_instance_id=(select instance_id from pg_temp.trinket_fixture where fixture_index=6)),0,'a failed first quest grants no keepsake');
select is((select outcome from private.world_quest_events where id=(select success_event_id from pg_temp.trinket_fixture where fixture_index=7)),'abandoned','the authored abandonment path resolves');
select is((select count(*)::integer from private.world_owned_trinkets item where item.source_instance_id=(select instance_id from pg_temp.trinket_fixture where fixture_index=7)),0,'an abandoned first quest grants no keepsake');
select private.world_resolve_quest_step((select quest_id from pg_temp.trinket_fixture where fixture_index=8),4,null);
select throws_ok($$select private.world_resolve_quest_step((select quest_id from pg_temp.trinket_fixture where fixture_index=8),5,0)$$,'PT422',null,'missing supported artwork is rejected before a reward is saved');
select is((select state from private.world_quests where id=(select quest_id from pg_temp.trinket_fixture where fixture_index=8)),'active','a rejected reward rolls back the terminal success event');
select is((select count(*)::integer from private.world_owned_trinkets item where item.source_instance_id=(select instance_id from pg_temp.trinket_fixture where fixture_index=8)),0,'an invalid authored reward never creates a collection item');

select set_config('request.jwt.claim.sub','35000000-0000-4000-8000-000000000001',true);
create temporary table pg_temp.swap_before as select revision from public.tavern_saves where id='35000000-0000-4000-8000-000000000011';
create temporary table pg_temp.swap_first as
select public.npc_swap_trinket(
  '35000000-0000-4000-8000-000000000011'::uuid,
  (select item.id from private.world_owned_trinkets item join pg_temp.trinket_fixture fixture on fixture.instance_id=item.source_instance_id where fixture.fixture_index=5),
  0::smallint,'35000000-0000-4000-8000-000000000901'::uuid,(select revision from pg_temp.swap_before)
) as result;
select is((select result->>'status' from pg_temp.swap_first),'swapped','an overflow keepsake can be equipped in an occupied place');
select is((select (result->>'committedRevision')::bigint from pg_temp.swap_first),(select revision+1 from pg_temp.swap_before),'a changed arrangement advances the save revision once');
create temporary table pg_temp.swap_replay as
select public.npc_swap_trinket(
  '35000000-0000-4000-8000-000000000011'::uuid,
  (select item.id from private.world_owned_trinkets item join pg_temp.trinket_fixture fixture on fixture.instance_id=item.source_instance_id where fixture.fixture_index=5),
  0::smallint,'35000000-0000-4000-8000-000000000901'::uuid,(select revision from pg_temp.swap_before)
) as result;
select is((select result from pg_temp.swap_replay),(select result from pg_temp.swap_first),'retrying an acknowledged swap returns the original receipt');
select throws_ok($$select public.npc_swap_trinket(
  '35000000-0000-4000-8000-000000000011'::uuid,
  (select item.id from private.world_owned_trinkets item join pg_temp.trinket_fixture fixture on fixture.instance_id=item.source_instance_id where fixture.fixture_index=5),
  1::smallint,'35000000-0000-4000-8000-000000000901'::uuid,(select revision from pg_temp.swap_before)
)$$,'PT409',null,'reusing an action id with different input is rejected');
select is((select count(*)::integer from private.world_trinket_swap_receipts where save_id='35000000-0000-4000-8000-000000000011'),1,'idempotent retries append one durable swap receipt');
select is((select count(*)::integer from private.world_owned_trinkets where save_id='35000000-0000-4000-8000-000000000011' and active_slot is not null),4,'swapping keeps exactly four places active');
select is((select active_slot from private.world_owned_trinkets item join pg_temp.trinket_fixture fixture on fixture.instance_id=item.source_instance_id where fixture.fixture_index=1),null::smallint,'the displaced keepsake returns to the collection');
select is((select active_slot from private.world_owned_trinkets item join pg_temp.trinket_fixture fixture on fixture.instance_id=item.source_instance_id where fixture.fixture_index=5),0::smallint,'the selected overflow keepsake occupies the chosen place');
select is((select revision from public.tavern_saves where id='35000000-0000-4000-8000-000000000011'),(select revision+1 from pg_temp.swap_before),'an exact retry does not advance the save revision twice');
select is((select food_revenue_basis_points from private.trinket_effect_totals('35000000-0000-4000-8000-000000000011')),500,'a displaced food effect no longer contributes');
select is((select drink_revenue_basis_points from private.trinket_effect_totals('35000000-0000-4000-8000-000000000011')),500,'the active drink effect remains in force');
select is((select harvest_quality from private.trinket_effect_totals('35000000-0000-4000-8000-000000000011')),2::smallint,'the equipped harvest rewards contribute while stored rewards do not');
create temporary table pg_temp.swap_unchanged as
select public.npc_swap_trinket(
  '35000000-0000-4000-8000-000000000011'::uuid,
  (select item.id from private.world_owned_trinkets item join pg_temp.trinket_fixture fixture on fixture.instance_id=item.source_instance_id where fixture.fixture_index=5),
  0::smallint,'35000000-0000-4000-8000-000000000902'::uuid,(select revision from public.tavern_saves where id='35000000-0000-4000-8000-000000000011')
) as result;
select is((select result->>'status' from pg_temp.swap_unchanged),'unchanged','choosing the current place is an idempotent no-op');
select is((select revision from public.tavern_saves where id='35000000-0000-4000-8000-000000000011'),(select revision+1 from pg_temp.swap_before),'an unchanged arrangement leaves the save revision alone');

update private.world_npc_instances set status='departed'
where id=(select instance_id from pg_temp.trinket_fixture where fixture_index=5);
select is((select count(*)::integer from private.world_owned_trinkets item join pg_temp.trinket_fixture fixture on fixture.instance_id=item.source_instance_id
  where fixture.fixture_index=5),1,'a resident departure preserves its earned keepsake');
select is(jsonb_array_length(private.trinket_collection('35000000-0000-4000-8000-000000000011')),5,'the collection still projects the keepsake after its source resident departs');

select * from finish();
rollback;
