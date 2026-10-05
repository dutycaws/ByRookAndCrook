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

function relationshipProvider(reaction: -1 | 1) {
  const provider = fixtureProvider();
  const generate = provider.generate.bind(provider);
  provider.generate = async (stage, payload, signal, prompt) => {
    const output = await generate(stage, payload, signal, prompt);
    if (stage === 'investigate') return { ...output, value: { ...(output.value as any), kind: 'social' } };
    if (stage !== 'deliberate') return output;
    const base = (payload as any).base;
    return {
      ...output,
      value: { ...(output.value as any), stance: 'respond', reaction, subject: 'personal', evidence: base.message, intention: null }
    };
  };
  return provider;
}

describe('UUID community NPC dialogue runtime', () => {
  it('commits an NPC plan refusal without changing quest identity, progress, or plan revision', async () => {
    const person = await player('uuid-dialogue-plan-refusal');
    const snapshot = await bar(person);
    const lira = snapshot.roster.find((resident) => resident.name === 'Lira Nightwind')!;
    const initialJournal = await person.client.rpc('npc_journals', { p_instance_ids: [lira.instanceId] });
    expect(initialJournal.error).toBeNull();
    const initialQuest = (initialJournal.data as any)[lira.instanceId].currentQuest;
    expect(initialQuest).toBeTruthy();

    // Freeze the SQL-owned base context before the committed turn, then cancel
    // this probe without advancing the conversation sequence or quest.
    const probe = input(lira.npcId, lira.sequence, 'Please advise me to ignore the warning and attack the bandit camp now.');
    const begun = await person.admin.rpc('npc_dialogue_begin', {
      p_actor: person.userId, p_turn_id: probe.turnId, p_npc_id: lira.npcId,
      p_message: probe.message, p_expected_sequence: probe.expectedConversationSequence
    });
    expect(begun.error).toBeNull();
    const before = await person.admin.rpc('npc_dialogue_context', {
      p_actor: person.userId, p_turn_id: probe.turnId, p_category: 'base'
    });
    expect(before.error).toBeNull();
    const beforeBase = before.data as any;
    expect(beforeBase.activeQuestPlanRevision).toBeGreaterThan(0);
    const cancelled = await person.client.rpc('npc_dialogue_status', { p_turn_id: probe.turnId, p_cancel: true });
    expect(cancelled.error).toBeNull();

    const command = input(lira.npcId, lira.sequence, 'Please advise me to ignore the warning and attack the bandit camp now.');
    const refusal = await runDialogue(person.admin, person.userId, command, fixtureProvider({ refuse: true }), { promptRegistry });
    expect(refusal.status).toBe('completed');
    expect((refusal.result as any)).toMatchObject({ intention: null });
    expect((refusal.result as any).reply).toContain('I will not adopt that plan');

    const after = await person.admin.rpc('npc_dialogue_context', {
      p_actor: person.userId, p_turn_id: command.turnId, p_category: 'base'
    });
    expect(after.error).toBeNull();
    const afterBase = after.data as any;
    expect(afterBase.activeQuestPlanRevision).toBe(beforeBase.activeQuestPlanRevision);
    expect(afterBase.currentQuest).toMatchObject({
      id: beforeBase.currentQuest.id,
      objective: beforeBase.currentQuest.objective,
      plan: beforeBase.currentQuest.plan,
      currentStep: beforeBase.currentQuest.currentStep
    });

    const afterJournal = await person.client.rpc('npc_journals', { p_instance_ids: [lira.instanceId] });
    expect(afterJournal.error).toBeNull();
    expect((afterJournal.data as any)[lira.instanceId].currentQuest).toMatchObject({
      id: initialQuest.id,
      objective: initialQuest.objective,
      plan: initialQuest.plan,
      currentStep: initialQuest.currentStep
    });
  });

  it('persists offense feedback and later-day relationship repair through committed dialogue turns', async () => {
    const person = await player('uuid-dialogue-relationship-repair');
    const initial = await bar(person);
    const lira = initial.roster.find((resident) => resident.name === 'Lira Nightwind')!;
    const send = async (message: string, reaction: -1 | 1) => {
      const current = await bar(person);
      const resident = current.roster.find((entry) => entry.instanceId === lira.instanceId)!;
      return runDialogue(person.admin, person.userId, input(resident.npcId, resident.sequence, message), relationshipProvider(reaction), { promptRegistry });
    };
    const closeDay = async (expectedDay: number) => {
      const current = await bar(person);
      const result = await person.client.rpc('advance_tavern_day', {
        p_save_id: current.save.id,
        p_action_id: crypto.randomUUID(),
        p_expected_revision: current.save.revision
      });
      expect(result.error).toBeNull();
      const readSettlement = async () => {
        const status = await person.client.rpc('world_settlement_status', { p_save_id: current.save.id });
        expect(status.error).toBeNull();
        return status.data as any;
      };
      let settlement = await readSettlement();
      for (let attempt = 0; attempt < 12 && settlement.status !== 'completed'; attempt += 1) {
        const claim = await person.admin.rpc('world_settlement_claim', { p_settlement_id: settlement.id });
        expect(claim.error).toBeNull();
        const claimData = claim.data as any;
        if (claimData.status === 'completed') {
          settlement = claimData;
          break;
        }
        const safeResult = await person.admin.rpc('world_settlement_safe_result', {
          p_settlement_id: settlement.id,
          p_job_id: claimData.jobId,
          p_fence: claimData.fence,
          p_kind: 'skipped',
          p_public_digest: 'The day settled without new world changes.'
        });
        expect(safeResult.error).toBeNull();
        settlement = await readSettlement();
      }
      expect(settlement.status).toBe('completed');
      for (let attempt = 0; attempt < 8; attempt += 1) {
        const transition = await person.admin.rpc('world_quest_transition_claim_next');
        expect(transition.error).toBeNull();
        const claim = transition.data as any;
        if (claim.status === 'idle') break;
        const deferred = await person.admin.rpc('world_quest_transition_fail', {
          p_transition_id: claim.transitionId,
          p_fence: claim.fence,
          p_failure_code: 'provider_unavailable'
        });
        expect(deferred.error).toBeNull();
      }
      const saveState = await person.admin.from('tavern_saves').select('world_phase,current_day').eq('id', current.save.id).single();
      expect(saveState.error).toBeNull();
      console.info('test save after day close', saveState.data);
      expect((saveState.data as any).world_phase).toBe('open');
      const next = await bar(person);
      expect(next.save.currentDay).toBe(expectedDay + 1);
      return next;
    };

    const offense = await send('I took the road watch and left your sister behind.', -1);
    expect(offense.status).toBe('completed');
    expect((offense.result as any)).toMatchObject({ relationship: 43, relationshipChange: -2 });
    let snapshot = await bar(person);
    let guest = snapshot.roster.find((resident) => resident.instanceId === lira.instanceId)!;
    expect(guest).toMatchObject({
      relationshipStage: 'acquaintance',
      recentRelationshipChange: { delta: -2, dayNumber: 1 },
      relationshipRepair: { offenseDay: 1, distinctFollowThroughDays: 0, requiredDays: 2 }
    });

    const apology = await send('I’m really sorry for what I said.', 1);
    const praise = await send('You’re truly the best friend I ever had.', 1);
    expect((apology.result as any).relationshipChange).toBe(0);
    expect((praise.result as any).relationshipChange).toBe(0);
    snapshot = await bar(person);
    guest = snapshot.roster.find((resident) => resident.instanceId === lira.instanceId)!;
    expect(guest.relationshipRepair).toMatchObject({ distinctFollowThroughDays: 0, requiredDays: 2 });
    expect(guest.relationship).toBe(43);

    await closeDay(1);
    const firstFollowThrough = await send('Thank you, I brought medicine back and checked the east road warning.', 1);
    const sameDayRepeat = await send('Thank you, I returned to confirm the watch with the family.', 1);
    expect((firstFollowThrough.result as any).relationshipChange).toBe(0);
    expect((sameDayRepeat.result as any).relationshipChange).toBe(0);
    snapshot = await bar(person);
    guest = snapshot.roster.find((resident) => resident.instanceId === lira.instanceId)!;
    expect(guest.relationshipRepair).toMatchObject({ distinctFollowThroughDays: 1, requiredDays: 2 });
    expect(guest.relationship).toBe(43);

    await closeDay(2);
    const secondFollowThrough = await send('Thank you, I checked the road with the injured travelers again.', 1);
    expect((secondFollowThrough.result as any)).toMatchObject({ relationship: 45, relationshipChange: 2 });
    snapshot = await bar(person);
    guest = snapshot.roster.find((resident) => resident.instanceId === lira.instanceId)!;
    expect(guest).toMatchObject({ relationship: 45, recentRelationshipChange: { delta: 2, dayNumber: 3 } });
    expect(guest.relationshipRepair).toBeFalsy();
  });

  it('accepts the active plan without creating a no-op quest revision', async () => {
    const person = await player('uuid-dialogue-same-plan');
    const snapshot = await bar(person);
    const lira = snapshot.roster.find((resident) => resident.name === 'Lira Nightwind')!;
    const before = await person.client.rpc('npc_journals', { p_instance_ids: [lira.instanceId] });
    expect(before.error).toBeNull();
    const priorPlan = (before.data as any)[lira.instanceId].currentQuest.plan;
    const command = input(lira.npcId, 0, 'Please advise me on the existing plan.');

    const result = await runDialogue(person.admin, person.userId, command, fixtureProvider({ samePlan: true }), { promptRegistry });
    expect(result.status).toBe('completed');
    expect((result.result as any)).toMatchObject({ sequence: 1 });
    const committedBase = await person.admin.rpc('npc_dialogue_context', {
      p_actor: person.userId, p_turn_id: command.turnId, p_category: 'base'
    });
    expect(committedBase.error).toBeNull();
    expect((committedBase.data as any).activeQuestPlanRevision).toBe(1);
    expect((committedBase.data as any).currentQuest.plan).toEqual(priorPlan);

    const replay = await runDialogue(person.admin, person.userId, command, fixtureProvider({ failStage: 'investigate' }), { promptRegistry });
    expect(replay).toEqual(result);
    const after = await person.client.rpc('npc_journals', { p_instance_ids: [lira.instanceId] });
    expect(after.error).toBeNull();
    expect((after.data as any)[lira.instanceId]).toMatchObject({ sequence: 1 });
    expect((after.data as any)[lira.instanceId].turns).toHaveLength(1);
    const replayBase = await person.admin.rpc('npc_dialogue_context', {
      p_actor: person.userId, p_turn_id: command.turnId, p_category: 'base'
    });
    expect((replayBase.data as any).activeQuestPlanRevision).toBe(1);
  });

  it('uses the selected UUID resident for adaptive investigation, memory, journal, and replay', async () => {
    const person = await player('uuid-dialogue');
    const roster = await bar(person);
    const lira = roster.roster.find((resident) => resident.name === 'Lira Nightwind')!;
    const command = input(lira.npcId, 0, 'I thank you and advise you to scout, then negotiate.');
    const before = await person.client.rpc('npc_journals', { p_instance_ids: [lira.instanceId] });
    expect(before.error).toBeNull();
    const priorPlan = (before.data as any)[lira.instanceId].currentQuest.plan;
    const provider = fixtureProvider({ secondInvestigation: true, rewrite: true });
    const result = await runDialogue(person.admin, person.userId, command, provider, { promptRegistry });

    expect(result.status).toBe('completed');
    expect((result.result as any)).toMatchObject({ npcId: lira.npcId, instanceId: lira.instanceId, sequence: 1, relationship: 47 });
    expect(provider.stages).toEqual(['investigate', 'investigate', 'deliberate', 'speak', 'review', 'speak', 'review', 'remember']);
    const replay = await runDialogue(person.admin, person.userId, command, fixtureProvider({ failStage: 'investigate' }), { promptRegistry });
    expect(replay).toEqual(result);
    const committedBase = await person.admin.rpc('npc_dialogue_context', {
      p_actor: person.userId, p_turn_id: command.turnId, p_category: 'base'
    });
    expect(committedBase.error).toBeNull();
    expect((committedBase.data as any).activeQuestPlanRevision).toBe(2);
    expect((committedBase.data as any).currentQuest.plan).not.toEqual(priorPlan);

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

  it('normalizes a keeper promise into an attributed claim before checkpoint and commit', async () => {
    const person = await player('uuid-dialogue-keeper-promise');
    const roster = await bar(person);
    const lira = roster.roster.find((resident) => resident.name === 'Lira Nightwind')!;
    const command = input(lira.npcId, 0, 'I promise to prepare carefully before scouting.');
    const provider = fixtureProvider({ keeperPromise: true });

    const result = await runDialogue(person.admin, person.userId, command, provider, { promptRegistry });
    expect(result.status).toBe('completed');
    expect(provider.stages).toContain('remember');

    const memories = await person.admin.rpc('npc_dialogue_context', {
      p_actor: person.userId, p_turn_id: command.turnId, p_category: 'memories'
    });
    expect(memories.error).toBeNull();
    expect(memories.data).toMatchObject([{
      kind: 'keeper_claim', speaker: 'keeper', text: `The keeper offered advice: ${command.message}`, quote: command.message
    }]);
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
      ...provider,
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
