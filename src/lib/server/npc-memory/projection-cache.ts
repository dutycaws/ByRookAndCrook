import { canonicalJson, sha256Hex, type NpcMemoryContextArtifact, type NpcMemorySourceManifest } from './context';

/** Process-local optimization only: durable checkpoints are always authoritative. */
const MAX_ARTIFACTS = 32;
const TTL_MS = 60_000;
type Scope = Readonly<{ actorId:string; instanceId:string; view:string; cutoffSequence:number; policyVersion:string; projectionVersion:string; tier:string; identity:string; sources:readonly NpcMemorySourceManifest[]; payload:Record<string,unknown> }>;
type Entry = Readonly<{ instanceId:string; artifact:NpcMemoryContextArtifact; expiresAt:number }>;
const entries=new Map<string,Entry>();

function freeze<T>(value:T): T { if(value&&typeof value==='object'&&!Object.isFrozen(value)){ Object.freeze(value); for(const child of Object.values(value as Record<string,unknown>)) freeze(child); } return value; }
export function projectionCacheKey(scope: Scope): string {
  // Only the digest is retained as a map key: neither keys nor diagnostics
  // expose evidence prose.
  return sha256Hex(canonicalJson({actorId:scope.actorId,instanceId:scope.instanceId,view:scope.view,cutoffSequence:scope.cutoffSequence,policyVersion:scope.policyVersion,projectionVersion:scope.projectionVersion,tier:scope.tier,identity:scope.identity,sourceManifest:scope.sources,payloadHash:sha256Hex(canonicalJson(scope.payload))}));
}
export function getProjectionArtifact(scope: Scope): NpcMemoryContextArtifact | undefined {
  const key=projectionCacheKey(scope); const entry=entries.get(key); if(!entry) return undefined;
  if(entry.expiresAt<=Date.now()) { entries.delete(key); return undefined; }
  entries.delete(key); entries.set(key,entry); return entry.artifact;
}
export function putProjectionArtifact(scope: Scope, artifact: NpcMemoryContextArtifact): NpcMemoryContextArtifact {
  const key=projectionCacheKey(scope);
  // Retain no scope/payload/prose: only opaque key, invalidation scope, frozen
  // artifact, and expiry survive after key construction.
  entries.delete(key); entries.set(key,Object.freeze({instanceId:scope.instanceId,artifact:freeze(artifact),expiresAt:Date.now()+TTL_MS}));
  while(entries.size>MAX_ARTIFACTS) entries.delete(entries.keys().next().value!);
  return artifact;
}
export function invalidateProjectionInstance(instanceId:string): void { for(const [key,entry] of entries) if(entry.instanceId===instanceId) entries.delete(key); }
export function clearProjectionCache(): void { entries.clear(); }
export function projectionCacheSize(): number { return entries.size; }
