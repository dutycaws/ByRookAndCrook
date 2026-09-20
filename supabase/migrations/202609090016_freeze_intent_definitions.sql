-- Published intent definitions and issued cards are immutable.  Turn-specific
-- snapshots live with UUID world dialogue from migration 031 onward.
begin;

alter table public.intent_card_catalog
  drop constraint intent_card_catalog_version_check;
alter table public.intent_card_catalog
  add constraint intent_card_catalog_version_check
  check (version ~ '^intent-v[1-9][0-9]*$');

create function private.immutable_intent_catalog()
returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception 'Published intent catalog entries are immutable';
end;
$$;
create trigger immutable_intent_catalog
  before update or delete on public.intent_card_catalog
  for each row execute function private.immutable_intent_catalog();

create function private.immutable_issued_intent_card()
returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception 'Issued intent cards are immutable';
end;
$$;
create trigger immutable_issued_intent_card
  before update on public.intent_cards
  for each row execute function private.immutable_issued_intent_card();

revoke all on function private.immutable_intent_catalog(), private.immutable_issued_intent_card()
  from public, anon, authenticated;
commit;
