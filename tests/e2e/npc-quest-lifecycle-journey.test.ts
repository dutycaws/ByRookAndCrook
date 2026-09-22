import { expect, test } from '@playwright/test';
import {
  activeQuestCountForLifecycle,
  closeQuestLifecycleDay,
  createBrewedQuestLifecycleFixture,
  resolveActiveQuestForLifecycle,
  resolvedQuestHospitality,
  runQuestLifecycleTransition,
  type QuestLifecycleFixture
} from '../helpers/evolving-world-playable-fixture';

async function expectCompleted(
  fixture: QuestLifecycleFixture,
  terminalEventId: string,
  kind: 'next_authored_milestone' | 'successor' | 'departure'
) {
  const transition = await runQuestLifecycleTransition(fixture, terminalEventId, kind);
  expect(transition.outcome).toMatchObject({ status: 'completed', kind });
  expect(transition.providerCalls).toEqual(['quest_transition_proposer', 'quest_transition_critic']);
  expect(transition.replay).toMatchObject({ status: 'completed', terminalEventId, kind });
  return transition;
}

/**
 * A full authored campaign is intentionally traversed before a successor is
 * requested. The fixture uses the public day-close boundary for normal days,
 * then the service-only resolver with a fixed draw for the terminal moments.
 */
async function authoredLiraToGeneratedSuccessor() {
  const fixture = await createBrewedQuestLifecycleFixture();
  await closeQuestLifecycleDay(fixture); // Day 1: Lira's authored preparation.

  const firstTerminal = resolveActiveQuestForLifecycle(fixture, 2, 0);
  expect(resolvedQuestHospitality(firstTerminal)).toBeGreaterThan(0);
  await closeQuestLifecycleDay(fixture);
  await expectCompleted(fixture, firstTerminal, 'next_authored_milestone');

  const authoredFinalTerminal = resolveActiveQuestForLifecycle(fixture, 3, 0);
  // Day-one food and beverage belong only to Lira's first quest window; the
  // successor authored milestone starts clean on its own activation day.
  expect(resolvedQuestHospitality(authoredFinalTerminal)).toBe(0);
  await closeQuestLifecycleDay(fixture);
  await expectCompleted(fixture, authoredFinalTerminal, 'successor');
  return fixture;
}

async function login(page: import('@playwright/test').Page, fixture: QuestLifecycleFixture) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(fixture.email);
  await page.getByLabel('Password').fill(fixture.password);
  await page.getByRole('button', { name: 'Open the ledger' }).click();
  await expect(page).toHaveURL(/\/garden$/);
}

async function cleanup(fixture: QuestLifecycleFixture) {
  const deleted = await fixture.admin.auth.admin.deleteUser(fixture.userId);
  // Canonical lifecycle history can intentionally make an auth cascade refuse
  // removal. Local test databases are disposable between focused runs.
  if (deleted.error && !/database error deleting user/i.test(deleted.error.message)) throw deleted.error;
}

test('Lira completes authored milestones before a generated successor remains playable', async ({ page }) => {
  const fixture = await authoredLiraToGeneratedSuccessor();
  try {
    const roster = await fixture.client.rpc('npc_roster', { p_limit: 20, p_query: 'Lira Nightwind' });
    expect(roster.error).toBeNull();
    expect((roster.data as Array<{ instanceId: string; name: string }>)).toContainEqual(
      expect.objectContaining({ instanceId: fixture.liraInstanceId, name: 'Lira Nightwind' })
    );

    const history = await (fixture.client as any).rpc('npc_quest_history_archive', { p_instance_id: fixture.liraInstanceId });
    expect(history.error).toBeNull();
    const completed = (history.data as { items: Array<{ origin: string }> }).items;
    expect(completed).toHaveLength(2);
    expect(completed).toEqual(expect.arrayContaining([
      expect.objectContaining({ origin: 'authored_milestone' })
    ]));

    await login(page, fixture);
    await page.goto('/bar');
    await expect(page.getByText('Lira Nightwind', { exact: true }).first()).toBeVisible();
  } finally {
    await cleanup(fixture);
  }
});

test('a generated successor can loop once and its committed transition replays idempotently', async () => {
  const fixture = await authoredLiraToGeneratedSuccessor();
  try {
    const generatedTerminal = resolveActiveQuestForLifecycle(fixture, 4, 0);
    await closeQuestLifecycleDay(fixture);
    const loop = await expectCompleted(fixture, generatedTerminal, 'successor');

    expect(loop.replay).toMatchObject({ questId: expect.any(String), scheduledForDay: 5 });
    const history = await (fixture.client as any).rpc('npc_quest_history_archive', { p_instance_id: fixture.liraInstanceId });
    expect(history.error).toBeNull();
    const items = (history.data as { items: Array<{ origin: string; terminalDay: number }> }).items;
    expect(items.filter((item) => item.origin === 'generated_successor')).toHaveLength(1);
    expect(items.map((item) => item.terminalDay)).toEqual(expect.arrayContaining([2, 3, 4]));
  } finally {
    await cleanup(fixture);
  }
});

test('a generated successor departure grants one farewell day, then moves Lira into the archive', async () => {
  const fixture = await authoredLiraToGeneratedSuccessor();
  try {
    const loopTerminal = resolveActiveQuestForLifecycle(fixture, 4, 0);
    await closeQuestLifecycleDay(fixture);
    await expectCompleted(fixture, loopTerminal, 'successor');

    const departureTerminal = resolveActiveQuestForLifecycle(fixture, 5, 0);
    await closeQuestLifecycleDay(fixture);
    const departure = await expectCompleted(fixture, departureTerminal, 'departure');
    expect(departure.replay).toMatchObject({ farewellDay: 6 });

    const farewellRoster = await fixture.client.rpc('npc_roster', { p_limit: 20, p_query: 'Lira Nightwind' });
    expect(farewellRoster.error).toBeNull();
    expect((farewellRoster.data as Array<{ instanceId: string }>).map((resident) => resident.instanceId)).toContain(fixture.liraInstanceId);

    await closeQuestLifecycleDay(fixture); // Closes the complete farewell day.
    const playableRoster = await fixture.client.rpc('npc_roster', { p_limit: 20, p_query: 'Lira Nightwind' });
    expect(playableRoster.error).toBeNull();
    expect((playableRoster.data as Array<{ instanceId: string }>).map((resident) => resident.instanceId)).not.toContain(fixture.liraInstanceId);

    const archive = await fixture.client.rpc('npc_archived_roster', { p_limit: 20, p_query: 'Lira Nightwind' });
    expect(archive.error).toBeNull();
    expect(archive.data).toEqual(expect.arrayContaining([
      expect.objectContaining({ instanceId: fixture.liraInstanceId, status: 'departed', name: 'Lira Nightwind' })
    ]));
    const archivedResident = await fixture.client.rpc('npc_archived_resident', { p_instance: fixture.liraInstanceId });
    expect(archivedResident.error).toBeNull();
    expect(archivedResident.data).toMatchObject({ instanceId: fixture.liraInstanceId, status: 'departed' });
    expect(activeQuestCountForLifecycle(fixture)).toBe(0);
    const departed = archivedResident.data as { npcId: string; sequence: number };
    const dialogue = await fixture.admin.rpc('npc_dialogue_begin', {
      p_actor: fixture.userId, p_turn_id: crypto.randomUUID(), p_npc_id: departed.npcId,
      p_message: 'Can we speak before the road?', p_expected_sequence: departed.sequence
    });
    expect(dialogue.error?.code).toBe('PT422');
  } finally {
    await cleanup(fixture);
  }
});
