export const SETTLEMENT_USER_ID_CONTEXT = Symbol('settlement-user-id');

/** A getter keeps a child interlude in sync if the authenticated layout data changes. */
export type SettlementUserIdReader = () => string | null;
