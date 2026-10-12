import { describe, expect, it } from 'vitest';
import { bakeAcquisitionCard, brewAcquisitionCard, claimAcquisitionEvent, claimAcquisitionReceipt } from '../../src/lib/game/acquisition';

describe('acquisition event presentation', () => {
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
