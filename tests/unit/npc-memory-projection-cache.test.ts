import { afterEach, describe, expect, it, vi } from 'vitest';
import { assembleNpcMemoryContext } from '$lib/server/npc-memory/context';
import { clearProjectionCache, getProjectionArtifact, invalidateProjectionInstance, projectionCacheSize, putProjectionArtifact } from '$lib/server/npc-memory/projection-cache';

const artifact=assembleNpcMemoryContext({policyVersion:'test',projectionVersion:'v4',maxBytes:1024,maxTokens:10,tier:'routine',sources:[],payload:{ok:true},tokenCount:1,tokenizerId:'test',counterId:'test',counterDurationMs:0,model:'test'});
const scope=(index:number,instanceId=`00000000-0000-4000-8000-${String(index).padStart(12,'0')}`)=>({actorId:'11111111-1111-4111-8111-111111111111',instanceId,view:'speech',cutoffSequence:index,policyVersion:'test',projectionVersion:'v4',tier:'routine',identity:'counter:test',sources:[],payload:{index}} as const);
afterEach(() => { clearProjectionCache(); vi.useRealTimers(); });
describe('npc memory projection cache',()=>{
  it('uses exact hashed scopes, enforces LRU 32, and supports scoped/all invalidation',()=>{
    for(let i=0;i<33;i++) putProjectionArtifact(scope(i),artifact);
    expect(projectionCacheSize()).toBe(32); expect(getProjectionArtifact(scope(0))).toBeUndefined();
    expect(getProjectionArtifact(scope(1))).toBe(artifact); expect(getProjectionArtifact({...scope(1),cutoffSequence:2})).toBeUndefined();
    expect(getProjectionArtifact({...scope(1),actorId:'22222222-2222-4222-8222-222222222222'})).toBeUndefined();
    expect(getProjectionArtifact({...scope(1),view:'transition'})).toBeUndefined();
    expect(getProjectionArtifact({...scope(1),identity:'other-model:counter'})).toBeUndefined();
    expect(getProjectionArtifact({...scope(1),payload:{index:1,profileMarker:'changed'}})).toBeUndefined();
    expect(getProjectionArtifact({...scope(1),sources:[{id:'source-1',version:1,hash:'a'.repeat(64),kind:'dialogue_turn',ledgerSequence:1}]})).toBeUndefined();
    invalidateProjectionInstance(scope(1).instanceId); expect(getProjectionArtifact(scope(1))).toBeUndefined();
    clearProjectionCache(); expect(projectionCacheSize()).toBe(0);
  });
  it('expires artifacts by TTL',()=>{
    vi.useFakeTimers(); putProjectionArtifact(scope(1),artifact); vi.advanceTimersByTime(60_001);
    expect(getProjectionArtifact(scope(1))).toBeUndefined();
  });
});
