import { SETTLEMENT_PROMPTS } from './prompts';
import { parseFrozenCanonEventProposal, promptVersionForProviderStage, SettlementProviderError, type ProviderResult, type ProviderStage, type SettlementProvider } from './settlement-contracts';
import { parseFrozenSocialEncounterContext, parseSocialEncounterCriticDecision, parseSocialEncounterProposal, type FrozenSocialEncounterContext } from '$lib/game/evolving-world/social-encounter-contracts';

// Responses strict schemas require every nested object to have a closed shape.
// The versioned proposal itself is a discriminated union of typed game commands,
// so retain it as a bounded JSON string and parse/validate it in application code.
const proposalSchema = { type: 'object', additionalProperties: false, required: ['proposalJson'], properties: { proposalJson:{type:'string',minLength:2,maxLength:15000} } };
const socialProposalSchema = { type: 'object', additionalProperties: false, required: ['proposalJson'], properties: { proposalJson:{type:'string',minLength:2,maxLength:12000} } };
const canonEventSchema = { type: 'object', additionalProperties: false, required: ['eventJson'], properties: { eventJson:{type:'string',minLength:2,maxLength:4096} } };
const criticSchema = { type:'object', additionalProperties:false, required:['outcome','rationale','instructions'], properties:{outcome:{type:'string',enum:['accept','reject','repair']},rationale:{type:'string'},instructions:{type:'array',items:{type:'string'}}} };
const socialCriticSchema = {
  type:'object', additionalProperties:false, required:['decision','instructions'],
  properties:{
    decision:{type:'string',enum:['accept','reject','repair']},
    instructions:{type:'array',minItems:0,maxItems:4,items:{type:'object',additionalProperties:false,required:['code','path'],properties:{
      code:{type:'string',enum:['intent_capability','private_summary','evidence_grounding','causal_grounding','relationship_direction','gossip_attribution','public_projection']},
      path:{type:'string',enum:['privateCommunicativeIntents','privateExchangeSummary','evidenceIds','causalExplanation','relationshipEffects','gossipBeliefAdditions','publicSummary']}
    }}}
  }
};
const socialFinalCriticSchema = {
  type:'object', additionalProperties:false, required:['decision','instructions'],
  properties:{decision:{type:'string',enum:['accept','reject']},instructions:{type:'array',maxItems:0,items:{type:'object',additionalProperties:false,required:['code','path'],properties:{
    code:{type:'string',enum:['intent_capability','private_summary','evidence_grounding','causal_grounding','relationship_direction','gossip_attribution','public_projection']},
    path:{type:'string',enum:['privateCommunicativeIntents','privateExchangeSummary','evidenceIds','causalExplanation','relationshipEffects','gossipBeliefAdditions','publicSummary']}
  }}}}
};
const digestSchema = { type:'object', additionalProperties:false, required:['summary','journalEntries','discoveredEntityIds'], properties:{summary:{type:'string'},journalEntries:{type:'array',items:{type:'string'}},discoveredEntityIds:{type:'array',items:{type:'string'}}} };
const canonProposalStages = new Set<ProviderStage>(['canon_proposer','canon_repair']);
const socialProposalStages = new Set<ProviderStage>(['social_encounter_proposer','social_encounter_repair']);
const socialCriticStages = new Set<ProviderStage>(['social_encounter_critic','social_encounter_final_critic']);
const creativeStages = new Set<ProviderStage>(['proposer','repair','canon_proposer','canon_repair','social_encounter_proposer','social_encounter_repair']);
const criticStages = new Set<ProviderStage>(['critic','final_critic','canon_critic','canon_final_critic']);
function schema(stage: ProviderStage) { return stage === 'digest' ? digestSchema : stage === 'social_encounter_final_critic' ? socialFinalCriticSchema : socialCriticStages.has(stage) ? socialCriticSchema : criticStages.has(stage) ? criticSchema : canonProposalStages.has(stage) ? canonEventSchema : socialProposalStages.has(stage) ? socialProposalSchema : proposalSchema; }
function outputText(result: any): string { return result.output?.filter((item:any)=>item.type==='message').flatMap((item:any)=>item.content ?? []).filter((item:any)=>item.type==='output_text').map((item:any)=>item.text).join('') ?? ''; }
function exactPayload(value: unknown, keys: string[]): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype
    && Object.keys(value).length === keys.length && keys.every((key) => key in value);
}
function parseSocialPayload(stage: ProviderStage, payload: unknown): FrozenSocialEncounterContext | null {
  if (stage === 'social_encounter_proposer') return parseFrozenSocialEncounterContext(payload);
  if (stage === 'social_encounter_critic' || stage === 'social_encounter_final_critic') {
    if (!exactPayload(payload, ['context','proposal'])) return null;
    const context=parseFrozenSocialEncounterContext(payload.context);
    return context && parseSocialEncounterProposal(payload.proposal, context).ok ? context : null;
  }
  if (stage === 'social_encounter_repair') {
    if (!exactPayload(payload, ['context','proposal','instructions'])) return null;
    const context=parseFrozenSocialEncounterContext(payload.context);
    const repair=parseSocialEncounterCriticDecision({decision:'repair',instructions:payload.instructions});
    return context && parseSocialEncounterProposal(payload.proposal, context).ok && repair?.decision === 'repair' ? context : null;
  }
  return null;
}

export function createSettlementProvider(config: Record<string, string | undefined>): SettlementProvider {
  const provider = config.NPC_PROVIDER ?? 'openai';
  if (provider === 'local') return { async generate() { throw new SettlementProviderError('provider_unavailable', 'Local model support is not implemented.'); } };
  if (provider !== 'openai' || !config.OPENAI_API_KEY) return { async generate() { throw new SettlementProviderError('provider_unavailable', 'OpenAI is not configured.'); } };
  return { async generate(stage, payload, signal): Promise<ProviderResult> {
    const started = performance.now();
    const model = creativeStages.has(stage) ? config.NPC_CHARACTER_MODEL ?? 'gpt-5.6-terra' : config.NPC_CONTEXT_MODEL ?? 'gpt-5.6-luna';
    const socialContext=(socialProposalStages.has(stage) || socialCriticStages.has(stage)) ? parseSocialPayload(stage, payload) : null;
    if ((socialProposalStages.has(stage) || socialCriticStages.has(stage)) && !socialContext) {
      throw new SettlementProviderError('provider_malformed', 'The social encounter provider payload did not match the frozen contract.');
    }
    let response: Response;
    try {
      response = await fetch('https://api.openai.com/v1/responses', { method:'POST', signal, headers:{Authorization:`Bearer ${config.OPENAI_API_KEY}`,'Content-Type':'application/json'}, body:JSON.stringify({
        model, store:false, max_output_tokens:2200, reasoning:{effort:creativeStages.has(stage) ? 'low' : 'none'},
        input:[{role:'system',content:SETTLEMENT_PROMPTS[stage]},{role:'user',content:JSON.stringify(payload)}],
        text:{format:{type:'json_schema',name:`world_${stage}`,strict:true,schema:schema(stage)}}
      }) });
    } catch (cause) {
      if (signal.aborted) throw new SettlementProviderError('provider_timeout', 'The settlement provider timed out.');
      throw new SettlementProviderError('provider_failed', cause instanceof Error ? cause.message : 'The settlement provider failed.');
    }
    if (!response.ok) throw new SettlementProviderError(response.status === 401 || response.status === 403 ? 'provider_unavailable' : 'provider_failed', `The settlement provider failed (${response.status}).`);
    let result:any; try { result = await response.json(); } catch { throw new SettlementProviderError('provider_malformed','The settlement provider returned unreadable output.'); }
    if (result.status !== 'completed') throw new SettlementProviderError('provider_failed','The settlement provider did not complete.');
    try {
      const structured = JSON.parse(outputText(result));
      const value = canonProposalStages.has(stage)
        ? parseFrozenCanonEventProposal(JSON.parse(structured?.eventJson), payload)
        : socialProposalStages.has(stage)
          ? (() => {
            const parsed=parseSocialEncounterProposal(JSON.parse(structured?.proposalJson), socialContext!);
            return parsed.ok ? parsed.value : null;
          })()
          : socialCriticStages.has(stage)
            ? (() => {
              const decision=parseSocialEncounterCriticDecision(structured);
              return stage === 'social_encounter_final_critic' && decision?.decision === 'repair' ? null : decision;
            })()
        : stage === 'proposer' || stage === 'repair'
          ? JSON.parse(structured?.proposalJson)
          : structured;
      if (value === null) throw new SettlementProviderError('provider_malformed', 'The provider output did not match the frozen world contract.');
      return { value, model, usage:{input:result.usage?.input_tokens ?? 0, output:result.usage?.output_tokens ?? 0}, durationMs:Math.round(performance.now()-started), promptVersion:promptVersionForProviderStage(stage) };
    }
    catch { throw new SettlementProviderError('provider_malformed','The settlement provider returned malformed structured output.'); }
  } };
}
