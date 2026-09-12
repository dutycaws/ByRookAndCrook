import { afterEach, describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../../src/lib/database.types';
import {
  GameServiceError,
  commitApiaryCommand,
  getSnapshot,
  previewApiaryCommand
} from '../../src/lib/server/game';
import { createTestPlayer } from '../helpers/local-supabase';
import { assertRpcSuccess } from '../helpers/rpc-diagnostics';

const createdUsers: Array<{ admin: SupabaseClient<Database>; userId: string }> = [];

afterEach(async () => {
  const deleted = await Promise.all(
    createdUsers.splice(0).map(({ admin, userId }) => admin.auth.admin.deleteUser(userId))
  );
  for (const result of deleted) expect(result.error).toBeNull();
});

describe('apiary command RPC adapter', () => {
  it('previews feed, commits it once, and keeps floral honey separate', async () => {
    const player = await createTestPlayer('apiary-adapter');
    createdUsers.push(player);
    assertRpcSuccess('create_tavern', [await player.client.rpc('create_tavern')]);
    const initial = (await getSnapshot(player.client))!;
    const colony = initial.cells.find((cell) => cell.layoutKey === 'c2')?.hive?.colony;
    expect(colony).not.toBeNull();

    const supplied = await player.admin.from('garden_inventory').insert({
      save_id: initial.save.id,
      item_key: 'bee_feed',
      quantity: 1
    });
    assertRpcSuccess('supply feed fixture', [supplied]);
    const preview = await previewApiaryCommand(player.client, 'feed', {
      colonyId: colony!.id,
      quantity: 1
    });
    expect(preview).toMatchObject({
      commandKind: 'feed',
      basedOnRevision: initial.save.revision,
      availableFeed: 1,
      canCommit: true
    });

    const command = {
      saveId: initial.save.id,
      actionId: crypto.randomUUID(),
      expectedRevision: initial.save.revision,
      commandKind: 'feed' as const,
      payload: { colonyId: colony!.id, quantity: 1 }
    };
    const first = await commitApiaryCommand(player.client, command);
    const replay = await commitApiaryCommand(player.client, command);
    expect(replay).toEqual(first);
    expect(first.committedRevision).toBe(initial.save.revision + 1);

    const after = (await getSnapshot(player.client))!;
    const fed = after.cells.find((cell) => cell.layoutKey === 'c2')!.hive!.colony!;
    expect(fed.foodStores).toBe(colony!.foodStores + 18);
    expect(fed.feedStores).toBe(18);
    expect(fed.floralHoney).toBe(colony!.floralHoney);
  });

  it('maps foreign-save apiary mutations to a not-found service error', async () => {
    const owner = await createTestPlayer('apiary-owner');
    const stranger = await createTestPlayer('apiary-stranger');
    createdUsers.push(owner, stranger);
    assertRpcSuccess('create owner tavern', [await owner.client.rpc('create_tavern')]);
    assertRpcSuccess('create stranger tavern', [await stranger.client.rpc('create_tavern')]);
    const ownerSnapshot = (await getSnapshot(owner.client))!;
    const ownerColony = ownerSnapshot.cells.find((cell) => cell.layoutKey === 'c2')!.hive!.colony!;

    await expect(commitApiaryCommand(stranger.client, {
      saveId: ownerSnapshot.save.id,
      actionId: crypto.randomUUID(),
      expectedRevision: ownerSnapshot.save.revision,
      commandKind: 'feed',
      payload: { colonyId: ownerColony.id, quantity: 1 }
    })).rejects.toMatchObject({ status: 404, code: 'PT404' } satisfies Partial<GameServiceError>);
  });

  it('serializes concurrent colony mutations against one save revision', async () => {
    const player = await createTestPlayer('apiary-race');
    createdUsers.push(player);
    assertRpcSuccess('create race tavern', [await player.client.rpc('create_tavern')]);
    const initial = (await getSnapshot(player.client))!;
    const colony = initial.cells.find((cell) => cell.layoutKey === 'c2')!.hive!.colony!;
    const supplied = await player.admin.from('garden_inventory').insert({
      save_id: initial.save.id,
      item_key: 'bee_feed',
      quantity: 2
    });
    assertRpcSuccess('supply race feed fixture', [supplied]);

    const attempts = await Promise.allSettled([
      commitApiaryCommand(player.client, {
        saveId: initial.save.id,
        actionId: crypto.randomUUID(),
        expectedRevision: initial.save.revision,
        commandKind: 'feed',
        payload: { colonyId: colony.id, quantity: 1 }
      }),
      commitApiaryCommand(player.client, {
        saveId: initial.save.id,
        actionId: crypto.randomUUID(),
        expectedRevision: initial.save.revision,
        commandKind: 'feed',
        payload: { colonyId: colony.id, quantity: 1 }
      })
    ]);
    expect(attempts.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(attempts.filter((result) => result.status === 'rejected')).toHaveLength(1);
    expect((attempts.find((result) => result.status === 'rejected') as PromiseRejectedResult).reason)
      .toMatchObject({ status: 409, code: 'PT409' });

    const after = (await getSnapshot(player.client))!;
    const fed = after.cells.find((cell) => cell.layoutKey === 'c2')!.hive!.colony!;
    expect(after.save.revision).toBe(initial.save.revision + 1);
    expect(fed.foodStores).toBe(colony.foodStores + 18);
    expect(fed.feedStores).toBe(18);
    const inventory = await player.admin.from('garden_inventory').select('quantity')
      .eq('save_id',initial.save.id).eq('item_key','bee_feed').single();
    assertRpcSuccess('read race feed fixture', [inventory]);
    expect(inventory.data?.quantity).toBe(1);
  });
});
