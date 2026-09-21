import type { PromptSnapshot } from '$lib/server/prompt-registry';
import { parseFrozenCanonEventProposal, promptVersionForProviderStage, SettlementProviderError, type ProviderResult, type ProviderStage, type SettlementProvider } from './settlement-contracts';
import { parseFrozenSocialEncounterContext, parseSocialEncounterCriticDecision, parseSocialEncounterProposal, type FrozenSocialEncounterContext } from '$lib/game/evolving-world/social-encounter-contracts';
import { parseFrozenProceduralWorldContext, parseProceduralWorldCriticDecision, parseProceduralWorldProposal, PROCEDURAL_WORLD_CRITIC_CODES, PROCEDURAL_WORLD_CRITIC_PATHS, type FrozenProceduralWorldContext } from '$lib/game/evolving-world/procedural-world-contracts';
import { parseQuestTransitionCriticDecision, parseQuestTransitionProposal, QUEST_TRANSITION_CRITIC_CODES, QUEST_TRANSITION_CRITIC_PATHS, type QuestTransitionValidationContext } from '$lib/game/evolving-world/quest-transition-contracts';

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
const proceduralProposalSchema = { type:'object',additionalProperties:false,required:['proposalJson'],properties:{proposalJson:{type:'string',minLength:2,maxLength:12000}} };
const proceduralCriticSchema = { type:'object',additionalProperties:false,required:['decision','instructions'],properties:{decision:{type:'string',enum:['accept','reject','repair']},instructions:{type:'array',minItems:0,maxItems:4,items:{type:'object',additionalProperties:false,required:['code','path'],properties:{code:{type:'string',enum:PROCEDURAL_WORLD_CRITIC_CODES},path:{type:'string',enum:PROCEDURAL_WORLD_CRITIC_PATHS}}}}} };
const proceduralFinalCriticSchema = { type:'object',additionalProperties:false,required:['decision','instructions'],properties:{decision:{type:'string',enum:['accept','reject']},instructions:{type:'array',maxItems:0,items:{type:'object',additionalProperties:false,required:['code','path'],properties:{code:{type:'string',enum:PROCEDURAL_WORLD_CRITIC_CODES},path:{type:'string',enum:PROCEDURAL_WORLD_CRITIC_PATHS}}}}} };
const questTransitionProposalSchema = { type:'object',additionalProperties:false,required:['proposalJson'],properties:{proposalJson:{type:'string',minLength:2,maxLength:6000}} };
const questTransitionCriticSchema = { type:'object',additionalProperties:false,required:['decision','instructions'],properties:{decision:{type:'string',enum:['accept','reject','repair']},instructions:{type:'array',minItems:0,maxItems:4,items:{type:'object',additionalProperties:false,required:['code','path'],properties:{code:{type:'string',enum:QUEST_TRANSITION_CRITIC_CODES},path:{type:'string',enum:QUEST_TRANSITION_CRITIC_PATHS}}}}} };
const questTransitionFinalCriticSchema = { type:'object',additionalProperties:false,required:['decision','instructions'],properties:{decision:{type:'string',enum:['accept','reject']},instructions:{type:'array',maxItems:0,items:{type:'object',additionalProperties:false,required:['code','path'],properties:{code:{type:'string',enum:QUEST_TRANSITION_CRITIC_CODES},path:{type:'string',enum:QUEST_TRANSITION_CRITIC_PATHS}}}}} };
const digestSchema = { type:'object', additionalProperties:false, required:['summary','journalEntries','discoveredEntityIds'], properties:{summary:{type:'string'},journalEntries:{type:'array',items:{type:'string'}},discoveredEntityIds:{type:'array',items:{type:'string'}}} };
const canonProposalStages = new Set<ProviderStage>(['canon_proposer','canon_repair']);
const socialProposalStages = new Set<ProviderStage>(['social_encounter_proposer','social_encounter_repair']);
const socialCriticStages = new Set<ProviderStage>(['social_encounter_critic','social_encounter_final_critic']);
const proceduralProposalStages = new Set<ProviderStage>(['procedural_world_proposer','procedural_world_repair']);
const proceduralCriticStages = new Set<ProviderStage>(['procedural_world_critic','procedural_world_final_critic']);
const questTransitionProposalStages = new Set<ProviderStage>(['quest_transition_proposer','quest_transition_repair']);
const questTransitionCriticStages = new Set<ProviderStage>(['quest_transition_critic','quest_transition_final_critic']);
const creativeStages = new Set<ProviderStage>(['proposer','repair','canon_proposer','canon_repair','social_encounter_proposer','social_encounter_repair','procedural_world_proposer','procedural_world_repair','quest_transition_proposer','quest_transition_repair']);
const criticStages = new Set<ProviderStage>(['critic','final_critic','canon_critic','canon_final_critic']);
function schema(stage: ProviderStage) { return stage === 'digest' ? digestSchema : stage === 'social_encounter_final_critic' ? socialFinalCriticSchema : stage === 'procedural_world_final_critic' ? proceduralFinalCriticSchema : stage === 'quest_transition_final_critic' ? questTransitionFinalCriticSchema : socialCriticStages.has(stage) ? socialCriticSchema : proceduralCriticStages.has(stage) ? proceduralCriticSchema : questTransitionCriticStages.has(stage) ? questTransitionCriticSchema : criticStages.has(stage) ? criticSchema : canonProposalStages.has(stage) ? canonEventSchema : socialProposalStages.has(stage) ? socialProposalSchema : proceduralProposalStages.has(stage) ? proceduralProposalSchema : questTransitionProposalStages.has(stage) ? questTransitionProposalSchema : proposalSchema; }
function outputText(result: any): string { return result.output?.filter((item:any)=>item.type==='message').flatMap((item:any)=>item.content ?? []).filter((item:any)=>item.type==='output_text').map((item:any)=>item.text).join('') ?? ''; }
function exactPayload(value: unknown, keys: string[]): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype
    && Object.keys(value).length === keys.length && keys.every((key) => key in value);
}
function plainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
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
function parseProceduralPayload(stage: ProviderStage, payload: unknown): FrozenProceduralWorldContext | null {
  if (stage === 'procedural_world_proposer') return parseFrozenProceduralWorldContext(payload);
  if (stage === 'procedural_world_critic' || stage === 'procedural_world_final_critic') {
    if (!exactPayload(payload, ['context','proposal'])) return null;
    const context=parseFrozenProceduralWorldContext(payload.context);
    return context && parseProceduralWorldProposal(payload.proposal, context).ok ? context : null;
  }
  if (stage === 'procedural_world_repair') {
    if (!exactPayload(payload, ['context','proposal','instructions'])) return null;
    const context=parseFrozenProceduralWorldContext(payload.context);
    const repair=parseProceduralWorldCriticDecision({decision:'repair',instructions:payload.instructions});
    return context && parseProceduralWorldProposal(payload.proposal, context).ok && repair?.decision === 'repair' ? context : null;
  }
  return null;
}
function questTransitionContext(value: unknown): QuestTransitionValidationContext | null {
  if (!exactPayload(value, ['terminalEventId','residentId','frozenTargetRefs','capabilities']) && !exactPayload(value, ['terminalEventId','residentId','frozenTargetRefs','capabilities','nextAuthoredMilestone']) && !exactPayload(value, ['terminalEventId','residentId','frozenTargetRefs','capabilities','otherResidentIds']) && !exactPayload(value, ['terminalEventId','residentId','frozenTargetRefs','capabilities','nextAuthoredMilestone','otherResidentIds'])) return null;
  const source=value as Record<string, unknown>; const capability=source.capabilities;
  if (typeof source.terminalEventId !== 'string' || typeof source.residentId !== 'string' || !Array.isArray(source.frozenTargetRefs) || !source.frozenTargetRefs.every((item) => typeof item === 'string') || !capability || typeof capability !== 'object' || Array.isArray(capability)) return null;
  const caps=capability as Record<string, unknown>;
  if (!Array.isArray(caps.actions) || !caps.actions.every((item) => typeof item === 'string') || !Array.isArray(caps.approaches) || !caps.approaches.every((item) => typeof item === 'string') || typeof caps.allowGeneratedSuccessor !== 'boolean' || typeof caps.allowDeparture !== 'boolean') return null;
  if ('nextAuthoredMilestone' in source && (!source.nextAuthoredMilestone || typeof source.nextAuthoredMilestone !== 'object' || Array.isArray(source.nextAuthoredMilestone) || typeof (source.nextAuthoredMilestone as Record<string, unknown>).id !== 'string')) return null;
  if ('otherResidentIds' in source && (!Array.isArray(source.otherResidentIds) || !source.otherResidentIds.every((item) => typeof item === 'string'))) return null;
  return source as QuestTransitionValidationContext;
}
function questTransitionFrozenContext(value: unknown): Record<string, unknown> | null {
  // This is an exact bounded projection, not an opportunistic provider input.
  // Hospitality remains canonical audit data but is intentionally omitted from
  // the transition prompt snapshot.
  if (!exactPayload(value, ['quest','terminalEvent','eventHistory','versionSheet','capabilityEnvelope','registeredActions','registeredApproaches','validCanonicalTargets','currentProfile','nextAuthoredMilestone','dialogueEvidence','beliefs','socialEdges'])) return null;
  try {
    return JSON.stringify(value).length <= 65_536 ? value : null;
  } catch { return null; }
}
function parseQuestTransitionPayload(stage: ProviderStage, payload: unknown): QuestTransitionValidationContext | null {
  const dossier = (value: unknown): boolean => {
    if (!exactPayload(value, ['version','fingerprint','manifest','coverage','bytes','evidence'])) return false;
    const source = value as Record<string, unknown>;
    if (source.version !== 'quest-transition-memory-dossier-v1' || typeof source.fingerprint !== 'string' || !/^[0-9a-f]{64}$/i.test(source.fingerprint)
      || !plainObject(source.manifest) || !plainObject(source.coverage) || !plainObject(source.bytes) || !plainObject(source.evidence)) return false;
    const manifest = source.manifest;
    const coverage = source.coverage;
    const bytes = source.bytes;
    return exactPayload(manifest, ['transitionId','terminalEventId','sourceFingerprint','sourceVersions'])
      && exactPayload(coverage, ['terminalEvent','eventHistory','dialogueEvidence','beliefs','socialEdges','sourceVersions'])
      && exactPayload(bytes, ['frozenContext','dossier'])
      && typeof manifest.transitionId === 'string' && typeof manifest.terminalEventId === 'string' && typeof manifest.sourceFingerprint === 'string'
      && /^[0-9a-f]{64}$/i.test(manifest.sourceFingerprint) && Array.isArray(manifest.sourceVersions)
      && Object.values(coverage).every((item) => typeof item === 'boolean' || (Number.isSafeInteger(item) && (item as number) >= 0))
      && Number.isSafeInteger(bytes.frozenContext) && (bytes.frozenContext as number) >= 0 && Number.isSafeInteger(bytes.dossier) && (bytes.dossier as number) >= 0;
  };
  const transitionPayload = (value: unknown, fields: string[]): value is Record<string, unknown> => {
    if (!exactPayload(value, fields) || !dossier((value as Record<string, unknown>).memoryDossier)) return false;
    const source = value as Record<string, unknown>;
    const memory = source.memoryDossier as Record<string, unknown>;
    const manifest = memory.manifest as Record<string, unknown>;
    // A dossier is evidence-bearing, not an independently chosen prompt view.
    // Compare its canonical transport representation before a provider call so
    // a proposer cannot be given different evidence than its critics.
    try {
      return JSON.stringify(memory.evidence) === JSON.stringify(source.frozenContext)
        && manifest.terminalEventId === (source.context as Record<string, unknown>).terminalEventId;
    } catch { return false; }
  };
  if (stage === 'quest_transition_proposer') {
    if (!transitionPayload(payload, ['context','frozenContext','memoryDossier'])) return null;
    return questTransitionFrozenContext(payload.frozenContext) ? questTransitionContext(payload.context) : null;
  }
  if (stage === 'quest_transition_critic' || stage === 'quest_transition_final_critic') {
    if (!transitionPayload(payload, ['context','frozenContext','memoryDossier','proposal']) || !questTransitionFrozenContext(payload.frozenContext)) return null;
    const context=questTransitionContext((payload as Record<string, unknown>).context);
    return context && parseQuestTransitionProposal((payload as Record<string, unknown>).proposal, context).ok ? context : null;
  }
  if (stage === 'quest_transition_repair') {
    if (!transitionPayload(payload, ['context','frozenContext','memoryDossier','proposal','instructions']) || !questTransitionFrozenContext(payload.frozenContext)) return null;
    const source=payload as Record<string, unknown>; const context=questTransitionContext(source.context);
    const repair=parseQuestTransitionCriticDecision({decision:'repair',instructions:source.instructions});
    return context && parseQuestTransitionProposal(source.proposal, context).ok && repair?.decision === 'repair' ? context : null;
  }
  return null;
}

export function createSettlementProvider(config: Record<string, string | undefined>): SettlementProvider {
  const provider = config.NPC_PROVIDER ?? 'openai';
  if (provider === 'local') return { async generate() { throw new SettlementProviderError('provider_unavailable', 'Local model support is not implemented.'); } };
  if (provider !== 'openai' || !config.OPENAI_API_KEY) return { async generate() { throw new SettlementProviderError('provider_unavailable', 'OpenAI is not configured.'); } };
  return { async generate(stage, payload, signal, prompt: PromptSnapshot): Promise<ProviderResult> {
    const started = performance.now();
    const model = creativeStages.has(stage) ? config.NPC_CHARACTER_MODEL ?? 'gpt-5.6-terra' : config.NPC_CONTEXT_MODEL ?? 'gpt-5.6-luna';
    if (!prompt || prompt.promptType !== 'text_system') throw new SettlementProviderError('provider_unavailable', 'The pinned settlement prompt is unavailable.');
    const socialContext=(socialProposalStages.has(stage) || socialCriticStages.has(stage)) ? parseSocialPayload(stage, payload) : null;
    if ((socialProposalStages.has(stage) || socialCriticStages.has(stage)) && !socialContext) {
      throw new SettlementProviderError('provider_malformed', 'The social encounter provider payload did not match the frozen contract.');
    }
    const proceduralContext=(proceduralProposalStages.has(stage) || proceduralCriticStages.has(stage)) ? parseProceduralPayload(stage, payload) : null;
    if ((proceduralProposalStages.has(stage) || proceduralCriticStages.has(stage)) && !proceduralContext) {
      throw new SettlementProviderError('provider_malformed', 'The procedural world provider payload did not match the frozen contract.');
    }
    const questTransitionContextValue=(questTransitionProposalStages.has(stage) || questTransitionCriticStages.has(stage)) ? parseQuestTransitionPayload(stage, payload) : null;
    if ((questTransitionProposalStages.has(stage) || questTransitionCriticStages.has(stage)) && !questTransitionContextValue) throw new SettlementProviderError('provider_malformed', 'The quest transition provider payload did not match the frozen contract.');
    let response: Response;
    try {
      response = await fetch('https://api.openai.com/v1/responses', { method:'POST', signal, headers:{Authorization:`Bearer ${config.OPENAI_API_KEY}`,'Content-Type':'application/json'}, body:JSON.stringify({
        model, store:false, max_output_tokens:2200, reasoning:{effort:creativeStages.has(stage) ? 'low' : 'none'},
        input:[{role:'system',content:prompt.body},{role:'user',content:JSON.stringify(payload)}],
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
        : proceduralProposalStages.has(stage)
          ? (() => {
            const parsed=parseProceduralWorldProposal(JSON.parse(structured?.proposalJson), proceduralContext!);
            return parsed.ok ? parsed.value : null;
          })()
        : questTransitionProposalStages.has(stage)
          ? (() => {
            const parsed=parseQuestTransitionProposal(JSON.parse(structured?.proposalJson), questTransitionContextValue!);
            return parsed.ok ? parsed.value : null;
          })()
        : socialCriticStages.has(stage)
            ? (() => {
              const decision=parseSocialEncounterCriticDecision(structured);
              return stage === 'social_encounter_final_critic' && decision?.decision === 'repair' ? null : decision;
            })()
        : proceduralCriticStages.has(stage)
          ? (() => {
            const decision=parseProceduralWorldCriticDecision(structured);
            return stage === 'procedural_world_final_critic' && decision?.decision === 'repair' ? null : decision;
          })()
        : questTransitionCriticStages.has(stage)
          ? (() => {
            const decision=parseQuestTransitionCriticDecision(structured);
            return stage === 'quest_transition_final_critic' && decision?.decision === 'repair' ? null : decision;
          })()
        : stage === 'proposer' || stage === 'repair'
          ? JSON.parse(structured?.proposalJson)
          : structured;
      if (value === null) throw new SettlementProviderError('provider_malformed', 'The provider output did not match the frozen world contract.');
      // Durable checkpoints retain their established semantic version. The
      // immutable release/revision provenance is recorded separately in the
      // registry ledger, so old replay readers remain compatible.
      return { value, model, usage:{input:result.usage?.input_tokens ?? 0, output:result.usage?.output_tokens ?? 0}, durationMs:Math.round(performance.now()-started), promptVersion:promptVersionForProviderStage(stage) };
    }
    catch { throw new SettlementProviderError('provider_malformed','The settlement provider returned malformed structured output.'); }
  } };
}
