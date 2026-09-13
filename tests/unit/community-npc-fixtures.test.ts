import { describe, expect, it } from 'vitest';
import { communityNpcStorageKey, createFixtureNpcSheet } from '../../scripts/community-npc-fixtures.js';
import { validateNpcSheet } from '../../src/lib/game/npc-sheet.js';

describe('local community NPC fixtures', () => {
  it('builds a sheet accepted by the same shared contract as authoring', () => {
    expect(validateNpcSheet(createFixtureNpcSheet())).toEqual([]);
  });

  it('keeps the fixture standard-rated and safe to seed without adult preferences', () => {
    expect(createFixtureNpcSheet().rating).toBe('standard');
  });

  it('permits only dedicated Community NPC storage keys', () => {
    expect(communityNpcStorageKey('willow/scene.webp')).toBe('community-npcs/willow/scene.webp');
    expect(communityNpcStorageKey('../shop/hero.webp')).toBeNull();
    expect(communityNpcStorageKey('')).toBeNull();
  });
});
