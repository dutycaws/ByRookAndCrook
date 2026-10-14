import { describe, expect, it } from 'vitest';
import { bakeAcquisitionCard, brewAcquisitionCard, claimAcquisitionEvent, claimAcquisitionReceipt, harvestAcquisitionCard, honeyAcquisitionCard } from '../../src/lib/game/acquisition';

describe('acquisition event presentation', () => {
  it('shows crop and honey acquisitions only for matching committed receipts, once each', () => {
    const seen = new Set<string>();
    expect(claimAcquisitionReceipt('harvest', 'harvest_crop', 'crop-1', 'other', seen)).toBeNull();
    expect(claimAcquisitionReceipt('harvest', 'harvest_crop', 'crop-1', 'crop-1', seen)).toBe('harvest:crop-1');
    expect(claimAcquisitionReceipt('harvest', 'harvest_crop', 'crop-1', 'crop-1', seen)).toBeNull();
    expect(claimAcquisitionReceipt('honey', 'feed', 'honey-1', 'honey-1', seen)).toBeNull();
    expect(claimAcquisitionReceipt('honey', 'extract_honey', 'honey-1', 'honey-1', seen)).toBe('honey:honey-1');
    expect(claimAcquisitionReceipt('honey', 'extract_honey', 'honey-1', 'honey-1', seen)).toBeNull();
  });

  it('presents received crop and honey quantities and rejects non-acquisitions', () => {
    expect(harvestAcquisitionCard('harvest:crop-1', { quantity: 2, qualityIndex: 4 }, { name: 'Fennel' }))
      .toMatchObject({ title: 'Fennel', quantityLabel: '2 ingredients', artKind: 'item' });
    const receipt = { actionId: 'honey-1', commandKind: 'extract_honey' as const,
      committedRevision: 1, rulesVersion: 'garden-apiary-v1', normalizedPayload: {},
      result: { quantity: 3, qualityIndex: 5 } };
    expect(honeyAcquisitionCard('honey:honey-1', receipt)).toMatchObject({ title: 'Honey', quantityLabel: '3 ingredients' });
    expect(honeyAcquisitionCard('honey:honey-1', { ...receipt, result: { quantity: 0, qualityIndex: 5 } })).toBeNull();
    expect(honeyAcquisitionCard('honey:honey-1', { ...receipt, commandKind: 'feed' })).toBeNull();
  });

  it('claims an authoritative completed action once, including a replayed retry receipt', () => {
    const seen = new Set<string>();
    expect(claimAcquisitionReceipt('brew', 'complete', 'action-1', 'action-1', seen)).toBe('brew:action-1');
    expect(claimAcquisitionReceipt('brew', 'complete', 'action-1', 'action-1', seen)).toBeNull();
    expect(claimAcquisitionReceipt('bake', 'complete', 'action-1', 'action-1', seen)).toBe('bake:action-1');
  });

  it('does not claim failed, preview, mismatched receipts, or unidentified results', () => {
    const seen = new Set<string>();
    expect(claimAcquisitionEvent('purchase', 'action-2', false, seen)).toBeNull();
    expect(claimAcquisitionReceipt('brew', 'start', 'action-2', 'action-2', seen)).toBeNull();
    expect(claimAcquisitionReceipt('purchase', 'purchase', 'action-2', 'older-action', seen)).toBeNull();
    expect(claimAcquisitionEvent('bake', '', true, seen)).toBeNull();
    expect(seen.size).toBe(0);
  });

  it('keeps separate acquisition types distinct when they share an action ID', () => {
    const seen = new Set<string>();
    expect(claimAcquisitionEvent('purchase', 'action-3', true, seen)).toBe('purchase:action-3');
    expect(claimAcquisitionEvent('bake', 'action-3', true, seen)).toBe('bake:action-3');
  });

  it('treats a confirmed garden expansion as a shop acquisition', () => {
    expect(claimAcquisitionReceipt('purchase', 'expand', 'action-4', 'action-4', new Set())).toBe('purchase:action-4');
  });

  it('builds brewery and bakery rewards from their exact completion receipts', () => {
    const bottle = brewAcquisitionCard('brew:action-5', {
      beverageName: 'Heather honey mead', dayNumber: 8, qualityIndex: 5
    });
    const loaf = bakeAcquisitionCard('bake:action-6', {
      foodName: 'Sage loaf', dayNumber: 9, qualityIndex: 2, timingBand: 'red'
    });

    expect(bottle).toMatchObject({ id: 'brew:action-5', title: 'Heather honey mead', quantityLabel: '1 bottle', artKind: 'bottle' });
    expect(bottle.details?.[0].value).toBeTruthy();
    expect(loaf).toMatchObject({ id: 'bake:action-6', title: 'Sage loaf', quantityLabel: '1 loaf', artKind: 'loaf' });
    expect(loaf.imageSrc).toContain('bakery-loaf-overbaked.webp');
    expect(loaf.details?.[1].value).toBe('red');
  });
});
