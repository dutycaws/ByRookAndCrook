-- Preserve complete_brew idempotency semantics after replacing its reward.
begin;

create or replace function public.complete_brew(
  p_save_id uuid,
  p_session_id uuid,
  p_action_id uuid,
  p_expected_revision bigint,
  p_perfect_ticks integer,
  p_good_ticks integer,
  p_total_ticks integer
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  prior public.craft_actions;
  v_result jsonb;
  old_card uuid;
  new_card uuid;
  quality integer;
  card_key text;
  tier text;
begin
  select a.* into prior
  from public.craft_actions a
  join public.tavern_saves s on s.id = a.save_id and s.user_id = auth.uid()
  where a.save_id = p_save_id and a.action_id = p_action_id;
  if found then
    if prior.command_kind = 'complete_brew'
      and prior.subject_id = p_session_id
      and prior.input_expected_revision = p_expected_revision
      and prior.input_perfect_ticks = p_perfect_ticks
      and prior.input_good_ticks = p_good_ticks
      and prior.input_total_ticks = p_total_ticks then
      return prior.result;
    end if;
    raise sqlstate 'PT409' using message = 'Action identifier was already used for a different request';
  end if;

  v_result := private.complete_brew_before_intents_v2(
    p_save_id, p_session_id, p_action_id, p_expected_revision,
    p_perfect_ticks, p_good_ticks, p_total_ticks
  );
  quality := (v_result->>'qualityIndex')::integer;
  old_card := nullif(v_result->>'socialCardId', '')::uuid;
  if old_card is not null then
    delete from public.social_cards where save_id = p_save_id and id = old_card;
  end if;

  if quality >= 2 then
    card_key := case when quality >= 5 then 'resolve' when quality >= 4 then 'insight' else 'charm' end;
    tier := case when quality >= 5 then 'exceptional' when quality >= 4 then 'superior' else 'fine' end;
    insert into public.intent_cards
      (save_id, card_key, tier, source_kind, source_key, source_beverage_id)
    values
      (p_save_id, card_key, tier, 'brew', v_result->>'beverageId', (v_result->>'beverageId')::uuid)
    on conflict (save_id, source_kind, source_key) do update set source_key = excluded.source_key
    returning id into new_card;
  end if;

  v_result := (v_result - 'socialCardId') || jsonb_build_object(
    'intentCardId', new_card,
    'intentCardKey', card_key,
    'intentCardTier', tier,
    'rulesVersion', 'brew-v2'
  );
  update public.craft_actions set result = v_result
  where save_id = p_save_id and action_id = p_action_id;
  return v_result;
end;
$$;
revoke all on function public.complete_brew(uuid, uuid, uuid, bigint, integer, integer, integer)
  from public, anon;
grant execute on function public.complete_brew(uuid, uuid, uuid, bigint, integer, integer, integer)
  to authenticated;

commit;
