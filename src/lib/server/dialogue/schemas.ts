const string = { type: 'string' };
const enumeration = (values: string[]) => ({ type: 'string', enum: values });
const array = (items: unknown) => ({ type: 'array', items });
const object = (properties: Record<string, unknown>) => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });
export const intentionSchema = object({ goal: string, motivation: string, targets: array(string), steps: array(object({
  action: enumeration(['prepare','attempt','wait','abandon']), approach: enumeration(['scouting','combat','diplomacy','trade'])
})) });
export const schemas = {
  investigate: object({ kind: enumeration(['informational','social','planning']), needsMore: { type:'boolean' }, remember: { type:'boolean' },
    requests: array(object({ category: enumeration(['quests','history','relationships','memories','news']), query: string })) }),
  deliberate: object({ stance: enumeration(['agree','refuse','clarify','respond']), reaction: { type:'integer', enum:[-1,0,1] },
    subject: enumeration(['quest','personal','hospitality']), evidence: string, intention: { anyOf:[intentionSchema,{type:'null'}] } }),
  speak: object({ text: string }),
  review: object({ ok: { type:'boolean' }, issues: array(string) }),
  remember: object({ memories: array(object({ kind: enumeration(['keeper_claim','npc_statement','promise','interaction']), text:string, quote:string, speaker:enumeration(['keeper','npc']) })) })
};
export type Stage = keyof typeof schemas;

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
