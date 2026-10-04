import { describe, expect, it } from 'vitest';
import rawRegistry from '../../supabase/content/evolving-world/primitive-registry-v1.json';
import {
  getEntityArchetype,
  getWorldEffectDefinition,
  normalizeWorldEntityKind,
  parsePrimitiveRegistry,
  primitiveRegistry,
  validatePrimitiveRegistry
} from '../../src/lib/game/evolving-world';

function registryCopy(): Record<string, unknown> {
  return structuredClone(rawRegistry) as Record<string, unknown>;
}

describe('evolving-world primitive registry', () => {
  it('loads a finite, complete authored registry for every initial primitive category', () => {
    expect(validatePrimitiveRegistry(rawRegistry)).toEqual([]);
    expect(primitiveRegistry.version).toBe('primitive-registry-v1');
    expect(primitiveRegistry.worldBudgets).toEqual({ deepNpcs: 8, supportingActors: 40, activeLocations: 8, activeGeneratedEntities: 150 });
    expect(new Set(primitiveRegistry.entityArchetypes.map((entry) => entry.kind))).toEqual(new Set(['npc', 'location', 'faction', 'item', 'recipe', 'world_event']));
    expect(primitiveRegistry.entitySchemas.every((schema) => schema.fields.every((field) => typeof field.required === 'boolean'))).toBe(true);
    expect(primitiveRegistry.entityArchetypes.every((archetype) => primitiveRegistry.entitySchemas.some((schema) => schema.key === archetype.schemaKey))).toBe(true);
    expect(primitiveRegistry.quest).toEqual({ actions: ['prepare', 'attempt', 'wait', 'abandon'], approaches: ['scouting', 'combat', 'diplomacy', 'trade'] });
    expect(primitiveRegistry.socialCapabilities.map((capability) => capability.key)).toEqual(['conceal', 'misdirect', 'deceive', 'share_gossip']);
    expect(primitiveRegistry.npcArchetypes.every((archetype) => archetype.capabilities.every((capability) => primitiveRegistry.socialCapabilities.some((entry) => entry.key === capability)))).toBe(true);
    expect(primitiveRegistry.locationModifiers.length).toBeGreaterThan(0);
    expect(primitiveRegistry.economyModifiers.length).toBeGreaterThan(0);
    expect(primitiveRegistry.itemComponents).toContain('garden-herb');
    expect(primitiveRegistry.recipeComponents).toContain('herb-loaf');
    expect(primitiveRegistry.encounterTemplates.length).toBeGreaterThan(0);
    expect(primitiveRegistry.worldEventTemplates.length).toBeGreaterThan(0);
    expect(primitiveRegistry.renderingTemplates).toContain('tavern-background');
    expect(primitiveRegistry.artDirection.key).toBe('gilded-tankard-v1');
  });

  it('covers every typed effect once with bounds, target kinds, and irreversible metadata', () => {
    expect(primitiveRegistry.worldEffects.map((effect) => effect.kind)).toEqual([
      'adjust_relationship', 'create_quest', 'update_quest', 'create_entity', 'retire_entity',
      'record_world_event', 'apply_location_modifier', 'transfer_inventory', 'unlock_recipe',
      'apply_economy_modifier', 'set_availability'
    ]);
    for (const effect of primitiveRegistry.worldEffects) {
      expect(effect.bounds.min).toBeLessThanOrEqual(effect.bounds.max);
      expect(effect.targetKinds.length).toBeGreaterThan(0);
      expect(typeof effect.irreversible).toBe('boolean');
    }
    expect(getWorldEffectDefinition('retire_entity')).toMatchObject({ irreversible: true });
    expect(getWorldEffectDefinition('set_availability')).toMatchObject({ irreversible: false });
    expect(getWorldEffectDefinition('apply_location_modifier')).toMatchObject({ targetKinds: ['location'] });
  });

  it('normalizes the only legacy entity alias at the import boundary', () => {
    expect(primitiveRegistry.entityKindAliases).toEqual({ place: 'location' });
    expect(normalizeWorldEntityKind('place')).toBe('location');
    expect(normalizeWorldEntityKind('location')).toBe('location');
    expect(normalizeWorldEntityKind('world_event')).toBe('world_event');
    expect(normalizeWorldEntityKind('unknown')).toBeUndefined();
  });

  it('provides deterministic finite lookups and immutable runtime data', () => {
    expect(getEntityArchetype('deep-npc')).toMatchObject({ kind: 'npc' });
    expect(getEntityArchetype('unknown')).toBeUndefined();
    expect(Object.isFrozen(primitiveRegistry)).toBe(true);
    expect(Object.isFrozen(primitiveRegistry.worldEffects)).toBe(true);
    expect(Object.isFrozen(primitiveRegistry.worldEffects[0].bounds)).toBe(true);
    expect(() => (primitiveRegistry.worldBudgets.deepNpcs = 999)).toThrow();
  });

  it('rejects duplicate keys, missing categories, unknown references, and invalid cross-references', () => {
    const duplicate = registryCopy();
    (duplicate.entityArchetypes as Array<Record<string, unknown>>)[1].key = 'deep-npc';
    expect(validatePrimitiveRegistry(duplicate).map((entry) => entry.code)).toContain('duplicate_key');

    const missing = registryCopy();
    (missing.entityArchetypes as Array<Record<string, unknown>>).splice(0, 2);
    expect(validatePrimitiveRegistry(missing).map((entry) => entry.code)).toContain('missing_kind');

    const unknownTarget = registryCopy();
    ((unknownTarget.worldEffects as Array<Record<string, unknown>>)[0].targetKinds as string[])[0] = 'place';
    expect(validatePrimitiveRegistry(unknownTarget).map((entry) => entry.code)).toContain('effect_target_kind');

    const extraBound = registryCopy();
    ((extraBound.worldEffects as Array<Record<string, unknown>>)[0].bounds as Record<string, unknown>).step = 5;
    expect(validatePrimitiveRegistry(extraBound).map((entry) => entry.code)).toContain('unknown_field');

    const badCapability = registryCopy();
    ((badCapability.npcArchetypes as Array<Record<string, unknown>>)[0].capabilities as string[]).push('teleport');
    expect(validatePrimitiveRegistry(badCapability).map((entry) => entry.code)).toContain('social_capability');

    const missingSchema = registryCopy();
    (missingSchema.entityArchetypes as Array<Record<string, unknown>>)[0].schemaKey = 'does-not-exist';
    expect(validatePrimitiveRegistry(missingSchema).map((entry) => entry.code)).toContain('schema_reference');
  });

  it('rejects any mutation of the versioned effect metadata contract', () => {
    const changedTarget = registryCopy();
    ((changedTarget.worldEffects as Array<Record<string, unknown>>)[0].targetKinds as string[]).pop();
    expect(validatePrimitiveRegistry(changedTarget).map((entry) => entry.code)).toContain('effect_metadata');

    const changedBounds = registryCopy();
    ((changedBounds.worldEffects as Array<Record<string, unknown>>)[0].bounds as Record<string, unknown>).max = 26;
    expect(validatePrimitiveRegistry(changedBounds).map((entry) => entry.code)).toContain('effect_metadata');

    const changedFlag = registryCopy();
    (changedFlag.worldEffects as Array<Record<string, unknown>>)[10].irreversible = true;
    expect(validatePrimitiveRegistry(changedFlag).map((entry) => entry.code)).toContain('effect_metadata');
  });

  it('fails closed on unexpected and executable runtime fields', () => {
    const unexpected = registryCopy();
    unexpected.unexpected = true;
    expect(parsePrimitiveRegistry(unexpected)).toMatchObject({ ok: false });

    const parsed = parsePrimitiveRegistry(rawRegistry);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.value).not.toBe(rawRegistry);
      expect(parsed.value.worldEffects).not.toBe(rawRegistry.worldEffects);
    }

    const executable = registryCopy();
    (executable.worldEffects as Array<Record<string, unknown>>)[0].sql = 'select * from saves';
    expect(validatePrimitiveRegistry(executable).map((entry) => entry.code)).toContain('forbidden_field');

    const nestedCode = registryCopy();
    (nestedCode.artDirection as Record<string, unknown>).rendering_code = 'run()';
    expect(validatePrimitiveRegistry(nestedCode).map((entry) => entry.code)).toContain('forbidden_field');
  });
});
