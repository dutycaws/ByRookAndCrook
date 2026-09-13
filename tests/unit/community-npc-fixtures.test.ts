import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { deriveLocalCommunityNpcSettingVariants, listLocalCommunityNpcSceneAssets } from '../../scripts/community-npc-fixtures.js';

describe('community NPC setting fixtures', () => {
  it('derives exactly three deterministic 16:9 WebP setting variants from the ignored background master', async () => {
    const root = await mkdtemp(join(tmpdir(), 'brac-setting-fixture-'));
    const source = join(root, '.local/media/source-masters/community-npcs/settings/CozyTavernBackground.png');
    try {
      await (await import('node:fs/promises')).mkdir(join(root, '.local/media/source-masters/community-npcs/settings'), { recursive: true });
      execFileSync('convert', ['-size', '1672x941', 'gradient:#46220c-#c28135', source]);
      expect(deriveLocalCommunityNpcSettingVariants(root)).toEqual([
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
