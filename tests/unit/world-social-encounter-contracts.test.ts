import { describe, expect, it } from 'vitest';
import {
  canonicalizeSocialEncounterProposal,
  parseFrozenSocialEncounterContext,
  parsePublicSocialEncounterSummary,
  parseSocialEncounterCriticDecision,
  parseSocialEncounterProposal,
  toPublicSocialEncounterSummary
} from '../../src/lib/game/evolving-world';
import {
  SOCIAL_ENCOUNTER_CHECKPOINT_STAGE,
  SOCIAL_ENCOUNTER_SETTLEMENT_PROMPT_VERSION,
  SETTLEMENT_PROVIDER_CALL_BUDGETS,
  checkpointStageForProviderStage,
  promptVersionForProviderStage
} from '../../src/lib/server/evolving-world/settlement-contracts';

const liraResident='11111111-1111-4111-8111-111111111111';
const torvinResident='22222222-2222-4222-8222-222222222222';
const liraNpc='33333333-3333-4333-8333-333333333333';
const torvinNpc='44444444-4444-4444-8444-444444444444';
const beliefId='55555555-5555-4555-8555-555555555555';
const claim='a'.repeat(64);

function capability(...socialCapabilities: string[]) {
  return { version:'capabilities-v1',allowedActions:[],allowedApproaches:[],allowedWorldEffects:[],allowedTargetKinds:[],socialCapabilities,irreversibleEffects:[] };
}
function resident(residentId: string, npcId: string, socialCapabilities: string[], beliefs: unknown[] = []) {
  return {
    residentId,npcId,profileRevision:1,profile:{dimensions:{},entries:[]},beliefs,edges:[{
      subjectNpcId:npcId,objectEntityId:npcId === liraNpc ? torvinNpc : liraNpc,
      axes:{trust:0,affection:0,respect:0,fear:0,obligation:0}
    }],capability:capability(...socialCapabilities)
  };
}
function frozenRaw() {
  const liraBelief={id:beliefId,subjectEntityId:torvinNpc,content:'Torvin saw smoke near the pass.',confidence:67,
    provenance:[{sourceKind:'direct_evidence',sourceId:'evidence-smoke'}],originalClaimFingerprint:claim,contradictionStatus:'uncontested',state:'active'};
  return {version:'social-encounter-v1',templateKey:'road-rumor',participantResidentIds:[liraResident,torvinResident],publicCanon:{
    currentDay:4,entityKinds:{[liraNpc]:'npc',[torvinNpc]:'npc'}
  },authorizedEvidence:[{id:'evidence-smoke',kind:'world_event',sourceFingerprint:claim,summary:'Smoke rose by the northern pass.'}],participants:[resident(liraResident,liraNpc,['conceal','share_gossip'],[liraBelief]),resident(torvinResident,torvinNpc,['misdirect'])]};
}
function proposalRaw() {
  return {version:'social-encounter-v1',templateKey:'road-rumor',participantResidentIds:[liraResident,torvinResident],
    privateCommunicativeIntents:[{speakerResidentId:liraResident,recipientResidentId:torvinResident,mode:'withhold',message:'Do not mention the smoke to the keeper yet.'}],
    privateExchangeSummary:'Lira quietly warns Torvin to keep their smoke report close.',evidenceIds:['evidence-smoke'],causalExplanation:'The encounter relies on the frozen smoke report and Lira’s attributed recollection.',
    relationshipEffects:[{recipientResidentId:torvinResident,sourceResidentId:liraResident,axis:'trust',delta:2}],
    gossipBeliefAdditions:[{recipientResidentId:torvinResident,sourceResidentId:liraResident,sourceBeliefId:beliefId,sourceEvidenceId:'evidence-smoke',originalClaimFingerprint:claim,content:'Torvin saw smoke near the pass.',confidence:56,provenance:[{sourceKind:'direct_evidence',sourceId:'evidence-smoke'},{sourceKind:'gossip',sourceId:beliefId,speakerNpcId:liraNpc}]}],
    publicSummary:'Lira and Torvin quietly compared reports from the northern road.'};
}
function frozen() {
  const value=parseFrozenSocialEncounterContext(frozenRaw());
  if (!value) throw new Error('fixture must parse');
  return value;
}

describe('social encounter contracts', () => {
  it('freezes the namespaced social call envelope without adding a digest stage', () => {
    expect(SOCIAL_ENCOUNTER_CHECKPOINT_STAGE).toEqual({social_encounter_proposer:'proposer',social_encounter_critic:'critic',social_encounter_repair:'repair',social_encounter_final_critic:'final_critic'});
    expect(SETTLEMENT_PROVIDER_CALL_BUDGETS.social_encounter).toEqual({maximum:4,ordinary:2,stages:['social_encounter_proposer','social_encounter_critic','social_encounter_repair','social_encounter_final_critic']});
    expect(checkpointStageForProviderStage('social_encounter_repair')).toBe('repair');
    expect(promptVersionForProviderStage('social_encounter_proposer')).toBe(SOCIAL_ENCOUNTER_SETTLEMENT_PROMPT_VERSION);
  });

  it('parses only bounded critic repair instructions against closed proposal paths', () => {
    expect(parseSocialEncounterCriticDecision({decision:'accept',instructions:[]})).toEqual({decision:'accept',instructions:[]});
    expect(parseSocialEncounterCriticDecision({decision:'reject',instructions:[{code:'public_projection',path:'publicSummary'}]})).toBeNull();
    expect(parseSocialEncounterCriticDecision({decision:'repair',instructions:[
      {code:'gossip_attribution',path:'gossipBeliefAdditions'},
      {code:'intent_capability',path:'privateCommunicativeIntents'}
    ]})).toEqual({decision:'repair',instructions:[
      {code:'gossip_attribution',path:'gossipBeliefAdditions'},
      {code:'intent_capability',path:'privateCommunicativeIntents'}
    ]});
    expect(parseSocialEncounterCriticDecision({decision:'repair',instructions:[]})).toBeNull();
    expect(parseSocialEncounterCriticDecision({decision:'repair',instructions:[{code:'invented_fact',path:'publicSummary'}]})).toBeNull();
    expect(parseSocialEncounterCriticDecision({decision:'repair',instructions:[{code:'public_projection',path:'templateKey'}]})).toBeNull();
    expect(parseSocialEncounterCriticDecision({decision:'repair',instructions:[{code:'public_projection',path:'publicSummary'},{code:'public_projection',path:'publicSummary'}]})).toBeNull();
  });

  it('keeps public canon and both private resident planes frozen and separate', () => {
    const parsed=frozen();
    expect(parsed.authorizedEvidence).toHaveLength(1);
    expect(parsed.participants[0].beliefs[0].content).toContain('smoke');
    expect(parseFrozenSocialEncounterContext({...frozenRaw(),participants:[...frozenRaw().participants].reverse()})).toBeNull();
    expect(parseFrozenSocialEncounterContext({...frozenRaw(),publicCanon:{...frozenRaw().publicCanon,privateBeliefs:[]}})).toBeNull();
    expect(parseFrozenSocialEncounterContext({...frozenRaw(),authorizedEvidence:[]})).toBeNull();
    expect(parseFrozenSocialEncounterContext({...frozenRaw(),participantResidentIds:[liraResident,liraResident]})).toBeNull();
  });

  it('accepts bounded directed gossip and relationship effects while stripping private intent from public output', () => {
    const parsed=parseSocialEncounterProposal(proposalRaw(), frozen());
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.relationshipEffects[0]).toMatchObject({recipientResidentId:torvinResident,sourceResidentId:liraResident});
    const publicSummary=toPublicSocialEncounterSummary(parsed.value);
    expect(publicSummary).toEqual({version:'social-encounter-v1',templateKey:'road-rumor',participantResidentIds:[liraResident,torvinResident],publicSummary:proposalRaw().publicSummary});
    expect(JSON.stringify(publicSummary)).not.toContain('withhold');
    expect(JSON.stringify(publicSummary)).not.toContain('gossipBelief');
    expect(parsePublicSocialEncounterSummary({...publicSummary!,privateCommunicativeIntents:[]})).toMatchObject({ok:false});
    const privateOnly=proposalRaw(); (privateOnly as { publicSummary: string | null }).publicSummary=null;
    const privateParsed=parseSocialEncounterProposal(privateOnly, frozen());
    expect(privateParsed.ok && toPublicSocialEncounterSummary(privateParsed.value)).toBeNull();
  });

  it('enforces intent capability gates and recipient-directed effects', () => {
    const withoutConceal=frozenRaw();
    withoutConceal.participants[0]=(resident(liraResident,liraNpc,['share_gossip'], withoutConceal.participants[0].beliefs) as typeof withoutConceal.participants[number]);
    expect(parseSocialEncounterProposal(proposalRaw(), parseFrozenSocialEncounterContext(withoutConceal)!)).toMatchObject({ok:false});
    const selfDirected=proposalRaw();
    selfDirected.relationshipEffects[0]={...selfDirected.relationshipEffects[0],sourceResidentId:torvinResident,recipientResidentId:torvinResident};
    expect(parseSocialEncounterProposal(selfDirected, frozen())).toMatchObject({ok:false});
    const fabricate=proposalRaw();
    fabricate.privateCommunicativeIntents[0]={...fabricate.privateCommunicativeIntents[0],mode:'fabricate'};
    expect(parseSocialEncounterProposal(fabricate, frozen())).toMatchObject({ok:false});
  });

  it('requires attributed frozen gossip sources and rejects canon or mutation-shaped extras', () => {
    const missingSource=proposalRaw();
    missingSource.gossipBeliefAdditions[0]={...missingSource.gossipBeliefAdditions[0],originalClaimFingerprint:'b'.repeat(64)};
    expect(parseSocialEncounterProposal(missingSource, frozen())).toMatchObject({ok:false});
    const alteredContent=proposalRaw(); alteredContent.gossipBeliefAdditions[0]={...alteredContent.gossipBeliefAdditions[0],content:'Torvin saw smoke near the pass!'};
    expect(parseSocialEncounterProposal(alteredContent, frozen())).toMatchObject({ok:false});
    const wrongEvidence=proposalRaw();
    wrongEvidence.gossipBeliefAdditions[0]={...wrongEvidence.gossipBeliefAdditions[0],sourceEvidenceId:'missing'};
    expect(parseSocialEncounterProposal(wrongEvidence, frozen())).toMatchObject({ok:false});
    expect(parseSocialEncounterProposal({...proposalRaw(),worldEffects:[]}, frozen())).toMatchObject({ok:false});
    expect(parseSocialEncounterProposal({...proposalRaw(),questChanges:[]}, frozen())).toMatchObject({ok:false});
    expect(parseSocialEncounterProposal({...proposalRaw(),inventoryTransfer:{}}, frozen())).toMatchObject({ok:false});
    expect(parseSocialEncounterProposal({...proposalRaw(),evidenceIds:[]}, frozen())).toMatchObject({ok:false});
    expect(parseSocialEncounterProposal({...proposalRaw(),causalExplanation:''}, frozen())).toMatchObject({ok:false});
    const shortenedChain=proposalRaw(); shortenedChain.gossipBeliefAdditions[0].provenance=[{sourceKind:'gossip',sourceId:beliefId,speakerNpcId:liraNpc}];
    expect(parseSocialEncounterProposal(shortenedChain, frozen())).toMatchObject({ok:false});
  });

  it('normalizes equivalent valid proposals into one stable fingerprint-ready canonical value', () => {
    const first=canonicalizeSocialEncounterProposal(proposalRaw(), frozen());
    const reordered={publicSummary:proposalRaw().publicSummary,gossipBeliefAdditions:proposalRaw().gossipBeliefAdditions,relationshipEffects:proposalRaw().relationshipEffects,
      causalExplanation:proposalRaw().causalExplanation,evidenceIds:proposalRaw().evidenceIds,privateExchangeSummary:proposalRaw().privateExchangeSummary,
      privateCommunicativeIntents:proposalRaw().privateCommunicativeIntents,participantResidentIds:proposalRaw().participantResidentIds,templateKey:'road-rumor',version:'social-encounter-v1'};
    expect(canonicalizeSocialEncounterProposal(reordered, frozen())).toBe(first);
  });
});
