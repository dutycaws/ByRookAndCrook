import { afterEach, describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../../src/lib/database.types';
import { GameServiceError, commitGardenCommand, getSnapshot, previewGardenCommand } from '../../src/lib/server/game';
import { createTestPlayer } from '../helpers/local-supabase';
import { assertRpcSuccess } from '../helpers/rpc-diagnostics';

const createdUsers: Array<{ admin: SupabaseClient<Database>; userId: string }> = [];

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
});
