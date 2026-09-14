import { describe, expect, it } from 'vitest';
import rawDefinitions from '../../supabase/content/evolving-world/pilot-residents-v1.json';
import {
  parsePilotResidentDefinitions,
  pilotResidentDefinitions,
  validatePersonalityProfile,
  validatePersonalitySchema
} from '../../src/lib/game/evolving-world';

function copy(): Record<string, unknown> {
  return structuredClone(rawDefinitions) as Record<string, unknown>;
}

describe('pilot resident definitions', () => {
  it('pins exactly the first-party Lira and Torvin definitions and validates their profile contracts', () => {
    expect(Object.keys(pilotResidentDefinitions)).toEqual(['lira', 'torvin']);
    expect(pilotResidentDefinitions.lira).toMatchObject({
      key: 'lira', definitionVersion: 'pilot-resident-v1',
      sourceIdentity: { npcId: '18181818-1818-4181-8181-181818181818', npcVersionId: '18181818-1818-4181-8181-181818181819', npcKey: 'lira' },
      appearanceSource: { npcVersionId: '18181818-1818-4181-8181-181818181819', schemaVersion: 'npc-sheet-v1' }
    });
    expect(pilotResidentDefinitions.torvin).toMatchObject({
      key: 'torvin', definitionVersion: 'pilot-resident-v1',
      sourceIdentity: { npcId: '28282828-2828-4282-8282-282828282828', npcVersionId: '28282828-2828-4282-8282-282828282829', npcKey: 'torvin' },
      appearanceSource: { npcVersionId: '28282828-2828-4282-8282-282828282829', schemaVersion: 'npc-sheet-v1' }
    });
    for (const definition of Object.values(pilotResidentDefinitions)) {
      expect(validatePersonalitySchema(definition.personalitySchema)).toEqual([]);
      expect(validatePersonalityProfile(definition.initialProfile, definition.personalitySchema)).toEqual([]);
      expect(definition.appearanceSpec.renderingTemplateKey).toBe('tavern-portrait');
      expect(definition.personalitySchema.collections).toEqual([
        { kind: 'value', maximumEntries: 6 }, { kind: 'boundary', maximumEntries: 4 },
        { kind: 'preference', maximumEntries: 6 }, { kind: 'aversion', maximumEntries: 6 },
        { kind: 'motive', maximumEntries: 4 }, { kind: 'fear', maximumEntries: 4 },
        { kind: 'coping_pattern', maximumEntries: 4 }, { kind: 'voice_trait', maximumEntries: 4 }
      ]);
    }
    expect(pilotResidentDefinitions.lira.initialProfile.dimensions).toEqual({ duty: 85, caution: 70, empathy: 75, openness: 40 });
    expect(pilotResidentDefinitions.torvin.initialProfile.dimensions).toEqual({ fairness: 85, reputation: 80, community: 80, guardedness: 65 });
    expect(pilotResidentDefinitions.lira.initialProfile.entries.map((entry) => entry.id)).toEqual([
      'lira_value_protect_millhaven', 'lira_value_keep_promises', 'lira_value_verify_rumors',
      'lira_preference_careful_preparation', 'lira_preference_honest_hospitality', 'lira_preference_quiet_woods',
      'lira_aversion_recklessness', 'lira_aversion_cruelty', 'lira_aversion_boasting',
      'lira_boundary_no_harm_civilians', 'lira_boundary_verify_accusations', 'lira_voice'
    ]);
  });

  it('preserves the complete legacy values, likes, dislikes, boundaries, and voice text', () => {
    const entries = (key: 'lira' | 'torvin', kind: string) => pilotResidentDefinitions[key].initialProfile.entries.filter((entry) => entry.kind === kind).map((entry) => entry.text);
    expect(entries('lira', 'value')).toEqual(['protect Millhaven', 'keep promises', 'verify rumors']);
    expect(entries('lira', 'preference')).toEqual(['careful preparation', 'honest hospitality', 'quiet woods']);
    expect(entries('lira', 'aversion')).toEqual(['recklessness', 'cruelty', 'boasting']);
    expect(entries('lira', 'boundary')).toEqual(['Will not deliberately harm civilians', 'Does not accept an unverified accusation as fact']);
    expect(entries('lira', 'voice_trait')).toEqual(['Measured, observant, dryly humorous. Short concrete sentences. Cares about people more than glory. Never speaks like an assistant.']);
    expect(entries('torvin', 'value')).toEqual(['fair bargains', 'protect his reputation', 'provide for his community']);
    expect(entries('torvin', 'preference')).toEqual(['patient negotiation', 'good craftsmanship', 'dependable company']);
    expect(entries('torvin', 'aversion')).toEqual(['being patronized', 'empty guarantees', 'careless spending']);
    expect(entries('torvin', 'boundary')).toEqual(['Will not knowingly sell a counterfeit', "Does not spend the keeper's gold without a real game action"]);
    expect(entries('torvin', 'voice_trait')).toEqual(['Warm, shrewd, slightly theatrical. Uses occasional practical merchant comparisons. Pride conceals anxiety; never speaks like an assistant.']);
    for (const definition of Object.values(pilotResidentDefinitions)) {
      for (const entry of definition.initialProfile.entries.filter((entry) => ['value', 'boundary', 'voice_trait'].includes(entry.kind))) expect(entry.core).toBe(true);
    }
  });

  it('keeps only the E1 safe capability surface', () => {
    expect(pilotResidentDefinitions.lira.capabilityEnvelope).toMatchObject({
      allowedActions: ['prepare', 'attempt', 'wait', 'abandon'], allowedApproaches: ['scouting', 'combat', 'diplomacy', 'trade'],
      allowedTargetKinds: ['npc', 'location', 'faction', 'item'], allowedWorldEffects: ['adjust_relationship'], socialCapabilities: ['conceal', 'share_gossip'], irreversibleEffects: []
    });
    expect(pilotResidentDefinitions.torvin.capabilityEnvelope.socialCapabilities).toEqual(['misdirect', 'share_gossip']);
    expect(pilotResidentDefinitions.torvin.capabilityEnvelope.irreversibleEffects).toEqual([]);
  });

  it('deep-freezes the normalized runtime definitions', () => {
    expect(Object.isFrozen(pilotResidentDefinitions)).toBe(true);
    expect(Object.isFrozen(pilotResidentDefinitions.lira.initialProfile.entries)).toBe(true);
    expect(Object.isFrozen(pilotResidentDefinitions.lira.initialProfile.entries[0])).toBe(true);
    expect(() => { pilotResidentDefinitions.lira.initialProfile.entries[0].text = 'changed'; }).toThrow();
  });

  it('fails closed for unknown fields, malformed content, source drift, and unsafe capabilities', () => {
    const unknown = copy();
    unknown.unexpected = true;
    expect(parsePilotResidentDefinitions(unknown)).toMatchObject({ ok: false });

    const duplicateDimension = copy();
    const lira = (duplicateDimension.residents as Record<string, Record<string, unknown>>).lira;
    ((lira.personalitySchema as Record<string, unknown>).dimensions as Array<Record<string, unknown>>)[1].key = 'duty';
    expect(parsePilotResidentDefinitions(duplicateDimension)).toMatchObject({ ok: false });

    const sourceDrift = copy();
    ((sourceDrift.residents as Record<string, Record<string, unknown>>).torvin.sourceIdentity as Record<string, unknown>).npcVersionId = '28282828-2828-4282-8282-282828282828';
    expect(parsePilotResidentDefinitions(sourceDrift)).toMatchObject({ ok: false });

    const unsafe = copy();
    ((unsafe.residents as Record<string, Record<string, unknown>>).lira.capabilityEnvelope as Record<string, unknown>).allowedWorldEffects = ['retire_entity'];
    expect(parsePilotResidentDefinitions(unsafe)).toMatchObject({ ok: false });
  });
});
