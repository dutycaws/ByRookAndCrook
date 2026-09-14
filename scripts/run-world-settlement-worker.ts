import { drainWorldSettlementQueue } from '../src/lib/server/evolving-world/settlement-worker';

const outcomes = await drainWorldSettlementQueue(4);
console.log(JSON.stringify({ processed: outcomes.length, outcomes }, null, 2));
