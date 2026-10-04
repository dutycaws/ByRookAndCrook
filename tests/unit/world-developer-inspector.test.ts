import { describe, expect, it } from 'vitest';
import { parseDeveloperInspector } from '$lib/game/evolving-world/developer-inspector';

const id='11111111-1111-4111-8111-111111111111';
const hash='a'.repeat(64);
const projection={version:'world-developer-inspector-v1',entities:[{id,kind:'npc',key:'mara',origin:'procedural',sourceVersion:'world-v1',lifecycle:'active',discoveredDay:2,retiredDay:null,createdAt:'2026-01-01T00:00:00Z',relevance:20,history:[{eventKind:'created',sourceVersion:'world-v1',createdAt:'2026-01-01T00:00:00Z'}]}],settlements:[{id,dayNumber:2,status:'failed',deadlineAt:'2026-01-01T00:00:00Z',failureCode:'TIMEOUT',createdAt:'2026-01-01T00:00:00Z',completedAt:null,jobs:[{id,ordinal:1,kind:'resident',status:'failed',failureCode:'TIMEOUT',createdAt:'2026-01-01T00:00:00Z',completedAt:null,attempts:[{attempt:1,status:'failed',leaseUntil:'2026-01-01T00:00:00Z',failureCode:'TIMEOUT',startedAt:'2026-01-01T00:00:00Z',finishedAt:'2026-01-01T00:00:00Z'}],checkpoints:[{stage:'critic',model:'gpt-test',promptVersion:'world-v1',createdAt:'2026-01-01T00:00:00Z'}]}]}],artJobs:[{id,entityId:id,status:'accepted',attempt:1,appearanceVersion:'world-v2',failureCode:null,createdAt:'2026-01-01T00:00:00Z',completedAt:'2026-01-01T00:00:00Z',renderId:id}],overrides:[{id,saveId:id,targetKind:'runtime_art_job',targetId:id,operation:'requeue_runtime_art_job',beforeHash:hash,outcome:'Requeued art.',actorId:id,createdAt:'2026-01-01T00:00:00Z'}]};

describe('world developer inspector projection',()=>{
  it('accepts the bounded operational metadata projection',()=>expect(parseDeveloperInspector(projection)).toEqual(projection));
  it('rejects raw checkpoint, provider, and storage fields before they reach the local browser',()=>{
    expect(()=>parseDeveloperInspector({...projection,settlements:[{...projection.settlements[0],jobs:[{...projection.settlements[0].jobs[0],checkpoints:[{...projection.settlements[0].jobs[0].checkpoints[0],payload:{prompt:'private'}}]}]}]})).toThrow('Invalid');
    expect(()=>parseDeveloperInspector({...projection,artJobs:[{...projection.artJobs[0],runtimeKey:'accepted/private.png'}]})).toThrow('Invalid');
    expect(()=>parseDeveloperInspector({...projection,overrides:[{...projection.overrides[0],summary:'x',payload:{arbitrary:true}}]})).toThrow('Invalid');
  });
  it('rejects arbitrary provider failure text instead of treating it as safe inspector metadata',()=>{
    expect(()=>parseDeveloperInspector({...projection,artJobs:[{...projection.artJobs[0],failureCode:'provider response: secret prompt'}]})).toThrow('Invalid');
  });
});
