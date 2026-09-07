import { afterEach, describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, Json } from '../../src/lib/database.types';
import { createTestPlayer } from '../helpers/local-supabase';

const createdUsers: Array<{ admin: SupabaseClient<Database>; userId: string }> = [];

function asSnapshot(data: Json | null) {
  return data as unknown as {
    save: { id: string; revision: number };
    cells: Array<{ id: string; layoutKey: string }>;
    ingredients: Array<{ plantKey: string; quantity: number }>;
  };
}

afterEach(async () => {
  await Promise.all(createdUsers.splice(0).map(({ admin, userId }) => admin.auth.admin.deleteUser(userId)));
});

describe('garden harvest RPC', () => {
  it('initializes once and commits identical retries exactly once', async () => {
    const player = await createTestPlayer('concurrency');
    createdUsers.push(player);

    const created = await Promise.all([player.client.rpc('create_tavern'), player.client.rpc('create_tavern')]);
    expect(created.every(({ error }) => error === null)).toBe(true);

    const initialResult = await player.client.rpc('get_tavern_snapshot');
    expect(initialResult.error).toBeNull();
    const initial = asSnapshot(initialResult.data);
    expect(initial.cells).toHaveLength(12);

    const c0 = initial.cells.find((cell) => cell.layoutKey === 'c0')!;
    const actionId = crypto.randomUUID();
    const input = {
      p_save_id: initial.save.id,
      p_cell_id: c0.id,
      p_action_id: actionId,
      p_expected_revision: initial.save.revision
    };
    const [first, replay] = await Promise.all([
      player.client.rpc('harvest_crop', input),
      player.client.rpc('harvest_crop', input)
    ]);

    expect(first.error).toBeNull();
    expect(replay.error).toBeNull();
    expect(first.data).toEqual(replay.data);

    const after = asSnapshot((await player.client.rpc('get_tavern_snapshot')).data);
    expect(after.save.revision).toBe(1);
    expect(after.ingredients).toEqual([expect.objectContaining({ plantKey: 'hops', quantity: 1 })]);
  });

  it('serializes competing actions and isolates another player', async () => {
    const owner = await createTestPlayer('owner');
    const stranger = await createTestPlayer('stranger');
    createdUsers.push(owner, stranger);
    await owner.client.rpc('create_tavern');
    await stranger.client.rpc('create_tavern');

    const ownerSnapshot = asSnapshot((await owner.client.rpc('get_tavern_snapshot')).data);
    const c1 = ownerSnapshot.cells.find((cell) => cell.layoutKey === 'c1')!;
    const args = (actionId: string) => ({
      p_save_id: ownerSnapshot.save.id,
      p_cell_id: c1.id,
      p_action_id: actionId,
      p_expected_revision: 0
    });
    const competitors = await Promise.all([
      owner.client.rpc('harvest_crop', args(crypto.randomUUID())),
      owner.client.rpc('harvest_crop', args(crypto.randomUUID()))
    ]);

    expect(competitors.filter(({ error }) => error === null)).toHaveLength(1);
    expect(competitors.find(({ error }) => error)?.error?.code).toBe('PT409');

    const ownerAfter = asSnapshot((await owner.client.rpc('get_tavern_snapshot')).data);
    expect(ownerAfter.save.revision).toBe(1);
    expect(ownerAfter.ingredients).toEqual([expect.objectContaining({ plantKey: 'fennel', quantity: 2 })]);

    const foreignAttempt = await stranger.client.rpc('harvest_crop', {
      ...args(crypto.randomUUID()),
      p_expected_revision: 0
    });
    expect(foreignAttempt.error?.code).toBe('PT404');

    const directWrite = await owner.client
      .from('garden_cells')
      .update({ kind: 'empty' })
      .eq('save_id', ownerSnapshot.save.id);
    expect(directWrite.error).not.toBeNull();
  });
});
