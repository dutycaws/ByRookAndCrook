-- Persist only player-visible interaction history with the frozen player-line batch.
begin;

alter function private.player_suggestion_context(uuid)
  rename to player_suggestion_context_before_issue39;

create function private.player_suggestion_context(p_deck_id uuid) returns jsonb
language sql stable security definer set search_path='' as $$
  with deck as (
    select d.id,d.save_id,private.player_suggestion_context_before_issue39(d.id) base
    from public.daily_decks d where d.id=p_deck_id
  ), safe_cards as (
    select coalesce(jsonb_agg(card.value order by card.ordinality),'[]'::jsonb) cards
    from deck cross join lateral jsonb_array_elements(deck.base->'cards') with ordinality card(value,ordinality)
    join public.daily_deck_cards c on c.id=(card.value->>'id')::uuid
    where c.deck_id=deck.id and c.pile<>'consumed'
  ), safe_guests as (
    select coalesce(jsonb_agg(
      jsonb_set(guest.value,'{context}',jsonb_build_object(
        'recentTurns',coalesce((
          select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
            'playerMessage',h.message,
            'npcReply',coalesce(h.result->>'reply',h.result->>'response',h.result#>>'{reply,text}')
          )) order by h.input_sequence desc)
          from (
            select t.message,t.input_sequence,t.result
            from private.world_npc_dialogue_turns t
            where t.save_id=deck.save_id and t.instance_id=(guest.value->>'id')::uuid
              and t.status='completed' and nullif(btrim(t.message),'') is not null
            order by t.input_sequence desc limit 6
          ) h
        ),'[]'::jsonb)
      ))), '[]'::jsonb) guests
    from deck cross join lateral jsonb_array_elements(deck.base->'guests') guest(value)
  )
  select jsonb_set(jsonb_set(deck.base,'{cards}',safe_cards.cards),'{guests}',safe_guests.guests)
  from deck cross join safe_cards cross join safe_guests
$$;
revoke all on function private.player_suggestion_context_before_issue39(uuid) from public,anon,authenticated;
revoke all on function private.player_suggestion_context(uuid) from public,anon,authenticated;

commit;
