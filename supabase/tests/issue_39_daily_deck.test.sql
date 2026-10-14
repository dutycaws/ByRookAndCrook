begin;
select plan(12);

select has_table('public','daily_decks','daily decks persist one cycle per tavern day');
select has_table('public','daily_deck_cards','physical copies have a stable authoritative row');
select has_table('public','daily_deck_changes','next-morning social changes are persisted');
select has_table('public','player_suggestion_batches','one persisted suggestion batch exists per generation');
select has_table('public','player_suggestions','per-copy guest suggestions persist');
select has_function('public','daily_deck_open',array['bigint','uuid[]'],'opening is an authenticated RPC');
select has_function('public','daily_deck_close',array['bigint'],'closing is an authenticated RPC');
select has_function('public','daily_deck_state',array[]::text[],'reload reads the authoritative deck state');
select has_function('public','daily_deck_use_forgetfulness',array['bigint','uuid','uuid'],'potion removal is an idempotent action RPC');
select has_function('private','daily_deck_admit',array['uuid','uuid'],'all dialogue paths can validate a physical hand copy');
select has_function('private','daily_deck_commit',array['uuid','uuid'],'only successful dialogue completion moves a physical copy');
select has_function('public','player_suggestion_batch_context',array['uuid'],'generation receives the whole finalized deck context');

select * from finish();
rollback;
