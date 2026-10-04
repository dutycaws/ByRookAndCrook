begin;

-- The memory-scope RPC checks a fenced transition with SELECT ... FOR UPDATE.
-- STABLE makes PostgreSQL run the function in a read-only context, which
-- rejects that lock before the worker can capture memory context.
alter function public.world_quest_transition_memory_scope(uuid, uuid) volatile;

commit;
