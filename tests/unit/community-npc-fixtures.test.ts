import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { deriveLocalCommunityNpcSettingVariants, listLocalCommunityNpcSceneAssets } from '../../scripts/community-npc-fixtures.js';

describe('community NPC setting fixtures', () => {
  it('derives exactly three deterministic 16:9 WebP setting variants from the ignored background master', async () => {
    const root = await mkdtemp(join(tmpdir(), 'brac-setting-fixture-'));
    const source = join(root, '.local/media/source-masters/community-npcs/settings/CozyTavernBackground.png');
    try {
      await mkdir(join(root, '.local/media/source-masters/community-npcs/settings'), { recursive: true });
      const pixels = Buffer.alloc(1672 * 941 * 3);
      for (let y = 0; y < 941; y += 1) for (let x = 0; x < 1672; x += 1) {
        const offset = (y * 1672 + x) * 3;
        pixels[offset] = Math.round(70 + 110 * x / 1671);
        pixels[offset + 1] = Math.round(34 + 95 * y / 940);
        pixels[offset + 2] = Math.round(12 + 45 * (x + y) / 2611);
      }
      await sharp(pixels, { raw: { width: 1672, height: 941, channels: 3 } }).png().toFile(source);
      expect(await deriveLocalCommunityNpcSettingVariants(root)).toEqual([
        'settings/lantern-lit-tavern-table.webp', 'settings/hearth-side-booth.webp', 'settings/quiet-window-table.webp'
      ]);
      const scenes = listLocalCommunityNpcSceneAssets(root);
      expect(scenes).toHaveLength(3);
      expect(scenes.map((scene) => scene.localFilename)).toEqual([
        'settings/hearth-side-booth.webp', 'settings/lantern-lit-tavern-table.webp', 'settings/quiet-window-table.webp'
      ]);
      for (const scene of scenes) {
        const bytes = await readFile(join(root, '.local/media/runtime-derivatives/community-npcs', scene.localFilename));
        expect(bytes.subarray(0, 4).toString('ascii')).toBe('RIFF');
      }
      expect(new Set(scenes.map((scene) => scene.sha256)).size).toBe(3);
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});
