export const WORLD_PUBLIC_CODEX_VERSION = 'world-public-codex-v1' as const;

export type PublicCodexEntityKind = 'npc' | 'location' | 'faction' | 'item' | 'recipe' | 'world_event';
export type PublicCodexGroup = 'people' | 'locations' | 'factions' | 'items' | 'recipes' | 'events';

export interface PublicCodexProvenance {
  kind: 'canonical_discovery' | 'procedural_entity_outcome' | 'procedural_public_event' | 'resident_evolution';
  day: number;
  profileRevision?: number;
}

export interface PublicCodexEntity {
  id: string;
  kind: PublicCodexEntityKind;
  title: string;
  summary: string;
  day: number;
  provenance: PublicCodexProvenance;
}

export interface PublicCodexEvent {
  id: string;
  templateKey: string;
  title: string;
  summary: string;
  day: number;
  provenance: PublicCodexProvenance;
}

export interface PublicCodexDisposition {
  instanceId: string;
  name: string;
  title: string | null;
  state: string;
  summary: string;
  day: number;
  provenance: PublicCodexProvenance;
}

export interface PublicWorldCodex {
  version: typeof WORLD_PUBLIC_CODEX_VERSION;
  entities: PublicCodexEntity[];
  publicEvents: PublicCodexEvent[];
  dispositions: PublicCodexDisposition[];
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ENTITY_KINDS = new Set<PublicCodexEntityKind>(['npc', 'location', 'faction', 'item', 'recipe', 'world_event']);
const GROUP_BY_KIND: Record<PublicCodexEntityKind, PublicCodexGroup> = {
  npc: 'people', location: 'locations', faction: 'factions', item: 'items', recipe: 'recipes', world_event: 'events'
};

type RecordValue = Record<string, unknown>;
function object(value: unknown): value is RecordValue { return !!value && typeof value === 'object' && !Array.isArray(value); }
function exact(value: RecordValue, keys: readonly string[]) { const found = Object.keys(value); return found.length === keys.length && found.every((key) => keys.includes(key)); }
function text(value: unknown, maximum: number): value is string { return typeof value === 'string' && value.trim().length > 0 && value.trim().length <= maximum; }
function day(value: unknown): value is number { return typeof value === 'number' && Number.isSafeInteger(value) && value >= 1; }
function uuid(value: unknown): value is string { return typeof value === 'string' && UUID.test(value); }

function provenance(value: unknown, kind: PublicCodexProvenance['kind'], includeRevision = false): PublicCodexProvenance | null {
  if (!object(value) || !exact(value, includeRevision ? ['kind', 'day', 'profileRevision'] : ['kind', 'day']) || value.kind !== kind || !day(value.day)) return null;
  if (includeRevision && (!Number.isSafeInteger(value.profileRevision) || (value.profileRevision as number) < 1)) return null;
  return includeRevision
    ? { kind, day: value.day, profileRevision: value.profileRevision as number }
    : { kind, day: value.day };
}

function entity(value: unknown): PublicCodexEntity | null {
  if (!object(value) || !exact(value, ['id', 'kind', 'title', 'summary', 'day', 'provenance']) || !uuid(value.id) || !ENTITY_KINDS.has(value.kind as PublicCodexEntityKind) || !text(value.title, 120) || !text(value.summary, 500) || !day(value.day)) return null;
  const sourceKind = object(value.provenance) && value.provenance.kind === 'procedural_entity_outcome'
    ? 'procedural_entity_outcome' : 'canonical_discovery';
  const source = provenance(value.provenance, sourceKind);
  return source ? { id:value.id, kind:value.kind as PublicCodexEntityKind, title:value.title.trim(), summary:value.summary.trim(), day:value.day, provenance:source } : null;
}

function publicEvent(value: unknown): PublicCodexEvent | null {
  if (!object(value) || !exact(value, ['id', 'templateKey', 'title', 'summary', 'day', 'provenance']) || !uuid(value.id) || !text(value.templateKey, 80) || !text(value.title, 120) || !text(value.summary, 500) || !day(value.day)) return null;
  const source = provenance(value.provenance, 'procedural_public_event');
  return source ? { id:value.id, templateKey:value.templateKey.trim(), title:value.title.trim(), summary:value.summary.trim(), day:value.day, provenance:source } : null;
}

function disposition(value: unknown): PublicCodexDisposition | null {
  if (!object(value) || !exact(value, ['instanceId', 'name', 'title', 'state', 'summary', 'day', 'provenance']) || !uuid(value.instanceId) || !text(value.name, 120) || !(value.title === null || text(value.title, 120)) || !text(value.state, 48) || !text(value.summary, 240) || !day(value.day)) return null;
  const source = provenance(value.provenance, 'resident_evolution', true);
  return source ? { instanceId:value.instanceId, name:value.name.trim(), title:value.title === null ? null : value.title.trim(), state:value.state.trim(), summary:value.summary.trim(), day:value.day, provenance:source } : null;
}

/** Refuse a whole malformed projection rather than letting unreviewed fields reach player UI. */
export function parsePublicWorldCodex(value: unknown): PublicWorldCodex {
  if (!object(value) || !exact(value, ['version', 'entities', 'publicEvents', 'dispositions']) || value.version !== WORLD_PUBLIC_CODEX_VERSION || !Array.isArray(value.entities) || !Array.isArray(value.publicEvents) || !Array.isArray(value.dispositions) || value.entities.length > 150 || value.publicEvents.length > 60 || value.dispositions.length > 60) throw new Error('Invalid world codex projection');
  const entities = value.entities.map(entity);
  const publicEvents = value.publicEvents.map(publicEvent);
  const dispositions = value.dispositions.map(disposition);
  if (entities.some((entry) => !entry) || publicEvents.some((entry) => !entry) || dispositions.some((entry) => !entry)) throw new Error('Invalid world codex projection');
  return { version: WORLD_PUBLIC_CODEX_VERSION, entities: entities as PublicCodexEntity[], publicEvents: publicEvents as PublicCodexEvent[], dispositions: dispositions as PublicCodexDisposition[] };
}

export function publicCodexGroup(kind: PublicCodexEntityKind): PublicCodexGroup { return GROUP_BY_KIND[kind]; }
