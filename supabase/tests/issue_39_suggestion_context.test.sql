begin;
select plan(3);

select has_function('private','player_suggestion_context',array['uuid'],
  'frozen suggestion context has a safe projection wrapper');
select is((
  select prosrc like '%recentTurns%'
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='private' and p.proname='player_suggestion_context'
),true,'context includes bounded player-visible turn history');
select is((
  select prosrc like '%pile<>''consumed''%'
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='private' and p.proname='player_suggestion_context'
),true,'consumed physical copies are excluded before a batch freezes');

select * from finish();
rollback;
