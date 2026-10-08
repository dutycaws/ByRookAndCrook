import { expect, test } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { createBrewedTavern } from '../helpers/brewed-tavern';
import { getLocalTestDatabaseContainer } from '../helpers/local-supabase';
import type { OwnedTrinket } from '../../src/lib/game/trinkets';
import { TRINKET_ARTWORK, TRINKET_EFFECT_CATALOG } from '../../src/lib/game/trinkets';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isOwnedTrinket(value: unknown): value is OwnedTrinket {
  if (!isRecord(value)) return false;
  const slot = value.slot;
  return typeof value.id === 'string'
    && typeof value.sourceNpcId === 'string'
    && typeof value.sourceMilestoneId === 'string'
    && typeof value.name === 'string'
    && typeof value.dedication === 'string'
    && typeof value.earnedAt === 'string'
    && typeof value.catalogId === 'string'
    && Object.hasOwn(TRINKET_EFFECT_CATALOG, value.catalogId)
    && typeof value.artworkId === 'string'
    && Object.hasOwn(TRINKET_ARTWORK, value.artworkId)
    && (slot === null || slot === 0 || slot === 1 || slot === 2 || slot === 3);
}

function readTrinketCollection(snapshot: unknown): OwnedTrinket[] {
  if (!isRecord(snapshot) || !isRecord(snapshot.trinkets) || !Array.isArray(snapshot.trinkets.collection)) {
    throw new Error('The bar snapshot did not include a keepsake collection.');
  }
  if (!snapshot.trinkets.collection.every(isOwnedTrinket)) {
    throw new Error('The bar snapshot included an invalid keepsake collection.');
  }
  return snapshot.trinkets.collection;
}

/**
 * Use real authored initial-quest success events to fill a new player's four
 * fixed displays and overflow collection. The synthetic NPC packages are
 * installed as inactive test content so later new saves do not inherit them.
 */
function seedFiveEarnedKeepsakes(saveId: string): void {
  if (!/^[0-9a-f-]{36}$/i.test(saveId)) throw new Error('Trinket fixture save ID is invalid.');
  const sql = `
set request.jwt.claim.role='service_role';
do $fixture$
declare
  source_sheet jsonb;
  source_options text[];
  current_day integer;
  authored_sheet jsonb;
  npc_for_fixture uuid;
  version_for_fixture uuid;
  resident_row record;
  quest_for_fixture uuid;
  event_row private.world_quest_events;
  effect_id text;
  artwork_id text;
  index_value integer;
begin
  perform pg_advisory_xact_lock(hashtext('issue35-trinket-ui-package-install'));
  select version.sheet,package.capability_option_ids
    into source_sheet,source_options
  from private.npc_first_party_catalog_identities catalog
  join private.npc_versions version on version.id=catalog.active_version_id
  join private.npc_version_resident_packages package on package.version_id=version.id
  where catalog.identity_key='lira';
  if source_sheet is null then raise exception 'Lira V2 source package is unavailable'; end if;
  select save_row.current_day into current_day from public.tavern_saves save_row where save_row.id='${saveId}'::uuid;
  if current_day is null then raise exception 'Trinket fixture save is unavailable'; end if;

  for index_value in 1..5 loop
    npc_for_fixture:=('35400000-0000-4000-8000-'||lpad(index_value::text,12,'0'))::uuid;
    version_for_fixture:=('35400000-0000-4000-8001-'||lpad(index_value::text,12,'0'))::uuid;
    if not exists(select 1 from private.npc_versions version where version.id=version_for_fixture) then
      effect_id:=case index_value when 1 then 'food_revenue' when 2 then 'drink_revenue' when 3 then 'harvest_quality' when 4 then 'food_revenue' else 'harvest_quality' end;
      artwork_id:=case index_value when 1 then 'copper-leaf' when 2 then 'brass-seal' when 3 then 'seed-glass' when 4 then 'brass-seal' else 'copper-leaf' end;
      authored_sheet:=jsonb_set(source_sheet,'{identity,name}',to_jsonb('Keepsake UI Keeper '||index_value));
      authored_sheet:=jsonb_set(authored_sheet,'{campaign,milestones,0,startingPlan}','[{"action":"attempt","approach":"scouting"}]'::jsonb);
      authored_sheet:=jsonb_set(authored_sheet,'{campaign,initialQuestTrinket,catalogId}',to_jsonb(effect_id));
      authored_sheet:=jsonb_set(authored_sheet,'{campaign,initialQuestTrinket,artworkId}',to_jsonb(artwork_id));
      authored_sheet:=jsonb_set(authored_sheet,'{campaign,initialQuestTrinket,name}',to_jsonb('Keepsake '||index_value));
      authored_sheet:=jsonb_set(authored_sheet,'{campaign,initialQuestTrinket,dedication}',to_jsonb('A keepsake earned by test resident number '||index_value||' after a successful first quest.'));
      perform private.npc_install_first_party_release(
        npc_for_fixture,'issue35-trinket-ui-'||index_value,900+index_value,version_for_fixture,
        'ui-fixture',1,false,authored_sheet,source_options
      );
    end if;

    select * into resident_row from private.world_materialize_resident_from_version(
      '${saveId}'::uuid,npc_for_fixture,version_for_fixture,current_day
    );
    select quest.id into quest_for_fixture from private.world_quests quest
      where quest.save_id='${saveId}'::uuid and quest.instance_id=resident_row.instance_id
        and quest.origin='authored_milestone' and quest.authored_milestone_index=0;
    event_row:=private.world_resolve_quest_step(quest_for_fixture,current_day,0);
    if event_row.outcome<>'succeeded' or not exists(
      select 1 from private.world_owned_trinkets item
      where item.save_id='${saveId}'::uuid and item.source_event_id=event_row.id
    ) then raise exception 'Test resident % did not earn a keepsake',index_value; end if;
  end loop;
end
$fixture$;
`;
  execFileSync('docker', [
    'exec', getLocalTestDatabaseContainer(), 'psql', '-qAt', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1', '-c', sql
  ], { encoding: 'utf8' });
}

async function signIn(page: import('@playwright/test').Page, player: Awaited<ReturnType<typeof createBrewedTavern>>) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(player.email);
  await page.getByLabel('Password').fill(player.password);
  await page.getByRole('button', { name: 'Open the ledger' }).click();
  await expect(page).toHaveURL(/\/garden$/);
    await expect(page.locator('.game-shell')).toHaveAttribute('data-hydrated', 'true');
  await page.getByRole('link', { name: /Bar/ }).click();
  await expect(page).toHaveURL(/\/bar$/);
}

test('fixed keepsake displays select collection items and overflow swaps persist after reload', async ({ page }) => {
  const player = await createBrewedTavern('trinket-collection-ui');
  try {
    seedFiveEarnedKeepsakes(player.saveId);
    const initialSnapshot = await player.client.rpc('npc_bar_snapshot');
    expect(initialSnapshot.error).toBeNull();
    const initialItems = readTrinketCollection(initialSnapshot.data);
    expect(initialItems).toHaveLength(5);
    expect(initialItems.filter((item) => item.slot !== null)).toHaveLength(4);
    const overflow = initialItems.find((item) => item.slot === null)!;
    const displaced = initialItems.find((item) => item.slot === 0)!;

    await signIn(page, player);
    await expect(page.locator('[data-area-scene="bar"]')).toHaveAttribute('data-scene-ready', 'true');
    await expect(page.locator('.scene-keepsake-place')).toHaveCount(4);
    await expect(page.locator('[data-keepsake-slot="1"] .scene-keepsake-art')).toBeVisible();
    await expect(page.locator('[data-keepsake-slot="4"] .scene-keepsake-art')).toBeVisible();
    const slotOne = page.getByRole('button', { name: new RegExp(`Keepsake slot 1, ${displaced.name}`) });
    await slotOne.click();
    await expect(page.locator('#keepsake-manager')).toBeVisible();
    await expect(page.getByRole('heading', { name: displaced.name, exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Replace', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Collection', exact: true })).toBeFocused();
    const commands: string[] = [];
    await page.route('**/api/trinkets/swap', async (route) => {
      commands.push(route.request().postData() ?? '');
      if (commands.length === 1) {
        await route.fetch(); // Commit, then lose the response: retry must preserve command identity.
        await route.abort('failed');
      } else await route.continue();
    });
    await page.getByRole('button', { name: `Place ${overflow.name} in slot 1` }).click();
    await expect(page.getByRole('alert')).toContainText('The swap result is unknown.');
    await expect(page.locator('[aria-label="Close keepsake details"]')).toBeDisabled();
    await page.getByRole('button', { name: 'Retry the same swap', exact: true }).click();
    await expect(page.locator('#keepsake-manager')).toHaveCount(0);
    expect(commands).toHaveLength(2);
    expect(commands[0]).toBe(commands[1]);
    await expect(page.getByRole('button', { name: new RegExp(`Keepsake slot 1, ${overflow.name}`) })).toBeVisible();

    const swappedSnapshot = await player.client.rpc('npc_bar_snapshot');
    expect(swappedSnapshot.error).toBeNull();
    const swappedItems = readTrinketCollection(swappedSnapshot.data);
    expect(swappedItems.find((item) => item.id === overflow.id)?.slot).toBe(0);
    expect(swappedItems.find((item) => item.id === displaced.id)?.slot).toBeNull();

    await page.reload();
    await expect(page.locator('[data-area-scene="bar"]')).toHaveAttribute('data-scene-ready', 'true');
    await expect(page.getByRole('button', { name: new RegExp(`Keepsake slot 1, ${overflow.name}`) })).toBeVisible();
    await page.getByRole('button', { name: new RegExp(`Keepsake slot 1, ${overflow.name}`) }).click();
    await expect(page.getByRole('heading', { name: overflow.name, exact: true })).toBeVisible();
    await page.locator('[aria-label="Close keepsake details"]').press('Escape');
    await expect(page.getByRole('button', { name: new RegExp(`Keepsake slot 1, ${overflow.name}`) })).toBeFocused();
    const reloadedSnapshot = await player.client.rpc('npc_bar_snapshot');
    expect(reloadedSnapshot.error).toBeNull();
    expect(readTrinketCollection(reloadedSnapshot.data))
      .toEqual(expect.arrayContaining([
        expect.objectContaining({ id: overflow.id, slot: 0 }),
        expect.objectContaining({ id: displaced.id, slot: null })
      ]));
    await page.getByRole('button', { name: new RegExp(`Keepsake slot 1, ${overflow.name}`) }).click();
    await page.getByRole('button', { name: 'Remove', exact: true }).click();
    await expect(page.locator('#keepsake-manager')).toContainText('Keepsake returned to the collection.');
    await expect(page.locator('#keepsake-manager')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Collection', exact: true })).toBeFocused();
    await expect(page.getByRole('button', { name: /Keepsake slot 1, empty/ })).toBeVisible();

  } finally {
    const deleted = await player.admin.auth.admin.deleteUser(player.userId);
    if (deleted.error && !/database error deleting user/i.test(deleted.error.message)) throw deleted.error;
  }
});
