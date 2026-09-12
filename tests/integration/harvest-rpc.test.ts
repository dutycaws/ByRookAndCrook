import { afterEach, describe, expect, it } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Database, Json } from '../../src/lib/database.types';
import { createTestPlayer, getLocalSupabase } from '../helpers/local-supabase';
import { assertRpcSuccess } from '../helpers/rpc-diagnostics';

const createdUsers: Array<{ admin: SupabaseClient<Database>; userId: string }> = [];

function asSnapshot(data: Json | null) {
  return data as unknown as {
    save: { id: string; revision: number };
    cells: Array<{ id: string; layoutKey: string; unlocked?: boolean }>;
    ingredients: Array<{ plantKey: string; quantity: number }>;
  };
}

afterEach(async () => {
  const deleted = await Promise.all(createdUsers.splice(0).map(({ admin, userId }) => admin.auth.admin.deleteUser(userId)));
  for (const result of deleted) expect(result.error).toBeNull();
});

describe('garden harvest RPC', () => {
  it.each(['shared', 'independent'] as const)('initializes once with %s clients and preserves progress on later creation', async (mode) => {
    const player = await createTestPlayer('initialization');
    createdUsers.push(player);
    const local = getLocalSupabase();
    const independent = mode === 'shared' ? player.client : createClient<Database>(local.url, local.publishableKey, {
      auth: { persistSession: false, autoRefreshToken: false }
    });
    if (mode === 'independent') {
      const signedIn = await independent.auth.signInWithPassword({ email: player.email, password: player.password });
      expect(signedIn.error).toBeNull();
    }
    const created = await Promise.all([player.client.rpc('create_tavern'), independent.rpc('create_tavern')]);
    assertRpcSuccess('create_tavern', created);
    const receipts = created.map(({ data }) => data as { saveId: string; created: boolean });
    expect(receipts[0].saveId).toEqual(expect.any(String));
    expect(receipts[0].saveId).not.toBe('');
    expect(receipts[1].saveId).toBe(receipts[0].saveId);
    expect(receipts.map(({ created }) => created).sort()).toEqual([false, true]);

    const saves = await player.client.from('tavern_saves').select('id, revision').eq('user_id', player.userId);
    assertRpcSuccess('select tavern_saves', [saves]);
    expect(saves.data).toEqual([{ id: receipts[0].saveId, revision: 0 }]);
    const cells = await player.client.from('garden_cells')
      .select('id, layout_key, col, row, kind, plant_key, growth_stage, water, health, unlocked')
      .eq('save_id', receipts[0].saveId).order('row').order('col');
    assertRpcSuccess('select garden_cells', [cells]);
    expect(new Set(cells.data?.map(({ id }) => id)).size).toBe(24);
    expect(cells.data?.filter(({ unlocked }) => unlocked)).toHaveLength(12);
    const layout = [
      ['plant', 'hops', 3, 70, 90], ['plant', 'fennel', 3, 55, 85], ['beehive', null, null, null, null],
      ['empty', null, null, null, null], ['plant', 'pepper', 2, 78, 88], ['empty', null, null, null, null],
      ['plant', 'chamomile', 1, 42, 72], ['plant', 'tomatoes', 3, 80, 91], ['plant', 'lavender', 2, 60, 80],
      ['empty', null, null, null, null], ['plant', 'sage', 1, 35, 65], ['empty', null, null, null, null]
    ];
    expect(cells.data?.filter(({ unlocked }) => unlocked).map(({ id, unlocked, ...cell }) => cell)).toEqual(layout.map(([kind, plant_key, growth_stage, water, health], index) => ({
      layout_key: `c${index}`, col: index % 3, row: Math.floor(index / 3), kind, plant_key, growth_stage, water, health
    })));
    const harvested = await player.client.rpc('harvest_crop', {
      p_save_id: receipts[0].saveId, p_cell_id: cells.data![0].id,
      p_action_id: crypto.randomUUID(), p_expected_revision: 0
    });
    assertRpcSuccess('harvest_crop', [harvested]);
    const before = await player.client.rpc('get_tavern_snapshot');
    assertRpcSuccess('get_tavern_snapshot', [before]);
    const later = await independent.rpc('create_tavern');
    assertRpcSuccess('create_tavern later', [later]);
    expect(later.data).toEqual({ saveId: receipts[0].saveId, created: false });
    const after = await player.client.rpc('get_tavern_snapshot');
    assertRpcSuccess('get_tavern_snapshot', [after]);
    expect(after.data).toEqual(before.data);
    expect(asSnapshot(after.data).save.revision).toBe(1);

    const stranger = await createTestPlayer('independent');
    createdUsers.push(stranger);
    const other = await stranger.client.rpc('create_tavern');
    assertRpcSuccess('create_tavern other user', [other]);
    expect(other.data).toEqual({ saveId: expect.any(String), created: true });
    expect((other.data as { saveId: string }).saveId).not.toBe(receipts[0].saveId);
    const anonymous = createClient<Database>(local.url, local.publishableKey, {
      auth: { persistSession: false, autoRefreshToken: false }
    });
    const denied = await anonymous.rpc('create_tavern');
    expect(denied.error?.code).toBe('42501');
    const direct = await player.client.from('tavern_saves').insert({ user_id: player.userId });
    expect(direct.error?.code).toBe('42501');
  });

  it('commits identical harvest retries exactly once', async () => {
    const player = await createTestPlayer('concurrency');
    createdUsers.push(player);

    assertRpcSuccess('create_tavern harvest setup', [await player.client.rpc('create_tavern')]);

    const initialResult = await player.client.rpc('get_tavern_snapshot');
    expect(initialResult.error).toBeNull();
    const initial = asSnapshot(initialResult.data);
    expect(initial.cells).toHaveLength(24);
    expect(initial.cells.filter((cell) => cell.unlocked)).toHaveLength(12);

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
    createdUsers.push(owner);
    const stranger = await createTestPlayer('stranger');
    createdUsers.push(stranger);
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
    expect(ownerAfter.ingredients).toEqual([expect.objectContaining({ plantKey: 'fennel', quantity: 1 })]);

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
