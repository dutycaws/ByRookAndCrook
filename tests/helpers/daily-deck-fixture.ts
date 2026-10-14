import type { DailyDeckState } from '../../src/lib/game/daily-deck';
import { parseBarSnapshot } from '../../src/lib/game/serving';
import type { createTestPlayer } from './local-supabase';

type Player = Awaited<ReturnType<typeof createTestPlayer>>;
type Offering = { kind: 'beverage' | 'food'; itemId: string };

/** Open real service; control only the shuffle when a test needs one exact item. */
export async function openDailyDialogueCard(
  player: Player,
  options: { offering?: Offering } = {}
): Promise<{ dailyCardId: string; deck: DailyDeckState }> {
  let snapshotResult = await player.client.rpc('npc_bar_snapshot');
  if (snapshotResult.error) throw snapshotResult.error;
  let snapshot = parseBarSnapshot(snapshotResult.data!);
  if (!snapshot) throw new Error('Expected a tavern snapshot for the daily-card fixture.');

  // Advancing a day queues settlement. Finish its real fenced jobs before opening.
  const phase = await player.client.from('tavern_saves').select('world_phase').eq('id', snapshot.save.id).single();
  if (phase.error) throw phase.error;
  for (let attempt = 0; phase.data.world_phase !== 'open' && attempt < 12; attempt += 1) {
    const status = await player.client.rpc('world_settlement_status', { p_save_id: snapshot.save.id });
    if (status.error) throw status.error;
    const settlement = status.data as { id?: string; status?: string };
    if (settlement.status === 'completed') break;
    if (!settlement.id) throw new Error('Expected pending world settlement.');
    const claim = await player.admin.rpc('world_settlement_claim', { p_settlement_id: settlement.id });
    if (claim.error) throw claim.error;
    const job = claim.data as { status?: string; jobId?: string; fence?: string };
    if (job.status !== 'completed') {
      const completed = await player.admin.rpc('world_settlement_safe_result', {
        p_settlement_id: settlement.id,
        p_job_id: job.jobId!,
        p_fence: job.fence!,
        p_kind: 'skipped',
        p_public_digest: 'The integration fixture settled this morning.'
      });
      if (completed.error) throw completed.error;
    }
    snapshotResult = await player.client.rpc('npc_bar_snapshot');
    if (snapshotResult.error) throw snapshotResult.error;
    snapshot = parseBarSnapshot(snapshotResult.data!)!;
  }

  const opened = await player.client.rpc('daily_deck_open', { p_expected_revision: snapshot.save.revision });
  if (opened.error) throw opened.error;
  let deck = (opened.data as unknown as { dailyDeck: DailyDeckState }).dailyDeck;
  const matches = (card: DailyDeckState['cards'][number]) => options.offering
    ? card.kind === options.offering.kind && card.sourceId === options.offering.itemId
    : card.kind === 'social';
  let card = deck.cards.find((candidate) => matches(candidate) && deck.handIds.includes(candidate.id));
  if (!card) {
    card = deck.cards.find((candidate) => matches(candidate) && deck.drawPileIds.includes(candidate.id));
    if (!card) throw new Error('No unused matching daily card is available.');
    const displacedId = deck.handIds[deck.handIds.length - 1];
    if (!displacedId) throw new Error('Expected a hand card to swap with the fixture draw.');
    // This is fixture setup, not a gameplay action. Preserve all physical copies
    // and hand size; randomized draw/conservation have their own integration suite.
    const displaced = await player.admin.from('daily_deck_cards').update({ pile: 'draw' }).eq('id', displacedId);
    if (displaced.error) throw displaced.error;
    const selected = await player.admin.from('daily_deck_cards').update({ pile: 'hand' }).eq('id', card.id);
    if (selected.error) throw selected.error;
    const state = await player.client.rpc('daily_deck_state');
    if (state.error) throw state.error;
    deck = state.data as unknown as DailyDeckState;
  }
  return { dailyCardId: card.id, deck };
}
