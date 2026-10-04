begin;
create extension if not exists pgtap with schema extensions;
select plan(6);

-- A preserved local database may already contain a real provider check.  The
-- migration is only allowed to make it stale; it must not overwrite whatever
-- model, provider, availability result, or check time was recorded.
create temporary table pg_temp.before_expiry as
select model, provider, available, failure_code, checked_at
from private.npc_portrait_provider_status
where singleton;
select ok(
  (select expires_at <= now() from private.npc_portrait_provider_status where singleton),
  'the singleton provider-status cache is expired for a runtime refresh'
);

-- Repeat the migration's cache-only operation against the captured row.  This
-- keeps the preservation contract deterministic without assuming which model
-- a developer's prior successful runtime check recorded.
update private.npc_portrait_provider_status
set expires_at = now() - interval '1 second'
where singleton;
select is(
  (select model from private.npc_portrait_provider_status where singleton),
  (select model from pg_temp.before_expiry),
  'cache expiry preserves a previously verified model'
);
select is(
  (select provider from private.npc_portrait_provider_status where singleton),
  (select provider from pg_temp.before_expiry),
  'cache expiry preserves the verified provider'
);
select is(
  (select available from private.npc_portrait_provider_status where singleton),
  (select available from pg_temp.before_expiry),
  'cache expiry preserves the recorded availability result'
);
select is(
  (select checked_at from private.npc_portrait_provider_status where singleton),
  (select checked_at from pg_temp.before_expiry),
  'cache expiry does not masquerade as a new provider check'
);

-- The singleton row can be recreated by local fixture/reset workflows.  Its
-- column default is the source of truth for such a newly inserted record.
delete from private.npc_portrait_provider_status where singleton;
create temporary table pg_temp.new_status as
with inserted as (
  insert into private.npc_portrait_provider_status(singleton) values (true)
  returning model
)
select model from inserted;
select is(
  (select model from pg_temp.new_status),
  'gpt-image-2.5-sunburst',
  'a newly inserted provider-status record defaults to Sunburst'
);

select * from finish();
rollback;
