import { describe, expect, it } from 'vitest';
import { createNpcSheet } from '../../src/lib/game/community-npc-ui';
import { canonicalNpcSheet, milestoneIntention, normalizeNpcName, validateNpcSheet } from '../../src/lib/game/npc-sheet';

const sheet = () => structuredClone(createNpcSheet('Mara Reed'));
const codes = (value: unknown) => validateNpcSheet(value).map((entry) => entry.code);

describe('npc-sheet-v2', () => {
  it('accepts the complete V2 contract and produces deterministic canonical content', () => {
    const value = sheet(); const reordered = Object.fromEntries(Object.entries(value).reverse()) as typeof value;
    expect(validateNpcSheet(value)).toEqual([]);
    expect(canonicalNpcSheet(value)).toBe(canonicalNpcSheet(reordered));
    expect(canonicalNpcSheet(value)).toContain('"schemaVersion":"npc-sheet-v2"');
    expect(normalizeNpcName('  MÁRA   Reed ')).toBe('mára reed');
    expect(milestoneIntention(value, 0)?.targets).toEqual(['old-road']);
  });

  it('enforces appearance silhouette and normalized palette values', () => {
    const value = sheet(); value.appearance.silhouette = 'short'; value.appearance.palette = ['Forest-Green', 'forest-green', 'bad_value'];
    expect(codes(value)).toEqual(expect.arrayContaining(['text_length', 'palette']));
  });

  it('enforces dimension grammar, normalization collisions, reserved prefixes, and every scalar bound', () => {
    const value = sheet();
    value.personality.dimensions = [
      { ...value.personality.dimensions[0], key: 'world_state', label: '', negativeAnchor: '', positiveAnchor: '', initialValue: -101, volatility: .24, ordinaryChangeThreshold: 4, definingRuptureThreshold: 3 },
      { ...value.personality.dimensions[1], key: 'world-state', initialValue: 101, volatility: Number.POSITIVE_INFINITY, ordinaryChangeThreshold: 201, definingRuptureThreshold: 201 }
    ];
    expect(codes(value)).toEqual(expect.arrayContaining(['dimension_key', 'dimension_text', 'dimension_value', 'dimension_volatility', 'dimension_threshold']));
  });

  it('requires 1–8 dimensions and valid declared collection caps', () => {
    const value = sheet(); value.personality.dimensions = []; value.personality.collections[0].maximumEntries = 11;
    expect(codes(value)).toEqual(expect.arrayContaining(['dimension_count', 'collection']));
    value.personality.dimensions = Array.from({ length: 9 }, (_, index) => ({ ...sheet().personality.dimensions[0], key: `trait_${index}` }));
    expect(codes(value)).toContain('dimension_count');
  });

  it('rejects undeclared, inactive, duplicate, reserved, and over-cap typed entries', () => {
    const value = sheet();
    value.personality.initialEntries = [
      { ...value.personality.initialEntries[0], id: 'system_value', active: false as true },
      { ...value.personality.initialEntries[0], id: 'system-value' },
      { id: 'belief_runtime_only', kind: 'belief' as never, text: 'Not authorable.', core: false, active: true },
      { ...value.personality.initialEntries[0], id: 'another_value' },
      { ...value.personality.initialEntries[0], id: 'third_value' }
    ];
    value.personality.collections = [{ kind: 'value', maximumEntries: 1 }];
    expect(codes(value)).toEqual(expect.arrayContaining(['entry_id', 'entry', 'required_entry_kind', 'collection_cap']));
  });

  it('requires value, boundary, preference, aversion, and voice trait entries', () => {
    const value = sheet(); value.personality.initialEntries = value.personality.initialEntries.filter((entry) => entry.kind !== 'voice_trait');
    expect(codes(value)).toContain('required_entry_kind');
  });
});
