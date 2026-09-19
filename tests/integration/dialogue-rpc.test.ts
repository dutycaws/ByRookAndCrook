import { afterEach, describe, expect, it } from 'vitest';
import { createTestPlayer } from '../helpers/local-supabase';
import { createBrewedTavern } from '../helpers/brewed-tavern';
import { runDialogue } from '../../src/lib/server/dialogue/orchestrator';
import { fixtureProvider } from '../helpers/dialogue-provider';
import { parseBarSnapshot } from '../../src/lib/game/serving';
import type { DialogueInput } from '../../src/lib/game/dialogue';
import { fixturePromptRegistry } from '../helpers/prompt-registry-fixture';

type Player = Awaited<ReturnType<typeof createTestPlayer>>;
const players: Player[] = [];
const promptRegistry = fixturePromptRegistry();

afterEach(async () => {
  await Promise.all(players.splice(0).map(({ admin, userId }) => admin.auth.admin.deleteUser(userId)));
});

async function player(prefix: string) {
  const person = await createTestPlayer(prefix);
  players.push(person);
  expect((await person.client.rpc('create_tavern')).error).toBeNull();
  return person;
}

async function bar(person: Player) {
  const result = await person.client.rpc('npc_bar_snapshot');
  expect(result.error).toBeNull();
  return parseBarSnapshot(result.data!)!;
}

function input(npcId: string, expectedConversationSequence = 0, message = 'How is the quest going?'): DialogueInput {
  return { turnId: crypto.randomUUID(), npcId, message, expectedConversationSequence, interactionVersion: 'dialogue-v2' };
}

describe('UUID community NPC dialogue runtime', () => {
  it('uses the selected UUID resident for adaptive investigation, memory, journal, and replay', async () => {
    const person = await player('uuid-dialogue');
    const roster = await bar(person);
    const lira = roster.roster.find((resident) => resident.name === 'Lira Nightwind')!;
    const command = input(lira.npcId, 0, 'I thank you and advise you to scout, then negotiate.');
    const provider = fixtureProvider({ secondInvestigation: true, rewrite: true });
    const result = await runDialogue(person.admin, person.userId, command, provider, { promptRegistry });

    expect(result.status).toBe('completed');
    expect((result.result as any)).toMatchObject({ npcId: lira.npcId, instanceId: lira.instanceId, sequence: 1, relationship: 47 });
    expect(provider.stages).toEqual(['investigate', 'investigate', 'deliberate', 'speak', 'review', 'speak', 'review', 'remember']);
    const replay = await runDialogue(person.admin, person.userId, command, fixtureProvider({ failStage: 'investigate' }), { promptRegistry });
    expect(replay).toEqual(result);

    const journals = await person.client.rpc('npc_journals', { p_instance_ids: [lira.instanceId] });
    expect(journals.error).toBeNull();
    expect((journals.data as any)[lira.instanceId]).toMatchObject({ sequence: 1 });
    expect((journals.data as any)[lira.instanceId].turns).toHaveLength(1);
    const memories = await person.admin.rpc('npc_dialogue_context', {
      p_actor: person.userId, p_turn_id: command.turnId, p_category: 'memories'
    });
    expect(memories.error).toBeNull();
    expect(memories.data).toMatchObject([{ kind: 'keeper_claim', quote: command.message }]);
  });

  it('keeps intent cards and hospitality independent while committing an offering atomically with its UUID turn', async () => {
    const person = await createBrewedTavern('uuid-dialogue-offering');
    players.push(person);
    const before = await bar(person);
    const lira = before.roster.find((resident) => resident.name === 'Lira Nightwind')!;
    const command = {
      ...input(lira.npcId, lira.sequence, 'Please accept this drink.'),
      intentCardId: before.intentCards[0].id,
      offering: { kind: 'beverage' as const, itemId: before.beverages[0].id }
    };
    await expect(runDialogue(person.admin, person.userId, command, fixtureProvider({ failStage: 'speak' }), { promptRegistry })).rejects.toThrow();
    const failed = await bar(person);
    expect(failed.beverages).toHaveLength(1);
    expect(failed.intentCards).toHaveLength(before.intentCards.length);

    const committed = await runDialogue(person.admin, person.userId, command, fixtureProvider(), { promptRegistry });
    expect((committed.result as any)).toMatchObject({ npcId: lira.npcId, instanceId: lira.instanceId });
    expect((committed.result as any).serving).toMatchObject({ itemKind: 'beverage', itemName: before.beverages[0].name });
    const after = await bar(person);
    expect(after.beverages).toHaveLength(0);
    expect(after.intentCards).toHaveLength(before.intentCards.length - 1);
    expect(after.history).toHaveLength(1);
  });

  it('isolates UUID turns, journals, and transcripts between taverns', async () => {
    const owner = await player('uuid-dialogue-owner');
    const stranger = await player('uuid-dialogue-stranger');
    const ownerLira = (await bar(owner)).roster.find((resident) => resident.name === 'Lira Nightwind')!;
    const strangerLira = (await bar(stranger)).roster.find((resident) => resident.name === 'Lira Nightwind')!;
    const command = input(ownerLira.npcId, 0, 'I thank you for your courage.');
    await runDialogue(owner.admin, owner.userId, command, fixtureProvider(), { promptRegistry });

    expect((await stranger.client.rpc('npc_dialogue_status', { p_turn_id: command.turnId })).error?.code).toBe('PT404');
    const foreignJournal = await stranger.client.rpc('npc_journals', { p_instance_ids: [ownerLira.instanceId] });
    expect(foreignJournal.error).toBeNull();
    expect(foreignJournal.data).toEqual({});
    // A first-party version can be reported independently from either tavern,
    // but no report operation receives the other tavern's transcript.
    expect((await stranger.client.rpc('npc_report', {
      p_version: ownerLira.versionId, p_category: 'test', p_evidence: 'Independent report for this resident.'
    })).error).toBeNull();
    const preview = await owner.client.rpc('npc_share_preview', { p_instance: ownerLira.instanceId });
    expect(preview.error).toBeNull();
    expect((preview.data as any).transcript).toHaveLength(1);
    expect((await stranger.client.rpc('npc_share_preview', { p_instance: ownerLira.instanceId })).error?.code).toBe('PT404');
    expect(strangerLira.instanceId).not.toBe(ownerLira.instanceId);
  });

  it('rejects stale selected-resident dialogue after a competing UUID hospitality action', async () => {
    const person = await createBrewedTavern('uuid-dialogue-stale');
    players.push(person);
    const stock = await bar(person);
    const lira = stock.roster.find((resident) => resident.name === 'Lira Nightwind')!;
    const torvin = stock.roster.find((resident) => resident.name === 'Torvin Ashbeard')!;
    const command = input(lira.npcId, lira.sequence, 'How is the quest going?');
    const provider = fixtureProvider();
    await expect(runDialogue(person.admin, person.userId, command, {
      async generate(stage, payload, signal, prompt) {
        const output = await provider.generate(stage, payload, signal, prompt);
        if (stage === 'review') {
          expect((await person.client.rpc('npc_serve_hospitality', {
            p_save_id: person.saveId, p_instance_id: torvin.instanceId, p_item_kind: 'beverage',
            p_item_id: stock.beverages[0].id, p_action_id: crypto.randomUUID(), p_expected_revision: stock.save.revision
          })).error).toBeNull();
        }
        return output;
      }
    }, { promptRegistry })).rejects.toMatchObject({ code: 'STATE_CHANGED' });
    const after = await bar(person);
    expect(after.history).toHaveLength(1);
    expect((await person.client.rpc('npc_journals', { p_instance_ids: [lira.instanceId] })).data).toMatchObject({ [lira.instanceId]: { sequence: 0 } });
  });
});
