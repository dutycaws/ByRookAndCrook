export const RELATIONSHIP_STAGE_BANDS = [
  { stage: 'strained', minimum: 0, maximum: 24 },
  { stage: 'acquaintance', minimum: 25, maximum: 49 },
  { stage: 'familiar', minimum: 50, maximum: 64 },
  { stage: 'trusted', minimum: 65, maximum: 79 },
  { stage: 'close', minimum: 80, maximum: 100 }
] as const;

export type RelationshipStage = (typeof RELATIONSHIP_STAGE_BANDS)[number]['stage'];

function normalizeMessage(message: string): string {
  return message
    .normalize('NFKC')
    .toLocaleLowerCase('en-US')
    .replace(/[’']/gu, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/gu, ' ');
}

const APOLOGY_ONLY = new Set([
  'sorry',
  'im sorry',
  'i am sorry',
  'i apologize',
  'i apologise',
  'please forgive me',
  'my bad',
  'i regret it'
]);

const EMPTY_SOCIAL_TURNS = new Set([
  ...APOLOGY_ONLY,
  'hi',
  'hello',
  'hey',
  'good morning',
  'good afternoon',
  'good evening',
  'how are you',
  'nice to see you',
  'you are great',
  'youre great',
  'you are wonderful',
  'youre wonderful',
  'you are amazing',
  'youre amazing',
  'you are kind',
  'youre kind',
  'you are the best',
  'youre the best',
  'i like you',
  'i love you'
]);

const APOLOGY_LANGUAGE = /\b(?:sorry|apolog(?:ize|ise)|forgive me|my bad|regret)\b/u;
const GENERIC_PRAISE = /\b(?:you are|youre|you were)\b.*\b(?:great|wonderful|amazing|kind|the best)\b/u;
const FOLLOW_THROUGH_ACTION = /\b(?:brought|built|carried|checked|covered|delivered|escorted|finished|fixed|found|guarded|helped|kept|listened|looked|made|paid|planted|posted|prepared|repaired|returned|restored|saved|set|showed|stayed|supported|tended|took|visited|waited|walked|watered|watched|worked)\w*\b/u;

function containsOnlyApologyOrPraise(normalized: string): boolean {
  if (EMPTY_SOCIAL_TURNS.has(normalized)) return true;
  if (FOLLOW_THROUGH_ACTION.test(normalized)) return false;
  return APOLOGY_LANGUAGE.test(normalized) || GENERIC_PRAISE.test(normalized);
}

/** Maps the internal score to the only relationship value intended for players. */
export function relationshipStageFor(score: number): RelationshipStage {
  if (!Number.isFinite(score)) return 'strained';
  const bounded = Math.max(0, Math.min(100, Math.trunc(score)));
  return RELATIONSHIP_STAGE_BANDS.find(({ minimum, maximum }) => bounded >= minimum && bounded <= maximum)!.stage;
}

/** Apologies can be acknowledged, but never qualify as relationship repair on their own. */
export function isApologyOnlyMessage(message: string): boolean {
  return containsOnlyApologyOrPraise(normalizeMessage(message)) && APOLOGY_LANGUAGE.test(normalizeMessage(message));
}

/** Empty greetings and generic praise are not meaningful relationship events. */
export function isEmptySocialTurn(message: string): boolean {
  return containsOnlyApologyOrPraise(normalizeMessage(message));
}
