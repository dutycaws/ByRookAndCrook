import { createTestPlayer } from './local-supabase';
import { parseSnapshot, parseCompleteBrewReceipt, parseStartBrewReceipt } from '../../src/lib/game/contracts';

/** Real garden and brewery commands, with only the local fixture clock advanced. */
export async function createBrewedTavern(prefix: string) {
  const player = await createTestPlayer(prefix);
  try {
    const created = await player.client.rpc('create_tavern');
    if (created.error) throw created.error;
    const initial = parseSnapshot((await player.client.rpc('get_tavern_snapshot')).data)!;
    const harvested = await player.client.rpc('harvest_crop', {
      p_save_id: initial.save.id, p_cell_id: initial.cells.find((cell) => cell.layoutKey === 'c1')!.id,
      p_action_id: crypto.randomUUID(), p_expected_revision: 0
    });
    if (harvested.error) throw harvested.error;
    const pantry = parseSnapshot((await player.client.rpc('get_tavern_snapshot')).data)!;
    const started = await player.client.rpc('start_brew', {
      p_save_id: initial.save.id, p_ingredient_batch_id: pantry.ingredients[0].id,
      p_action_id: crypto.randomUUID(), p_expected_revision: 1
    });
    if (started.error) throw started.error;
    const session = parseStartBrewReceipt(started.data);
    const backdated = await player.admin.from('brew_sessions')
      .update({ started_at: new Date(Date.now() - 18_000).toISOString() }).eq('id', session.sessionId);
    if (backdated.error) throw backdated.error;
    const completed = await player.client.rpc('complete_brew', {
      p_save_id: initial.save.id, p_session_id: session.sessionId, p_expected_revision: 2,
      p_action_id: crypto.randomUUID(), p_perfect_ticks: 60, p_good_ticks: 0, p_total_ticks: 60
    });
    if (completed.error) throw completed.error;
    return { ...player, saveId: initial.save.id, brew: parseCompleteBrewReceipt(completed.data) };
  } catch (cause) {
    await player.admin.auth.admin.deleteUser(player.userId);
    throw cause;
  }
}
