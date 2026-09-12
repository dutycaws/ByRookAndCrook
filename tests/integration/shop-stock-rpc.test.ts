import { afterEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../../src/lib/database.types';
import { commitGardenCommand, getSnapshot } from '../../src/lib/server/game';
import { createTestPlayer, getLocalSupabase } from '../helpers/local-supabase';
import { assertRpcSuccess } from '../helpers/rpc-diagnostics';

const createdUsers: Array<{ admin: SupabaseClient<Database>; userId: string }> = [];

afterEach(async () => {
  const deleted = await Promise.all(
    createdUsers.splice(0).map(({ admin, userId }) => admin.auth.admin.deleteUser(userId))
  );
  for (const result of deleted) expect(result.error).toBeNull();
});

describe('Shop stock RPC', () => {
  it('serializes two clients buying the final unit and replays only the winning receipt', async () => {
    const player = await createTestPlayer('shop-stock-race');
    createdUsers.push(player);
    assertRpcSuccess('create tavern', [await player.client.rpc('create_tavern')]);

    const local = getLocalSupabase();
    const secondClient = createClient<Database>(local.url, local.publishableKey, {
      auth: { persistSession: false, autoRefreshToken: false }
    });
    const signedIn = await secondClient.auth.signInWithPassword({
      email: player.email,
      password: player.password
    });
    expect(signedIn.error).toBeNull();

    const beforeRace = (await getSnapshot(player.client))!;
    execFileSync('docker', [
      'exec', 'supabase_db_by-rook-and-crook', 'psql', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1',
      '-c', `update public.tavern_saves set gold=100 where id='${beforeRace.save.id}'`
    ], { stdio: 'pipe' });
    const fundedRace = (await getSnapshot(player.client))!;
    const initialHives = fundedRace.garden!.inventory.find((item) => item.itemKey === 'hive_equipment')?.quantity ?? 0;

    const firstActionId = crypto.randomUUID();
    const secondActionId = crypto.randomUUID();
    const baseCommand = {
      saveId: fundedRace.save.id,
      expectedRevision: fundedRace.save.revision,
      commandKind: 'purchase' as const,
      payload: { itemKey: 'hive_equipment', quantity: 1 }
    };
    const attempts = await Promise.allSettled([
      commitGardenCommand(player.client, { ...baseCommand, actionId: firstActionId }),
      commitGardenCommand(secondClient, { ...baseCommand, actionId: secondActionId })
    ]);

    const successfulAttempt = attempts.find(
      (attempt): attempt is PromiseFulfilledResult<Awaited<ReturnType<typeof commitGardenCommand>>> =>
        attempt.status === 'fulfilled'
    );
    const rejectedAttempt = attempts.find(
      (attempt): attempt is PromiseRejectedResult => attempt.status === 'rejected'
    );
    expect(successfulAttempt).toBeDefined();
    expect(rejectedAttempt).toBeDefined();
    expect(attempts.filter((attempt) => attempt.status === 'fulfilled')).toHaveLength(1);
    expect(rejectedAttempt!.reason).toMatchObject({ status: 409, code: 'PT409' });

    const winningReceipt = successfulAttempt!.value;
    const winningClient = winningReceipt.actionId === firstActionId ? player.client : secondClient;
    const replay = await commitGardenCommand(winningClient, {
      ...baseCommand,
      actionId: winningReceipt.actionId
    });
    expect(replay).toEqual(winningReceipt);

    const afterRace = (await getSnapshot(player.client))!;
    const hiveStock = afterRace.garden!.shop.find((item) => item.itemKey === 'hive_equipment');
    const hiveInventory = afterRace.garden!.inventory.find((item) => item.itemKey === 'hive_equipment');
    expect(hiveStock?.remainingStock).toBe(0);
    expect(afterRace.save).toMatchObject({
      gold: fundedRace.save.gold! - 30,
      revision: fundedRace.save.revision + 1
    });
    expect(hiveInventory?.quantity).toBe(initialHives + 1);
  });
});
