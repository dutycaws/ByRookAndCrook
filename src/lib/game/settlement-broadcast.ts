import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '$lib/database.types';
import { getSupabaseBrowserClient } from '$lib/supabase/browser';

export type SettlementBroadcastConnection = 'connecting' | 'connected' | 'reconnecting' | 'signed_out';

export interface SettlementBroadcastHandlers {
  onSettlementChanged(settlementId: string): void;
  onConnection(connection: SettlementBroadcastConnection): void;
}

export type SettlementBroadcastSource = (
  userId: string,
  handlers: SettlementBroadcastHandlers
) => () => void;

type SettlementRealtimeClient = SupabaseClient<Database>;

function readSettlementId(message: unknown): string | null {
  if (!message || typeof message !== 'object' || Array.isArray(message)) return null;
  const envelope = message as Record<string, unknown>;
  const payload = envelope.payload && typeof envelope.payload === 'object' && !Array.isArray(envelope.payload)
    ? envelope.payload as Record<string, unknown>
    : envelope;
  return typeof payload.settlementId === 'string' ? payload.settlementId : null;
}

/**
 * Subscribe to this authenticated owner's private settlement channel.
 * Supabase's browser client owns cookie refresh and pushes refreshed JWTs to
 * Realtime; this source only uses the token returned by getSession before the
 * first private-channel join.
 */
export function createSettlementBroadcastSource(
  client: SettlementRealtimeClient = getSupabaseBrowserClient()
): SettlementBroadcastSource {
  return (userId, handlers) => {
    let active = true;
    let channelGeneration = 0;
    let retryDelay = 1_000;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let requestedSession: Awaited<ReturnType<SettlementRealtimeClient['auth']['getSession']>>['data']['session'] = null;
    let joinTask: Promise<void> | null = null;
    let channel: ReturnType<SettlementRealtimeClient['channel']> | null = null;

    const clearRetry = () => {
      if (retryTimer !== undefined) clearTimeout(retryTimer);
      retryTimer = undefined;
    };

    const removeChannel = () => {
      channelGeneration += 1;
      const currentChannel = channel;
      channel = null;
      if (currentChannel) void client.removeChannel(currentChannel).catch(() => {});
    };

    const scheduleRetry = () => {
      if (!active || retryTimer !== undefined) return;
      handlers.onConnection('reconnecting');
      const delay = retryDelay;
      retryDelay = Math.min(retryDelay * 2, 30_000);
      retryTimer = setTimeout(() => {
        retryTimer = undefined;
        void readSessionAndJoin();
      }, delay);
    };

    const join = (session: NonNullable<typeof requestedSession>) => {
      if (!active || channel) return;
      requestedSession = session;
      const generation = ++channelGeneration;
      if (joinTask) return;
      handlers.onConnection('connecting');
      const connect = async () => {
        try {
          await client.realtime.setAuth(session.access_token);
          if (!active || generation !== channelGeneration || channel) return;

          const nextChannel = client
            .channel(`settlements:${userId}`, { config: { private: true } })
            .on('broadcast', { event: 'settlement_changed' }, (message) => {
              if (!active || generation !== channelGeneration || channel !== nextChannel) return;
              const settlementId = readSettlementId(message);
              if (settlementId) handlers.onSettlementChanged(settlementId);
            });
          channel = nextChannel;
          nextChannel.subscribe((status) => {
            if (!active || generation !== channelGeneration || channel !== nextChannel) return;
            if (status === 'SUBSCRIBED') {
              retryDelay = 1_000;
              clearRetry();
              handlers.onConnection('connected');
            } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
              // Realtime retries these joined channels itself and reports a new
              // SUBSCRIBED status after a successful reconnect.
              handlers.onConnection('reconnecting');
            } else if (status === 'CLOSED') {
              removeChannel();
              scheduleRetry();
            }
          });
        } catch {
          if (active && generation === channelGeneration) {
            const failedChannel = channel;
            channel = null;
            if (failedChannel) void client.removeChannel(failedChannel).catch(() => {});
            scheduleRetry();
          }
        }
      };
      joinTask = connect().finally(() => {
        joinTask = null;
        if (active && !channel && requestedSession && generation !== channelGeneration) {
          join(requestedSession);
        }
      });
    };

    const readSessionAndJoin = async () => {
      if (!active || channel || joinTask) return;
      try {
        const { data, error } = await client.auth.getSession();
        if (!active) return;
        if (error) {
          scheduleRetry();
        } else if (!data.session || data.session.user.id !== userId) {
          requestedSession = null;
          handlers.onConnection('signed_out');
        } else {
          join(data.session);
        }
      } catch {
        if (active) scheduleRetry();
      }
    };

    const authSubscription = client.auth.onAuthStateChange((event, session) => {
      // Do not call or await Supabase auth methods inside this callback; it runs
      // under the auth client's lock. SupabaseClient updates Realtime's JWT itself.
      queueMicrotask(() => {
        if (!active) return;
        if (!session || session.user.id !== userId) {
          requestedSession = null;
          removeChannel();
          clearRetry();
          handlers.onConnection('signed_out');
          return;
        }
        if (event === 'INITIAL_SESSION' || event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') {
          if (channel) {
            void client.realtime.setAuth(session.access_token).catch(() => {
              if (active) {
                removeChannel();
                scheduleRetry();
              }
            });
          } else {
            join(session);
          }
        }
      });
    }).data.subscription;

    handlers.onConnection('connecting');
    void readSessionAndJoin();

    return () => {
      active = false;
      requestedSession = null;
      clearRetry();
      authSubscription.unsubscribe();
      removeChannel();
    };
  };
}

export const subscribeToSettlementBroadcast: SettlementBroadcastSource = (userId, handlers) =>
  createSettlementBroadcastSource()(userId, handlers);
