import { createHash } from 'node:crypto';
import { canonicalNpcSheet, type NpcSheet } from '$lib/game/npc-sheet';

export function npcContentHash(sheet: NpcSheet): string {
  return createHash('sha256').update(canonicalNpcSheet(sheet)).digest('hex');
}

export function applyNpcSection(sheet: NpcSheet, section: keyof NpcSheet, replacement: unknown): NpcSheet {
  return structuredClone({ ...sheet, [section]: replacement });
}
