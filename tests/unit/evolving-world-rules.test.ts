import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MUTATION_CHANCE,
  EVOLVING_WORLD_RULES_VERSION,
  PERSONALITY_SCHEMA_VERSION,
  clampTrait,
  canonicalizeMutationProposal,
  consumeSignedThreshold,
  createMutationReceipt,
  fingerprintMutationProposal,
  parseMutationProposal,
  pressureContribution,
  rollPasses,
  validateMutationProposal,
  validatePersonalitySchema,
  validateWorldEffectCommands,
  type PersonalityMutationProposal,
  type PersonalityProfile,
  type PersonalitySchema
} from '../../src/lib/game/evolving-world';

const schema: PersonalitySchema = {
  version: PERSONALITY_SCHEMA_VERSION,
  dimensions: [
    {
      key: 'openness', label: 'Openness', negativeAnchor: 'guarded', positiveAnchor: 'open',
      initialValue: 5, volatility: 1, core: false
    },
    {
      key: 'duty', label: 'Duty', negativeAnchor: 'self-serving', positiveAnchor: 'devoted',
      initialValue: 60, volatility: 2, core: true
    },
    {
      key: 'patience', label: 'Patience', negativeAnchor: 'rash', positiveAnchor: 'patient',
      initialValue: 20, volatility: 0.5, core: false
    },
    {
      key: 'humor', label: 'Humor', negativeAnchor: 'solemn', positiveAnchor: 'playful',
      initialValue: 10, volatility: 1, core: false
    }
  ],
  collections: [{ kind: 'value', maximumEntries: 8 }, { kind: 'voice_trait', maximumEntries: 6 }]
};

const profile: PersonalityProfile = {
  dimensions: { openness: 5, duty: 60, patience: 20, humor: 10 },
  entries: [{ id: 'keep_promises', kind: 'value', text: 'Keep a promise once given.', core: true, active: true }]
};

const capability = {
  version: 'capabilities-v1',
  allowedActions: ['prepare', 'attempt', 'wait', 'abandon'],
  allowedApproaches: ['scouting', 'combat', 'diplomacy', 'trade'],
  allowedWorldEffects: ['adjust_relationship', 'retire_entity', 'update_quest'] as const,
  allowedTargetKinds: ['npc', 'location'] as const,
  socialCapabilities: [],
  irreversibleEffects: [{ effectKey: 'departure', targetKinds: ['npc'] as const }]
};

const worldSnapshot = {
  currentDay: 4,
  entityKinds: { lira: 'npc' as const, old_road: 'location' as const },
  activeQuestIds: ['quest-1'],
  authorizedIrreversibleEffects: [{ effectKey: 'departure', targetEntityId: 'lira', criticApproved: true, visibleSinceDay: 3 }]
};

function receipt(args: {
  proposal: PersonalityMutationProposal;
  pressureByDimension: Record<string, number>;
  roll?: number;
  currentProfile?: PersonalityProfile;
}) {
  return createMutationReceipt({
    schema,
    currentProfile: args.currentProfile ?? profile,
    capabilityEnvelope: capability as never,
    worldSnapshot,
    ...args
  });
}

function proposal(overrides: Partial<PersonalityMutationProposal> = {}): PersonalityMutationProposal {
  return {
    rulesVersion: EVOLVING_WORLD_RULES_VERSION,
    evidenceIds: ['event-1'],
    salience: 'meaningful',
    dimensionChanges: [{ dimensionKey: 'openness', direction: 1, intendedDelta: 3 }],
    entryOperations: [],
    beliefOperations: [],
    causalExplanation: 'The keeper honored a difficult promise.',
    questChanges: [],
    worldEffects: [],
    ...overrides
  };
}

describe('evolving-world deterministic rules', () => {
  it('uses the agreed salience pressure and 0–99 chance boundaries', () => {
    expect(['minor', 'meaningful', 'major', 'defining'].map((band) => pressureContribution(band as never, 1, 1))).toEqual([5, 15, 30, 60]);
    expect(DEFAULT_MUTATION_CHANCE).toEqual({ minor: 15, meaningful: 35, major: 65, defining: 90 });
    expect(rollPasses(34, 35)).toBe(true);
    expect(rollPasses(35, 35)).toBe(false);
  });

  it('accumulates approved pressure without requiring a roll below threshold', () => {
    const result = receipt({ proposal: proposal(), pressureByDimension: { openness: 4 } });
    expect(result).toMatchObject({ outcome: 'pressure_only', roll: null, chancePercent: null });
    expect(result.dimensions[0]).toMatchObject({ pressureBefore: 4, pressureAdded: 15, pressureAfterCommit: 19, crossedThreshold: false, appliedDelta: 0 });
  });

  it('keeps all approved pressure when a shared mutation roll fails', () => {
    const result = receipt({ proposal: proposal({ salience: 'major' }), pressureByDimension: {}, roll: 65 });
    expect(result).toMatchObject({ outcome: 'roll_failed', chancePercent: 65, roll: 65 });
    expect(result.dimensions[0]).toMatchObject({ pressureAfterApproval: 30, pressureAfterCommit: 30, appliedDelta: 0 });
  });

  it('consumes one signed threshold and preserves excess after a successful roll', () => {
    const result = receipt({ proposal: proposal({ salience: 'major' }), pressureByDimension: { openness: 7 }, roll: 0 });
    expect(result).toMatchObject({ outcome: 'changed', chancePercent: 65, roll: 0 });
    expect(result.dimensions[0]).toMatchObject({ pressureAfterApproval: 37, threshold: 25, pressureAfterCommit: 12, appliedDelta: 3 });
    expect(consumeSignedThreshold(-37, 25)).toBe(-12);
  });

  it('requires the defining threshold for core dimensions and scales pressure by volatility', () => {
    const result = receipt({
      proposal: proposal({ salience: 'major', dimensionChanges: [{ dimensionKey: 'duty', direction: -1, intendedDelta: -4 }] }),
      pressureByDimension: { duty: -45 },
      roll: 99
    });
    expect(result.outcome).toBe('roll_failed');
    expect(result.dimensions[0]).toMatchObject({ pressureAdded: -60, pressureAfterApproval: -105, threshold: 100, pressureAfterCommit: -105 });
  });

  it('rejects wide, duplicate, unknown, or directionally inconsistent proposals', () => {
    const invalid = proposal({
      evidenceIds: ['same', 'same'],
      dimensionChanges: [
        { dimensionKey: 'openness', direction: 1, intendedDelta: -1 },
        { dimensionKey: 'openness', direction: 1, intendedDelta: 1 },
        { dimensionKey: 'missing', direction: 1, intendedDelta: 1 },
        { dimensionKey: 'humor', direction: 1, intendedDelta: 1 }
      ],
      entryOperations: [
        { operation: 'retract', entryId: 'one' },
        { operation: 'retract', entryId: 'two' },
        { operation: 'retract', entryId: 'three' }
      ],
      causalExplanation: '   '
    });
    expect(validateMutationProposal(invalid, schema, profile).map((issue) => issue.code)).toEqual(expect.arrayContaining([
      'evidence', 'causal_explanation', 'dimension_width', 'entry_width', 'direction_mismatch', 'dimension_reference'
    ]));
  });

  it('applies the whole coherent bundle after one dimension qualifies and only consumes crossed pressure', () => {
    const result = receipt({
      proposal: proposal({
        salience: 'major',
        dimensionChanges: [
          { dimensionKey: 'openness', direction: 1, intendedDelta: 200 },
          { dimensionKey: 'patience', direction: 1, intendedDelta: 4 }
        ]
      }),
      pressureByDimension: { openness: 0, patience: 0 },
      roll: 0
    });
    expect(result.outcome).toBe('changed');
    expect(result.dimensions[0]).toMatchObject({ crossedThreshold: true, pressureAfterCommit: 5, valueBefore: 5, valueAfter: 100, intendedDelta: 200, appliedDelta: 95 });
    expect(result.dimensions[1]).toMatchObject({ crossedThreshold: false, pressureAfterCommit: 15, valueBefore: 20, valueAfter: 24, appliedDelta: 4 });
  });

  it('does not carry an under-threshold core change through a non-core shared roll', () => {
    const result = receipt({
      proposal: proposal({
        salience: 'major',
        dimensionChanges: [
          { dimensionKey: 'openness', direction: 1, intendedDelta: 3 },
          { dimensionKey: 'duty', direction: -1, intendedDelta: -4 }
        ]
      }),
      pressureByDimension: {},
      roll: 0
    });
    expect(result.outcome).toBe('changed');
    expect(result.dimensions[1]).toMatchObject({ crossedThreshold: false, pressureAfterCommit: -60, valueBefore: 60, valueAfter: 60, appliedDelta: 0 });
  });

  it('allows accumulated evidence to change a core dimension only after it crosses the defining threshold', () => {
    const result = receipt({
      proposal: proposal({ salience: 'major', dimensionChanges: [{ dimensionKey: 'duty', direction: -1, intendedDelta: -4 }] }),
      pressureByDimension: { duty: -45 },
      roll: 0
    });
    expect(result).toMatchObject({ outcome: 'changed' });
    expect(result.dimensions[0]).toMatchObject({ threshold: 100, pressureAfterCommit: -5, valueBefore: 60, valueAfter: 56, appliedDelta: -4 });
  });

  it('requires finite integer stored pressure', () => {
    expect(() => receipt({ proposal: proposal(), pressureByDimension: { openness: Number.NaN } })).toThrow('safe integer');
  });

  it('rejects unsupported schema versions and unauthorized or untelegraphed effects', () => {
    expect(validatePersonalitySchema({ ...schema, version: 'future' as never }).map((issue) => issue.code)).toContain('schema_version');
    const snapshot = { ...worldSnapshot, authorizedIrreversibleEffects: [{ ...worldSnapshot.authorizedIrreversibleEffects[0], visibleSinceDay: 4 }] };
    expect(validateWorldEffectCommands([
      { kind: 'retire_entity', entityId: 'lira', reason: 'Leaves for good.', irreversibleEffectKey: 'departure' }
    ], capability as never, snapshot).map((issue) => issue.code)).toContain('irreversible_authorization');
    expect(validateWorldEffectCommands([
      { kind: 'retire_entity', entityId: 'lira', reason: 'Leaves for good.' }
    ], capability as never, worldSnapshot).map((issue) => issue.code)).toContain('irreversible_authorization');
    expect(validateWorldEffectCommands([{ kind: 'unlock_recipe', recipeEntityId: 'missing' }], capability as never, snapshot).map((issue) => issue.code)).toContain('effect_capability');
    expect(() => receipt({
      proposal: proposal({ worldEffects: [{ kind: 'retire_entity', entityId: 'lira', reason: 'Leaves for good.' }] }),
      pressureByDimension: {}
    })).toThrow('irreversible_authorization');
    expect(validateWorldEffectCommands([
      { kind: 'retire_entity', entityId: 'old_road', reason: 'The road is gone.' }
    ], capability as never, worldSnapshot).map((issue) => issue.code)).toContain('irreversible_authorization');
  });

  it('parses model output as unknown data before semantic validation', () => {
    expect(parseMutationProposal({ ...proposal(), dimensionChanges: 'not-an-array' })).toMatchObject({ ok: false });
    expect(parseMutationProposal({ ...proposal(), unexpected: true })).toMatchObject({ ok: false });
    expect(parseMutationProposal({
      ...proposal(),
      entryOperations: [{ operation: 'add', entry: { id: 'new_value', kind: 'value', text: null, core: false, active: true } }]
    })).toMatchObject({ ok: false });
    expect(parseMutationProposal({ ...proposal(), worldEffects: [null] })).toMatchObject({ ok: true });
    expect(() => receipt({ proposal: { ...proposal(), worldEffects: [null] } as never, pressureByDimension: {} })).toThrow('effect_shape');
    expect(parseMutationProposal(proposal())).toMatchObject({ ok: true });
  });

  it('keeps beliefs attributed, bounded, and separate from canonical world effects', () => {
    const claim = 'a'.repeat(64);
    const valid = proposal({ beliefOperations: [{ operation: 'add', subjectEntityId: 'lira', content: 'The keeper may shelter travelers.', confidence: 65, provenance: [{ sourceKind: 'dialogue_claim', sourceId: 'event_1' }], originalClaimFingerprint: claim }] });
    expect(validateMutationProposal(valid, schema, profile)).toEqual([]);
    const addedBelief = valid.beliefOperations[0];
    if (addedBelief.operation !== 'add') throw new Error('Expected the test belief to be an add operation.');
    expect(validateMutationProposal({ ...valid, beliefOperations: [{ ...addedBelief, subjectEntityId: 'unknown_npc' }] }, schema, profile, worldSnapshot).map((issue) => issue.code)).toContain('belief_add');
    expect(parseMutationProposal(valid)).toMatchObject({ ok: true });
    expect(validateMutationProposal(proposal({ beliefOperations: [
      { operation: 'retract', beliefId: 'rumor_1', reason: 'Evidence disproved it.', sourceFingerprint: claim },
      { operation: 'retract', beliefId: 'rumor_2', reason: 'Evidence disproved it.', sourceFingerprint: claim },
      { operation: 'retract', beliefId: 'rumor_3', reason: 'Evidence disproved it.', sourceFingerprint: claim }
    ] }), schema, profile).map((issue) => issue.code)).toContain('belief_width');
    expect(parseMutationProposal({ ...valid, beliefOperations: [{ ...valid.beliefOperations[0], id: 'fabricated-db-id' }] })).toMatchObject({ ok: false });
    expect(valid.worldEffects).toEqual([]);
  });

  it('uses registry bounds and immutable references for effect commands', () => {
    const richerSnapshot = { ...worldSnapshot, entityKinds: { ...worldSnapshot.entityKinds, faction_1: 'faction' as const, herb: 'item' as const, recipe_1: 'recipe' as const } };
    expect(validateWorldEffectCommands([{ kind: 'adjust_relationship', subjectNpcId: 'lira', objectEntityId: 'faction_1', axis: 'trust', delta: 26 }], { ...capability, allowedWorldEffects: ['adjust_relationship'] } as never, richerSnapshot).map((issue) => issue.code)).toContain('effect_payload');
    expect(validateWorldEffectCommands([{ kind: 'create_entity', entityKind: 'npc', archetypeKey: 'missing-archetype', proposedName: 'Aster', payload: {} }], { ...capability, allowedWorldEffects: ['create_entity'], allowedTargetKinds: ['npc'] } as never, richerSnapshot).map((issue) => issue.code)).toContain('effect_payload');
  });

  it('canonicalizes and fingerprints validated proposals stably and rejects executable or oversized payloads', async () => {
    const first = proposal({ beliefOperations: [] });
    const reordered = { worldEffects: [], questChanges: [], causalExplanation: first.causalExplanation, beliefOperations: [], entryOperations: [], dimensionChanges: first.dimensionChanges, salience: first.salience, evidenceIds: first.evidenceIds, rulesVersion: first.rulesVersion };
    expect(canonicalizeMutationProposal(first)).toBe(canonicalizeMutationProposal(reordered));
    expect(await fingerprintMutationProposal(first)).toBe(await fingerprintMutationProposal(reordered));
    expect(canonicalizeMutationProposal({ ...first, worldEffects: [{ kind: 'record_world_event', handler: 'bad' }] })).toBeNull();
    expect(canonicalizeMutationProposal({ ...first, unsafeCode: 'bad' })).toBeNull();
    expect(canonicalizeMutationProposal(JSON.parse('{"rulesVersion":"evolving-world-v1","evidenceIds":["event-1"],"salience":"meaningful","dimensionChanges":[],"entryOperations":[],"beliefOperations":[],"causalExplanation":"x","questChanges":[],"worldEffects":[],"constructor":"bad"}'))).toBeNull();
    expect(canonicalizeMutationProposal({ ...first, causalExplanation: 'x'.repeat(1_001) })).toBeNull();
    expect(canonicalizeMutationProposal({ ...first, evidenceIds: Array.from({ length: 16 }, (_, index) => `${index}-${'x'.repeat(998)}`) })).toBeNull();
  });

  it('keeps core entries mutable only after a successful defining core threshold', () => {
    const coreRetraction = [{ operation: 'retract', entryId: 'keep_promises' } as const];
    const ordinary = receipt({ proposal: proposal({ salience: 'major', entryOperations: coreRetraction }), pressureByDimension: { openness: 0 }, roll: 0 });
    expect(ordinary.outcome).toBe('changed');
    expect(ordinary.appliedEntryOperationIndexes).toEqual([]);
    const defining = receipt({ proposal: proposal({ salience: 'major', dimensionChanges: [{ dimensionKey: 'duty', direction: -1, intendedDelta: -2 }], entryOperations: coreRetraction }), pressureByDimension: { duty: -45 }, roll: 0 });
    expect(defining.outcome).toBe('changed');
    expect(defining.appliedEntryOperationIndexes).toEqual([0]);
  });

  it('validates immutable schemas and clamps all trait and social-axis values', () => {
    expect(validatePersonalitySchema(schema)).toEqual([]);
    expect(clampTrait(-101)).toBe(-100);
    expect(clampTrait(42.6)).toBe(43);
    expect(clampTrait(101)).toBe(100);
    expect(validatePersonalitySchema({ ...schema, dimensions: [{ ...schema.dimensions[0], key: 'Bad key', initialValue: 101 }] })).not.toEqual([]);
  });
});
