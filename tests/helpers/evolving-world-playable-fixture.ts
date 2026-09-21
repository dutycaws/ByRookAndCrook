import type { SupabaseClient } from '@supabase/supabase-js';
import { execFileSync } from 'node:child_process';
import type { Database } from '../../src/lib/database.types';
import { createTestPlayer } from './local-supabase';
import { createBrewedTavern } from './brewed-tavern';

type ProceduralContext = {
  version: 'procedural-world-v1';
  entityKinds: Record<string, string>;
  activeGeneratedEntityCount: number;
  activeQuestByResident: Record<string, { id: string; primitiveKey: string }>;
  capabilities: Record<string, {
    allowedActions: string[]; allowedApproaches: string[]; allowedWorldEffects: string[]; allowedTargetKinds: string[];
  }>;
};

const actionId = (day: number, ordinal: number) => `17${day.toString().padStart(6, '0')}-0000-4000-8000-${ordinal.toString().padStart(12, '0')}`;
const promotedNpcName = 'Mara Roadward';
const provisionName = 'Road provisions';
const provisionKey = 'road-provisions';

function sourceResident(context: ProceduralContext): string {
  const entry = Object.entries(context.capabilities).find(([, capability]) =>
    capability.allowedWorldEffects.includes('create_entity')
    && capability.allowedTargetKinds.includes('npc')
    && capability.allowedTargetKinds.includes('item')
  );
  if (!entry) throw new Error('The deterministic playable fixture needs one resident authorized for NPC and item creation.');
  return entry[0];
}

/** A text-only fixture: it has no asset, storage, or external-provider dependency. */
function deterministicProposal(context: ProceduralContext) {
  const residentId = sourceResident(context);
  return {
    version: 'procedural-world-v1',
    commands: [
              {
                operation: 'entity', effectKind: 'create_entity', sourceResidentId: residentId,
                entityKind: 'item', entityKey: provisionKey, archetypeKey: 'trade-good', proposedName: provisionName,
                payload: { kind: 'travel food', summary: 'Durable provisions for long journeys.' }
              },
              {
                operation: 'gameplay_unlock', effectKind: 'unlock_gameplay', sourceResidentId: residentId,
                entityRef: provisionKey, family: 'successor_provisions', definition: { displayName: provisionName, price: 5, dailyStock: 1 }
              },
              {
                operation: 'entity', effectKind: 'create_entity', sourceResidentId: residentId,
                entityKind: 'npc', entityKey: 'mara-roadward', archetypeKey: 'deep-npc', proposedName: promotedNpcName,
                payload: {
                  identity: { name: promotedNpcName, title: 'Road Scout', shortDescription: 'A careful scout who maps safe routes between nearby settlements.', voice: 'Measured, practical, and attentive to details that keep travelers safe.' },
                  profile: { values: ['safe roads'], likes: ['careful maps'], dislikes: ['reckless travel'], boundaries: ['will not abandon a companion'] },
                  capabilities: { archetypeKey: 'scout' },
                  appearance: { physicalAppearance: 'A weathered traveler with observant eyes and a practical bearing.', attire: 'A green cloak, sturdy boots, and a well-kept travel satchel.', notableFeatures: 'A folded route map marked with careful charcoal notes.', mood: 'Cautiously hopeful after reaching the tavern.' }
                }
              }
    ]
  };
}

type SettlementClaim = { status?: string; kind?: string; settlementId?: string; jobId?: string; fence?: string; jobInputSnapshot?: unknown };
type RpcClient = { rpc(name: string, args?: Record<string, unknown>): Promise<{ data: unknown; error: Error | null }> };

type QuestTransitionBranch = 'next_authored_milestone' | 'successor' | 'departure';
type QuestTransitionContext = {
  terminalEventId?: string;
  nextAuthoredMilestone?: { id?: string };
  frozenTargetRefs?: string[];
};

export type QuestLifecycleFixture = Awaited<ReturnType<typeof createBrewedQuestLifecycleFixture>>;

function assertRpc(result: { error: Error | null }, message: string): void {
  if (result.error) throw new Error(`${message}: ${result.error.message}`);
}

function queryLocalPostgres(sql: string): string {
  const output = execFileSync('docker', [
    'exec', 'supabase_db_by-rook-and-crook', 'psql', '-qAt', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1', '-c', sql
  ], { encoding: 'utf8' }).trim();
  const line = output.split('\n').at(-1)?.trim();
  if (!line) throw new Error('Local lifecycle fixture query returned no value.');
  return line;
}

function uuid(value: string, label: string): string {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    throw new Error(`${label} was not a UUID.`);
  }
  return value;
}

/**
 * This is intentionally a service-only resolver invocation, not a fixture
 * insert. It gives the lifecycle journey a stable outcome draw while still
 * exercising the same database resolver that records terminal events and
 * queues transitions in production.
 */
function resolveQuestStep(questId: string, closingDay: number, draw: number): string {
  if (!Number.isSafeInteger(closingDay) || !Number.isSafeInteger(draw) || draw < 0 || draw > 99) {
    throw new Error('Lifecycle resolver requires a safe closing day and a draw from 0 through 99.');
  }
  return uuid(queryLocalPostgres(
    `set role service_role; select (private.world_resolve_quest_step('${uuid(questId, 'Quest ID')}'::uuid,${closingDay},${draw})).id;`
  ), 'Resolved quest event ID');
}

function activeQuestId(saveId: string, instanceId: string): string {
  return uuid(queryLocalPostgres(
    `select id from private.world_quests where save_id='${uuid(saveId, 'Save ID')}'::uuid and instance_id='${uuid(instanceId, 'Instance ID')}'::uuid and state='active' order by created_at,id limit 1;`
  ), 'Active quest ID');
}

/** Read-only lifecycle inspection used after a departure assertion. */
export function activeQuestCountForLifecycle(fixture: QuestLifecycleFixture): number {
  const value = Number(queryLocalPostgres(
    `select count(*) from private.world_quests where save_id='${uuid(fixture.saveId, 'Save ID')}'::uuid and instance_id='${uuid(fixture.liraInstanceId, 'Instance ID')}'::uuid and state in ('scheduled','active');`
  ));
  if (!Number.isSafeInteger(value) || value < 0) throw new Error('Active lifecycle quest count was invalid.');
  return value;
}

/** Read-only event field used to prove hospitality is scoped to the quest window. */
export function resolvedQuestHospitality(eventId: string): number {
  const value = Number(queryLocalPostgres(
    `select hospitality from private.world_quest_events where id='${uuid(eventId, 'Quest event ID')}'::uuid;`
  ));
  if (!Number.isSafeInteger(value)) throw new Error('Resolved quest hospitality was invalid.');
  return value;
}

function proposalFor(branch: QuestTransitionBranch, context: QuestTransitionContext) {
  const terminalEventId = uuid(String(context.terminalEventId ?? ''), 'Transition terminal event ID');
  if (branch === 'next_authored_milestone') {
    return {
      version: 'quest-transition-v1', kind: branch, terminalEventId,
      milestoneId: String(context.nextAuthoredMilestone?.id ?? ''),
      plan: [{ action: 'attempt', approach: 'scouting' }]
    };
  }
  if (branch === 'successor') {
    const target = context.frozenTargetRefs?.[0];
    if (!target) throw new Error('Generated successor fixture needs one frozen target.');
    return {
      version: 'quest-transition-v1', kind: branch, terminalEventId,
      title: 'Keep the road watched', objective: 'Maintain the safer route for Millhaven travelers.',
      motivation: 'Lira keeps practical watch after the previous work is complete.',
      constraints: ['Protect travelers'], targetRefs: [target], difficulty: 1,
      plan: [{ action: 'attempt', approach: 'scouting' }]
    };
  }
  return {
    version: 'quest-transition-v1', kind: branch, terminalEventId,
    privateRationale: 'The road is steady, and my watch can continue beyond Millhaven.',
    farewellText: 'Keep the lantern lit. I will remember this hearth.',
    publicNews: 'Lira Nightwind will leave Millhaven after one final day at the tavern.'
  };
}

/** A deterministic provider with only the public closed transition contract. */
export function deterministicQuestTransitionProvider(branch: QuestTransitionBranch) {
  const calls: string[] = [];
  return {
    calls,
    async generate(stage: string, payload: unknown) {
      calls.push(stage);
      const context = (payload as { context?: QuestTransitionContext }).context;
      const value = stage === 'quest_transition_proposer'
        ? proposalFor(branch, context ?? {})
        : { decision: 'accept', instructions: [] };
      return { value, model: 'fixture-model', usage: { input: 1, output: 1 }, durationMs: 1, promptVersion: 'fixture-v1' };
    }
  };
}

/**
 * The browser runner cannot import SvelteKit's `$env` virtual module used by the
 * worker. This local loop deliberately uses the same service-only claim/commit
 * boundary and keeps every drain at four serial claims; worker retry semantics
 * are covered in its focused unit suite.
 */
async function drainFixtureClaims(service: RpcClient, settlementId: string): Promise<number> {
  let claims = 0;
  for (let index = 0; index < 4; index += 1) {
    const claimed = await service.rpc('world_settlement_claim', { p_settlement_id: settlementId });
    if (claimed.error) throw claimed.error;
    const claim = claimed.data as SettlementClaim;
    if (claim.status && !claim.jobId) break;
    if (!claim.settlementId || !claim.jobId || !claim.fence) throw new Error('Malformed local settlement claim.');
    claims += 1;
    if (claim.kind === 'procedural_world') {
      const proposal = deterministicProposal(claim.jobInputSnapshot as ProceduralContext);
      const committed = await service.rpc('world_settlement_commit_procedural_world', {
        p_settlement_id: claim.settlementId, p_job_id: claim.jobId, p_fence: claim.fence, p_proposal: proposal
      });
      if (committed.error) throw committed.error;
      const materialized = await service.rpc('world_materialize_procedural_npc_packages', {
        p_settlement_id: claim.settlementId, p_job_id: claim.jobId
      });
      if (materialized.error) throw materialized.error;
    } else {
      const completed = await service.rpc('world_settlement_safe_result', {
        p_settlement_id: claim.settlementId, p_job_id: claim.jobId, p_fence: claim.fence,
        p_kind: 'skipped', p_public_digest: 'The deterministic fixture completed this bounded settlement job.'
      });
      if (completed.error) throw completed.error;
    }
  }
  return claims;
}

async function snapshot(client: SupabaseClient<Database>) {
  const result = await client.rpc('get_tavern_snapshot');
  if (result.error || !result.data) throw result.error ?? new Error('Missing tavern snapshot.');
  return result.data as unknown as { save: { id: string; revision: number; day: number } };
}

function fundFixtureSave(saveId: string) {
  execFileSync('docker', [
    'exec', 'supabase_db_by-rook-and-crook', 'psql', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1',
    '-c', `update public.tavern_saves set gold=20 where id='${saveId}'::uuid`
  ]);
}

export async function createPlayableWorldFixture() {
  const player = await createTestPlayer('issue-17-playable');
  try {
    const created = await player.client.rpc('create_tavern');
    if (created.error) throw created.error;
    const initial = await snapshot(player.client);
    fundFixtureSave(initial.save.id);
    const service = player.admin as unknown as RpcClient;
    let drains = 0;
    let days = 0;
    let completed = false;
    for (let day = 1; day <= 30; day += 1) {
      const current = await snapshot(player.client);
      const advanced = await player.client.rpc('advance_tavern_day', {
        p_save_id: current.save.id,
        p_action_id: actionId(day, 1),
        p_expected_revision: current.save.revision
      });
      if (advanced.error) throw advanced.error;
      const settlementId = (advanced.data as any)?.worldSettlement?.settlementId;
      if (typeof settlementId !== 'string') throw new Error('Day advancement did not return a settlement ID.');
      days = day;
      // Every call is a serial, bounded drain; each drain itself claims at most four jobs.
      for (let pass = 0; pass < 3; pass += 1) {
        const claimed = await drainFixtureClaims(service, settlementId);
        drains += 1;
        if (claimed === 0) break;
      }
      const supplies = await player.client.rpc('world_generated_shop_projection', { p_save_id: initial.save.id });
      const roster = await player.client.rpc('npc_roster', { p_limit: 20, p_query: promotedNpcName });
      if (!supplies.error && !roster.error && (supplies.data as any)?.catalog?.some((item: any) => item.itemKey === provisionKey)
        && (roster.data as any[])?.some((resident: any) => resident.name === promotedNpcName)) {
        completed = true;
        break;
      }
    }
    if (!completed) throw new Error('Playable fixture reached the 30-day cap without producing both playable artifacts.');
    return { ...player, saveId: initial.save.id, days, drains, provisionKey, provisionName, promotedNpcName };
  } catch (error) {
    // Once procedural history exists, canonical retention intentionally blocks
    // deleting the owning save through an auth-user cascade.
    throw error;
  }
}

/**
 * Starts with the same real garden/brew/serving path as the browser suite.
 * It intentionally never writes quest terminal, successor, departure, or
 * history rows: those are all owned by the resolver and transition commit.
 */
export async function createBrewedQuestLifecycleFixture() {
  const player = await createBrewedTavern('quest-lifecycle');
  const bar = await player.client.rpc('npc_bar_snapshot');
  assertRpc(bar, 'Could not load the playable resident projection');
  const lira = (bar.data as { save?: { revision?: number }; roster?: Array<{ instanceId?: string; name?: string }> })?.roster
    ?.find((resident) => resident.name === 'Lira Nightwind');
  const revision = (bar.data as { save?: { revision?: number } })?.save?.revision;
  if (!lira?.instanceId || typeof revision !== 'number' || !Number.isSafeInteger(revision)) throw new Error('Lira was not present in the playable roster.');
  const served = await player.client.rpc('npc_serve_hospitality', {
    p_save_id: player.saveId, p_instance_id: lira.instanceId, p_item_kind: 'beverage', p_item_id: player.brew.beverageId,
    p_action_id: crypto.randomUUID(), p_expected_revision: revision
  });
  assertRpc(served, 'Could not serve Lira through the public hospitality boundary');
  const food = await player.admin.from('foods').insert({
    save_id: player.saveId, name: 'Lifecycle hearth loaf', recipe_key: 'lifecycle-hearth-loaf', quality_index: 4,
    day_number: 1, source_action_id: crypto.randomUUID()
  }).select('id').single();
  if (food.error) throw food.error;
  const servedFood = await player.client.rpc('npc_serve_hospitality', {
    p_save_id: player.saveId, p_instance_id: lira.instanceId, p_item_kind: 'food', p_item_id: food.data.id,
    p_action_id: crypto.randomUUID(), p_expected_revision: revision + 1
  });
  assertRpc(servedFood, 'Could not serve Lira food through the public hospitality boundary');
  return { ...player, liraInstanceId: uuid(lira.instanceId, 'Lira instance ID') };
}

/** Close a normal playable day, then drain only ordinary settlement jobs. */
export async function closeQuestLifecycleDay(fixture: QuestLifecycleFixture) {
  const current = await snapshot(fixture.client);
  const closed = await fixture.client.rpc('advance_tavern_day', {
    p_save_id: fixture.saveId, p_action_id: actionId(current.save.day, 9), p_expected_revision: current.save.revision
  });
  assertRpc(closed, 'Could not close the public tavern day');
  const settlementId = (closed.data as { worldSettlement?: { settlementId?: string } })?.worldSettlement?.settlementId;
  if (!settlementId) throw new Error('Day close did not return an ordinary settlement.');
  for (let pass = 0; pass < 3; pass += 1) {
    if (await drainFixtureClaims(fixture.admin as unknown as RpcClient, settlementId) === 0) break;
  }
  return { closingDay: current.save.day, settlementId };
}

/** Resolve exactly the active quest for this resident using the real service function. */
export function resolveActiveQuestForLifecycle(fixture: QuestLifecycleFixture, closingDay: number, draw = 0) {
  return resolveQuestStep(activeQuestId(fixture.saveId, fixture.liraInstanceId), closingDay, draw);
}

/**
 * Runs the actual claim -> checkpoint -> commit service path with a bounded,
 * deterministic provider. Reclaiming a committed event is deliberately
 * returned to the caller so the journey can prove its replay receipt.
 */
export async function runQuestLifecycleTransition(
  fixture: QuestLifecycleFixture,
  terminalEventId: string,
  branch: QuestTransitionBranch
) {
  const claimed = await fixture.admin.rpc('world_quest_transition_claim', { p_terminal_event_id: terminalEventId });
  assertRpc(claimed, 'Could not claim the queued quest transition');
  const provider = deterministicQuestTransitionProvider(branch);
  const lease = claimed.data as { transitionId?: string; fence?: string; terminalEventId?: string; frozenContext?: QuestTransitionContext };
  const transitionId = uuid(String(lease.transitionId ?? ''), 'Transition ID');
  const fence = uuid(String(lease.fence ?? ''), 'Transition fence');
  const proposal = (await provider.generate('quest_transition_proposer', {
    context: {
      terminalEventId: lease.terminalEventId,
      nextAuthoredMilestone: lease.frozenContext?.nextAuthoredMilestone,
      frozenTargetRefs: (lease.frozenContext as any)?.validCanonicalTargets?.flatMap((target: any) => [target.id, target.ref].filter(Boolean))
    }
  })).value;
  const checkpoint = await fixture.admin.rpc('world_quest_transition_checkpoint', {
    p_transition_id: transitionId, p_fence: fence, p_stage: 'proposer', p_payload: { proposal }
  });
  assertRpc(checkpoint, 'Could not checkpoint the deterministic transition proposal');
  const critic = (await provider.generate('quest_transition_critic', { proposal })).value;
  const criticCheckpoint = await fixture.admin.rpc('world_quest_transition_checkpoint', {
    p_transition_id: transitionId, p_fence: fence, p_stage: 'critic', p_payload: { decision: critic }
  });
  assertRpc(criticCheckpoint, 'Could not checkpoint the deterministic transition review');
  const committed = await fixture.admin.rpc('world_quest_transition_commit', {
    p_transition_id: transitionId, p_fence: fence, p_proposal: proposal
  });
  assertRpc(committed, 'Could not commit the deterministic transition proposal');
  const replay = await fixture.admin.rpc('world_quest_transition_claim', { p_terminal_event_id: terminalEventId });
  assertRpc(replay, 'Could not read the transition replay receipt');
  return { outcome: committed.data as { status?: string; kind?: string }, providerCalls: provider.calls, replay: replay.data };
}
