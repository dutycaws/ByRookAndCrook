-- The original patron-key serving slice was intentionally removed.
-- Tavern economies now begin with gold; UUID world residents own dialogue and
-- hospitality in the later community-runtime migrations.
alter table public.tavern_saves
  add column gold bigint not null default 0 check (gold >= 0);
