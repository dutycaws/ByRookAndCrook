const string = { type: 'string' };
const enumeration = (values: string[]) => ({ type: 'string', enum: values });
const array = (items: unknown) => ({ type: 'array', items });
const object = (properties: Record<string, unknown>) => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });
export const intentionSchema = object({ goal: string, motivation: string, targets: array(string), steps: array(object({
  action: enumeration(['prepare','attempt','wait','abandon']), approach: enumeration(['scouting','combat','diplomacy','trade'])
})) });
const rememberedMemory = (kind: string[], speaker: string[], priorCommitmentId: unknown, commitmentStatus: unknown) => object({
  kind: enumeration(kind), text: string, quote: string, speaker: enumeration(speaker), priorCommitmentId, commitmentStatus
});
const rememberedMemorySchema = { anyOf: [
  rememberedMemory(['promise'], ['npc'], { type: 'null' }, enumeration(['unresolved'])),
  rememberedMemory(['promise'], ['npc'], string, enumeration(['withdrawn','disputed','superseded'])),
  rememberedMemory(['keeper_claim','npc_statement','interaction'], ['keeper','npc'], { type: 'null' }, { type: 'null' })
] };
export const schemas = {
  investigate: object({ kind: enumeration(['informational','social','planning']), needsMore: { type:'boolean' }, remember: { type:'boolean' },
    requests: array(object({ category: enumeration(['quests','history','relationships','memories','news','beliefs']), query: string })) }),
  deliberate: object({ stance: enumeration(['agree','refuse','clarify','respond']), reaction: { type:'integer', enum:[-1,0,1] },
    subject: enumeration(['quest','personal','hospitality']), evidence: string, intention: { anyOf:[intentionSchema,{type:'null'}] } }),
  speak: object({ text: string }),
  review: object({ ok: { type:'boolean' }, issues: array(string) }),
  remember: object({ memories: array(rememberedMemorySchema) })
};
export type Stage = keyof typeof schemas;

/** Normalize keeper-authored promises into attributed claims before checkpointing. */
export function normalizeRememberOutput(value: unknown): unknown {
  if (!value || typeof value !== 'object' || !Array.isArray((value as { memories?: unknown }).memories)) return value;
  const output = value as { memories: unknown[]; [key: string]: unknown };
  let changed = false;
  const memories = output.memories.map((memory) => {
    if (!memory || typeof memory !== 'object') return memory;
    const entry = memory as Record<string, unknown>;
    if (entry.kind !== 'promise' || entry.speaker !== 'keeper') return entry;
    changed = true;
    return { ...entry, kind: 'keeper_claim', commitmentStatus: null, priorCommitmentId: null };
  });
  return changed ? { ...output, memories } : value;
}

export type RememberQuoteIssue = Readonly<{ memoryIndex:number; source:'keeper'|'npc'; code:'quote_length_invalid'|'quote_not_in_source' }>;

/** Mirror the exact source and character-length gate enforced by SQL completion. */
export function rememberQuoteIssues(value:unknown,sources:{keeper:string;npc:string}):RememberQuoteIssue[] {
  if (!value || typeof value!=='object' || !Array.isArray((value as {memories?:unknown}).memories)) return [];
  return (value as {memories:unknown[]}).memories.flatMap((memory,memoryIndex):RememberQuoteIssue[]=>{
    if (!memory || typeof memory!=='object') return [];
    const entry=memory as Record<string,unknown>;
    if (entry.speaker!=='keeper' && entry.speaker!=='npc' || typeof entry.quote!=='string') return [];
    const source=entry.speaker;
    const quote=entry.quote;
    const length=Array.from(quote).length;
    if (length<3 || length>500) return [{memoryIndex,source,code:'quote_length_invalid' as const}];
    if (!sources[source].includes(quote)) return [{memoryIndex,source,code:'quote_not_in_source' as const}];
    return [];
  });
}

/** Provider-independent validation is retained even with OpenAI strict schemas. */
export function matchesSchema(value: unknown, schema: any): boolean {
  if (schema.anyOf) return schema.anyOf.some((s: any) => matchesSchema(value,s));
  if (schema.enum && !schema.enum.includes(value)) return false;
  if (schema.type==='null') return value===null;
  if (schema.type==='integer') return Number.isSafeInteger(value);
  if (schema.type==='string') return typeof value==='string';
  if (schema.type==='boolean') return typeof value==='boolean';
  if (schema.type==='array') return Array.isArray(value) && value.length<=20 && value.every(v=>matchesSchema(v,schema.items));
  if (schema.type==='object') return !!value && typeof value==='object' && !Array.isArray(value)
    && Object.keys(value).every(k=>k in schema.properties)
    && schema.required.every((k:string)=>Object.hasOwn(value,k) && matchesSchema((value as any)[k],schema.properties[k]));
  return false;
}
