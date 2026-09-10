-- Intent play is an immutable ledger entry, so issued cards are never removed
-- directly. Cascading save deletion remains available for account cleanup.
begin;

drop trigger immutable_issued_intent_card on public.intent_cards;
create or replace function private.immutable_issued_intent_card()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' and pg_trigger_depth() > 1 then
    return old;
  end if;
  raise exception 'Issued intent cards are immutable';
end;
$$;
create trigger immutable_issued_intent_card
  before update or delete on public.intent_cards
  for each row execute function private.immutable_issued_intent_card();

commit;
