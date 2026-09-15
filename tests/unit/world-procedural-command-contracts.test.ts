import { describe, expect, it } from 'vitest';
import {
  canonicalizeProceduralWorldProposal,
  parseProceduralWorldProposal,
  validateProceduralWorldProposal,
  type ProceduralWorldValidationContext
} from '../../src/lib/game/evolving-world';

const context: ProceduralWorldValidationContext = {
  entityKinds: { ranger:'npc', millhaven:'location', guild:'faction', herb:'item', loaf:'recipe', 'old-event':'world_event' },
  activeGeneratedEntityCount: 148,
  activeQuestByResident: {},
  capabilities: {
    '10000000-0000-4000-8000-000000000001': {
      version:'fixture', allowedActions:['prepare','attempt','wait','abandon'], allowedApproaches:['scouting','combat','diplomacy','trade'],
      allowedWorldEffects:['create_entity','create_quest','update_quest','record_world_event'], allowedTargetKinds:['npc','location','faction','item','recipe','world_event'], socialCapabilities:[], irreversibleEffects:[]
    }
  }
};

const proposal = () => ({
  version:'procedural-world-v1', commands:[
    { operation:'entity', effectKind:'create_entity', sourceResidentId:'10000000-0000-4000-8000-000000000001', entityKind:'place', entityKey:'Old Mill', archetypeKey:'landmark', proposedName:'Old Mill', payload:{region:'north',tags:['ruin']} },
    { operation:'quest', effectKind:'create_quest', ownerResidentId:'10000000-0000-4000-8000-000000000001', primitiveKey:'Successor Quest', action:'prepare', approach:'scouting', targetEntityRefs:['ranger','millhaven'], motivation:'Find the missing trail.' },
    { operation:'public_event', effectKind:'record_world_event', sourceResidentId:'10000000-0000-4000-8000-000000000001', templateKey:'market-day', participantEntityRefs:['ranger','millhaven'], title:'Market day returns', summary:'Merchants gather on the road.', reuseKey:'market-day-return' }
  ]
});

describe('procedural world command contracts', () => {
  it('normalizes registered aliases and retains finite public operations', () => {
    const parsed = parseProceduralWorldProposal(proposal(), context);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.commands[0]).toMatchObject({ entityKind:'location', entityKey:'old-mill', archetypeKey:'landmark' });
    expect(parsed.value.commands[1]).toMatchObject({ primitiveKey:'successor-quest' });
    expect(validateProceduralWorldProposal({ ...proposal(), commands:[{ ...proposal().commands[0], payload:{ note:'é'.repeat(900) } }] }, context)).toEqual([]);
    expect(validateProceduralWorldProposal({ ...proposal(), commands:[{ ...proposal().commands[0], payload:{ note:'é'.repeat(1100) } }] }, context)).not.toEqual([]);
  });

  it('rejects unsupported operations, non-frozen targets, unsafe payloads, and lifecycle conflicts', () => {
    expect(validateProceduralWorldProposal({ ...proposal(), commands:[{ operation:'sql', effectKind:'create_entity' }] }, context)).not.toEqual([]);
    expect(validateProceduralWorldProposal({ ...proposal(), commands:[{ ...proposal().commands[0], payload:{ handler:'bad' } }] }, context)).not.toEqual([]);
    expect(validateProceduralWorldProposal({ ...proposal(), commands:[{ ...proposal().commands[0], payload:{ nested:{ script:'bad' } } }] }, context)).not.toEqual([]);
    expect(validateProceduralWorldProposal({ ...proposal(), commands:[{ ...proposal().commands[0], payload:{ one:{ two:{ three:{ four:'too deep' } } } } }] }, context)).not.toEqual([]);
    expect(validateProceduralWorldProposal({ version:'procedural-world-v1', commands:[{ operation:'retire', effectKind:'retire_entity', entityId:'millhaven', reason:'too soon' }] }, context)).not.toEqual([]);
    expect(validateProceduralWorldProposal({ ...proposal(), commands:[{ ...proposal().commands[1], targetEntityRefs:['unknown'] }] }, context)).not.toEqual([]);
    expect(validateProceduralWorldProposal({ ...proposal(), commands:[{ ...proposal().commands[1], effectKind:'update_quest' }] }, context)).not.toEqual([]);
    expect(validateProceduralWorldProposal({ ...proposal(), commands:[{ ...proposal().commands[2], participantEntityRefs:['unknown'] }] }, context)).not.toEqual([]);
    expect(validateProceduralWorldProposal({ ...proposal(), commands:[proposal().commands[2],{ ...proposal().commands[2], title:'Conflicting duplicate' }] }, context)).not.toEqual([]);
    expect(validateProceduralWorldProposal(proposal(), { ...context, activeGeneratedEntityCount:150 })).not.toEqual([]);
    expect(validateProceduralWorldProposal(proposal(), { ...context, activeGeneratedEntityCount:149 })).not.toEqual([]);
    expect(validateProceduralWorldProposal({ version:'procedural-world-v1', commands:[{ ...proposal().commands[0], entityKey:'Millhaven', proposedName:'Millhaven' }] }, { ...context, activeGeneratedEntityCount:150 })).toEqual([]);
    expect(validateProceduralWorldProposal({ version:'procedural-world-v1', commands:[{ ...proposal().commands[2], reuseKey:'old-event' }] }, { ...context, activeGeneratedEntityCount:150 })).toEqual([]);
  });

  it('enforces the one-active-successor-quest boundary and produces stable canonical text', () => {
    const update = { ...proposal(), commands:[{ ...proposal().commands[1], effectKind:'update_quest', action:'attempt' }] };
    expect(validateProceduralWorldProposal(update, { ...context, activeQuestByResident:{ '10000000-0000-4000-8000-000000000001':{ id:'quest-1', primitiveKey:'successor-quest' } } })).toEqual([]);
    const one = canonicalizeProceduralWorldProposal(proposal(), context);
    const reordered = { commands:[{ ...proposal().commands[0], payload:{ tags:['ruin'], region:'north' } }, ...proposal().commands.slice(1)], version:'procedural-world-v1' };
    expect(one).toBe(canonicalizeProceduralWorldProposal(reordered, context));
  });

  it('permits only registered canonical recipe gameplay unlocks', () => {
    const item = { version:'procedural-world-v1', commands:[
      { operation:'entity', effectKind:'create_entity', sourceResidentId:'10000000-0000-4000-8000-000000000001', entityKind:'recipe', entityKey:'forest-loaf', archetypeKey:'crafted-dish', proposedName:'Forest loaf', payload:{} },
      { operation:'gameplay_unlock', effectKind:'unlock_gameplay', sourceResidentId:'10000000-0000-4000-8000-000000000001', entityRef:'forest-loaf', family:'herb_loaf_variant', definition:{ displayName:'Forest loaf' } }
    ] };
    expect(parseProceduralWorldProposal(item, context)).toMatchObject({ ok:true });
    expect(parseProceduralWorldProposal({ ...item, commands:[item.commands[1], item.commands[0]] }, context)).toMatchObject({ ok:true });
    expect(validateProceduralWorldProposal({ ...item, commands:[item.commands[0], { ...item.commands[1], entityRef:'loaf' }] }, context)).not.toEqual([]);
    expect(validateProceduralWorldProposal({ ...item, commands:[item.commands[0], { ...item.commands[1], definition:{ displayName:'Bad', extra:true } }] }, context)).not.toEqual([]);
    expect(parseProceduralWorldProposal({ version:'procedural-world-v1', commands:[
      { operation:'gameplay_unlock', effectKind:'unlock_gameplay', sourceResidentId:'10000000-0000-4000-8000-000000000001', entityRef:'loaf', family:'herb_loaf_variant', definition:{displayName:'Forest loaf'} }
    ] }, context)).toMatchObject({ ok:false });
  });

  it('permits only finite settlement supplies bound to a same-proposal item', () => {
    const supply = { version:'procedural-world-v1', commands:[
      { operation:'entity', effectKind:'create_entity', sourceResidentId:'10000000-0000-4000-8000-000000000001', entityKind:'item', entityKey:'road-provisions', archetypeKey:'trade-good', proposedName:'Road provisions', payload:{} },
      { operation:'gameplay_unlock', effectKind:'unlock_gameplay', sourceResidentId:'10000000-0000-4000-8000-000000000001', entityRef:'road-provisions', family:'successor_provisions', definition:{ displayName:'Road provisions', price:12, dailyStock:3 } }
    ] };
    expect(parseProceduralWorldProposal(supply, context)).toMatchObject({ ok:true });
    expect(validateProceduralWorldProposal({ ...supply, commands:[supply.commands[0], { ...supply.commands[1], definition:{ ...supply.commands[1].definition, effect:'run' } }] }, context)).not.toEqual([]);
    expect(validateProceduralWorldProposal({ ...supply, commands:[{ ...supply.commands[0], entityKind:'recipe' }, supply.commands[1]] }, context)).not.toEqual([]);
    expect(validateProceduralWorldProposal({ ...supply, commands:[supply.commands[0], { ...supply.commands[1], definition:{ displayName:'Road provisions', price:0, dailyStock:3 } }] }, context)).not.toEqual([]);
  });
});
