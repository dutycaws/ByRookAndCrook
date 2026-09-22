-- The runtime checks provider availability against its environment on demand.
-- Keep any last verified provider/model record intact, but force that check to
-- happen again after changing the deployed default.
alter table private.npc_portrait_provider_status
  alter column model set default 'gpt-image-2.5-sunburst';

update private.npc_portrait_provider_status
set expires_at = now() - interval '1 second'
where singleton;
