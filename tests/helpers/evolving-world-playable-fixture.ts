import type { SupabaseClient } from '@supabase/supabase-js';
import { execFileSync } from 'node:child_process';
import type { Database } from '../../src/lib/database.types';
import { createTestPlayer } from './local-supabase';

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
