begin;
create extension if not exists pgtap with schema extensions;
select plan(24);

-- The final reset schema deliberately has no patron-key NPC content stack.
select ok(to_regclass('private.npc_content') is null,'legacy current NPC content relation is absent');
select ok(to_regclass('private.npc_content_versions') is null,'legacy NPC content version relation is absent');
select ok(to_regclass('private.npc_lives') is null,'legacy NPC life relation is absent');
select ok(to_regclass('private.npc_quests') is null,'legacy patron-key quest relation is absent');
select ok(to_regclass('private.npc_events') is null,'legacy patron-key event relation is absent');
select ok(to_regclass('private.npc_memories') is null,'legacy patron-key memory relation is absent');
select ok(to_regclass('private.npc_reactions') is null,'legacy patron-key reaction relation is absent');
select ok(to_regclass('public.patron_catalog') is null,'legacy public patron catalog is absent');
select ok(to_regclass('public.patron_states') is null,'legacy public patron state relation is absent');
select ok(to_regclass('public.serving_events') is null,'legacy public serving ledger is absent');
select ok(to_regclass('public.dialogue_turns') is null,'legacy public dialogue turns are absent');
select ok(to_regclass('public.hospitality_events') is null,'legacy public hospitality receipts are absent');
select ok(to_regclass('public.intent_card_plays') is null,'legacy public intent-card receipt relation is absent');

-- Pilot, promoted-definition, and capability source tables cannot survive as
-- an alternate authority beside immutable resident packages.
select ok(to_regclass('private.world_pilot_resident_definitions') is null,'pilot definition registry is absent');
select ok(to_regclass('private.world_promoted_npc_definitions') is null,'promoted definition registry is absent');
select ok(to_regclass('private.world_promoted_supporting_templates') is null,'promoted supporting template registry is absent');
select ok(to_regclass('private.world_resident_evolution_pins') is null,'legacy resident evolution pin relation is absent');
select ok(to_regclass('private.world_pilot_resident_procedural_definitions') is null,'pilot procedural definition registry is absent');
select ok(to_regclass('private.world_resident_procedural_capability_sources') is null,'procedural capability source relation is absent');

select has_table('private','npc_version_resident_packages','UUID version packages remain the resident definition authority');
select has_table('private','world_resident_package_pins','UUID residents retain immutable package pins');
select has_table('private','world_npc_instances','UUID resident instances remain available');
select has_table('private','world_npc_dialogue_turns','UUID dialogue turns remain available');
select has_table('private','world_npc_hospitality_events','UUID hospitality receipts remain available');

select * from finish();
rollback;
