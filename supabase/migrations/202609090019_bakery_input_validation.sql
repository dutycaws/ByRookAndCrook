-- Keep malformed direct RPC inputs inside the public PT400 contract rather than
-- allowing SQL nulls to reach table constraints.
begin;

alter function public.fold_bake(uuid, uuid, uuid, bigint, integer)
  rename to fold_bake_before_null_validation;
alter function public.fold_bake_before_null_validation(uuid, uuid, uuid, bigint, integer)
  set schema private;
create function public.fold_bake(
  p_save_id uuid, p_session_id uuid, p_action_id uuid,
  p_expected_revision bigint, p_distance integer
)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if p_distance is null then
    raise sqlstate 'PT400' using message = 'Invalid dough fold';
  end if;
  return private.fold_bake_before_null_validation(
    p_save_id, p_session_id, p_action_id, p_expected_revision, p_distance
  );
end;
$$;

alter function public.score_bake(uuid, uuid, uuid, bigint, integer)
  rename to score_bake_before_null_validation;
alter function public.score_bake_before_null_validation(uuid, uuid, uuid, bigint, integer)
  set schema private;
create function public.score_bake(
  p_save_id uuid, p_session_id uuid, p_action_id uuid,
  p_expected_revision bigint, p_length integer
)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if p_length is null then
    raise sqlstate 'PT400' using message = 'Invalid loaf score';
  end if;
  return private.score_bake_before_null_validation(
    p_save_id, p_session_id, p_action_id, p_expected_revision, p_length
  );
end;
$$;

revoke all on function private.fold_bake_before_null_validation(uuid, uuid, uuid, bigint, integer),
  private.score_bake_before_null_validation(uuid, uuid, uuid, bigint, integer)
  from public, anon, authenticated;
revoke all on function public.fold_bake(uuid, uuid, uuid, bigint, integer),
  public.score_bake(uuid, uuid, uuid, bigint, integer) from public, anon;
grant execute on function public.fold_bake(uuid, uuid, uuid, bigint, integer),
  public.score_bake(uuid, uuid, uuid, bigint, integer) to authenticated;

commit;
