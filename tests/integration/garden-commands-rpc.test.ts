import { afterEach, describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../../src/lib/database.types';
import { GameServiceError, commitGardenCommand, getSnapshot, previewGardenCommand } from '../../src/lib/server/game';
import { createTestPlayer, getLocalTestDatabaseContainer } from '../helpers/local-supabase';
import { assertRpcSuccess } from '../helpers/rpc-diagnostics';
import { execFileSync } from 'node:child_process';

const createdUsers: Array<{ admin: SupabaseClient<Database>; userId: string }> = [];

type GardenDayPlan = {
  plots: Array<{ cellId: string; soil: { n: number; p: number; k: number; quality: number } }>;
  compost: Array<{ cellId: string; released: boolean; nextReadyDay: number; remaining: number }>;
};

function resolveGardenDay(saveId: string, day: number): GardenDayPlan {
  const output = execFileSync('docker', [
    'exec', getLocalTestDatabaseContainer(), 'psql', '-U', 'postgres', '-At', '-v', 'ON_ERROR_STOP=1',
    '-c', `select private.resolve_garden_day('${saveId}'::uuid, ${day})`
  ], { encoding: 'utf8' });
  return JSON.parse(output) as GardenDayPlan;
}

afterEach(async () => {
  const deleted = await Promise.all(
    createdUsers.splice(0).map(({ admin, userId }) => admin.auth.admin.deleteUser(userId))
  );
  for (const result of deleted) expect(result.error).toBeNull();
});

describe('garden command RPC adapter', () => {
  it('previews without mutation, commits once, and replays the exact receipt', async () => {
    const player = await createTestPlayer('garden-command');
    createdUsers.push(player);
    assertRpcSuccess('create_tavern', [await player.client.rpc('create_tavern')]);

    const before = await getSnapshot(player.client);
    expect(before).not.toBeNull();
    const target = before!.cells.find((cell) => cell.layoutKey === 'c3');
    expect(target?.kind).toBe('empty');

    const preview = await previewGardenCommand(player.client, 'water', {
      cellIds: [target!.id],
      dose: 10
    });
    expect(preview).toMatchObject({
      commandKind: 'water',
      basedOnRevision: before!.save.revision,
      rulesVersion: 'garden-apiary-v1',
      canCommit: true
    });
    expect((await getSnapshot(player.client))!.save.revision).toBe(before!.save.revision);

    const command = {
      saveId: before!.save.id,
      actionId: crypto.randomUUID(),
      expectedRevision: before!.save.revision,
      commandKind: 'plant' as const,
      payload: { cellId: target!.id, seedItemKey: 'seed_hops' }
    };
    const first = await commitGardenCommand(player.client, command);
    const replay = await commitGardenCommand(player.client, command);
    expect(replay).toEqual(first);
    expect(first).toMatchObject({
      actionId: command.actionId,
      commandKind: 'plant',
      committedRevision: before!.save.revision + 1,
      rulesVersion: 'garden-apiary-v1'
    });

    const after = await getSnapshot(player.client);
    expect(after!.save.revision).toBe(before!.save.revision + 1);
    expect(after!.cells.find((cell) => cell.id === target!.id)).toMatchObject({
      kind: 'plant',
      plantKey: 'hops'
    });
  });

  it('maps stale revisions and foreign saves to recoverable service errors', async () => {
    const owner = await createTestPlayer('garden-owner');
    const stranger = await createTestPlayer('garden-stranger');
    createdUsers.push(owner, stranger);
    assertRpcSuccess('create owner tavern', [await owner.client.rpc('create_tavern')]);
    assertRpcSuccess('create stranger tavern', [await stranger.client.rpc('create_tavern')]);

    const ownerSnapshot = (await getSnapshot(owner.client))!;
    const target = ownerSnapshot.cells.find((cell) => cell.layoutKey === 'c3')!;
    await commitGardenCommand(owner.client, {
      saveId: ownerSnapshot.save.id,
      actionId: crypto.randomUUID(),
      expectedRevision: ownerSnapshot.save.revision,
      commandKind: 'water',
      payload: { cellIds: [target.id], dose: 10 }
    });

    await expect(commitGardenCommand(owner.client, {
      saveId: ownerSnapshot.save.id,
      actionId: crypto.randomUUID(),
      expectedRevision: ownerSnapshot.save.revision,
      commandKind: 'water',
      payload: { cellIds: [target.id], dose: 10 }
    })).rejects.toMatchObject({ status: 409, code: 'PT409' } satisfies Partial<GameServiceError>);

    await expect(commitGardenCommand(stranger.client, {
      saveId: ownerSnapshot.save.id,
      actionId: crypto.randomUUID(),
      expectedRevision: ownerSnapshot.save.revision + 1,
      commandKind: 'water',
      payload: { cellIds: [target.id], dose: 10 }
    })).rejects.toMatchObject({ status: 404, code: 'PT404' } satisfies Partial<GameServiceError>);
  });

  it('commits established clover into a delayed local soil-release schedule', async () => {
    const player = await createTestPlayer('garden-clover-incorporation');
    createdUsers.push(player);
    assertRpcSuccess('create_tavern', [await player.client.rpc('create_tavern')]);

    const beforePlanting = (await getSnapshot(player.client))!;
    const cell = beforePlanting.cells.find((candidate) => candidate.layoutKey === 'c3')!;
    await commitGardenCommand(player.client, {
      saveId: beforePlanting.save.id,
      actionId: crypto.randomUUID(),
      expectedRevision: beforePlanting.save.revision,
      commandKind: 'plant',
      payload: { cellId: cell.id, seedItemKey: 'seed_clover' }
    });

    execFileSync('docker', [
      'exec', getLocalTestDatabaseContainer(), 'psql', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1',
      '-c', `update public.garden_plants set age_days=3,growth_progress=60,lifecycle='flowering' where save_id='${beforePlanting.save.id}'::uuid and cell_id='${cell.id}'::uuid`
    ]);

    const beforeIncorporation = (await getSnapshot(player.client))!;
    const cloverPlot = beforeIncorporation.cells.find((candidate) => candidate.id === cell.id)!;
    expect(cloverPlot.kind).toBe('plant');
    expect(cloverPlot.plantKey).toBe('clover');
    expect(cloverPlot.soil).toBeDefined();

    const preview = await previewGardenCommand(player.client, 'incorporate_clover', { cellId: cell.id });
    expect(preview).toMatchObject({
      commandKind: 'incorporate_clover',
      basedOnRevision: beforeIncorporation.save.revision,
      normalizedPayload: { cellId: cell.id }
    });

    const command = {
      saveId: beforeIncorporation.save.id,
      actionId: crypto.randomUUID(),
      expectedRevision: beforeIncorporation.save.revision,
      commandKind: 'incorporate_clover' as const,
      payload: { cellId: cell.id }
    };
    const receipt = await commitGardenCommand(player.client, command);
    expect(receipt.result).toMatchObject({
      cellId: cell.id,
      incorporated: 'clover',
      firstReleaseDay: beforeIncorporation.save.currentDay + 1,
      releases: 3
    });
    expect(await commitGardenCommand(player.client, command)).toEqual(receipt);

    const incorporated = (await getSnapshot(player.client))!;
    const clearedPlot = incorporated.cells.find((candidate) => candidate.id === cell.id)!;
    expect(clearedPlot.kind).toBe('empty');
    expect(clearedPlot.soil).toEqual(cloverPlot.soil);
    const scheduledJob = incorporated.garden?.compostJobs.find((job) => job.cellId === cell.id);
    expect(scheduledJob).toMatchObject({
      sourceKind: 'green_manure',
      sourceLabel: 'clover',
      readyDay: incorporated.save.currentDay + 1,
      releasesRemaining: 3
    });
    expect(incorporated.garden?.compostJobs.filter((job) => job.cellId === cell.id)).toHaveLength(1);

    const beforeRelease = resolveGardenDay(incorporated.save.id, incorporated.save.currentDay);
    expect(beforeRelease.plots.find((plot) => plot.cellId === cell.id)?.soil).toMatchObject({
      n: cloverPlot.soil!.n,
      p: cloverPlot.soil!.p,
      k: cloverPlot.soil!.k,
      quality: cloverPlot.soil!.quality
    });
    expect(beforeRelease.compost.find((job) => job.cellId === cell.id)).toMatchObject({
      released: false,
      remaining: 3
    });

    const scheduledRelease = resolveGardenDay(incorporated.save.id, scheduledJob!.readyDay);
    expect(scheduledRelease.plots.find((plot) => plot.cellId === cell.id)?.soil).toMatchObject({
      n: Math.min(100, cloverPlot.soil!.n + 12),
      p: Math.min(100, cloverPlot.soil!.p + 12),
      k: Math.min(100, cloverPlot.soil!.k + 12),
      quality: Math.min(100, cloverPlot.soil!.quality + 4)
    });
    expect(scheduledRelease.compost.find((job) => job.cellId === cell.id)).toMatchObject({
      released: true,
      nextReadyDay: scheduledJob!.readyDay + 1,
      remaining: 2
    });
  });
});
