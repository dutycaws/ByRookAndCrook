import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '$lib/database.types';
import { createSettlementBroadcastSource } from '$lib/game/settlement-broadcast';

const userId = '11111111-1111-4111-8111-111111111111';
const settlementId = '22222222-2222-4222-8222-222222222222';
type FakeSession = { access_token: string; user: { id: string } };
const testSession: FakeSession = { access_token: 'user-access-token', user: { id: userId } };

type AuthListener = (event: string, session: FakeSession | null) => void;

interface FakeChannel {
  topic: string;
  config: unknown;
  emitBroadcast(message: unknown): void;
  emitStatus(status: string): void;
  on: ReturnType<typeof vi.fn>;
  subscribe: ReturnType<typeof vi.fn>;
}

function flushMicrotasks() {
  return Promise.resolve().then(() => Promise.resolve()).then(() => Promise.resolve());
}

function fakeClient(getSession: () => Promise<unknown> = async () => ({ data: { session: testSession }, error: null })) {
  let authListener: AuthListener | null = null;
  const authUnsubscribe = vi.fn();
  const channels: FakeChannel[] = [];
  const channel = vi.fn((topic: string, config: unknown) => {
    let broadcast: ((message: unknown) => void) | undefined;
    let status: ((status: string) => void) | undefined;
    const fake: FakeChannel = {
      topic,
      config,
      emitBroadcast: (message) => broadcast?.(message),
      emitStatus: (next) => status?.(next),
      on: vi.fn((_kind: string, _filter: unknown, listener: (message: unknown) => void) => {
        broadcast = listener;
        return fake;
      }),
      subscribe: vi.fn((listener: (status: string) => void) => {
        status = listener;
        return fake;
      })
    };
    channels.push(fake);
    return fake;
  });
  const removeChannel = vi.fn(async () => 'ok');
  const setAuth = vi.fn(async () => {});
  const client = {
    auth: {
      getSession: vi.fn(getSession),
      onAuthStateChange: vi.fn((listener: AuthListener) => {
        authListener = listener;
        return { data: { subscription: { unsubscribe: authUnsubscribe } } };
      })
    },
    realtime: { setAuth },
    channel,
    removeChannel
  } as unknown as SupabaseClient<Database>;
  return {
    client,
    channels,
    channel,
    removeChannel,
    setAuth,
    authUnsubscribe,
    emitAuth: (event: string, nextSession: FakeSession | null) => authListener?.(event, nextSession)
  };
}

afterEach(() => vi.useRealTimers());

describe('settlement private Broadcast source', () => {
  it('joins the verified owner topic, reads settlement_changed payloads, and cleans up auth/channel listeners', async () => {
    const fake = fakeClient();
    const onSettlementChanged = vi.fn();
    const onConnection = vi.fn();
    const stop = createSettlementBroadcastSource(fake.client)(userId, { onSettlementChanged, onConnection });
    await flushMicrotasks();

    expect(fake.channel).toHaveBeenCalledWith(`settlements:${userId}`, { config: { private: true } });
    expect(fake.setAuth).toHaveBeenCalledWith('user-access-token');
    expect(fake.channels).toHaveLength(1);
    expect(fake.channels[0].on).toHaveBeenCalledWith('broadcast', { event: 'settlement_changed' }, expect.any(Function));

    fake.channels[0].emitBroadcast({ payload: { id: 'transport-message-id', settlementId } });
    fake.channels[0].emitBroadcast({ payload: { id: 'transport-message-id' } });
    expect(onSettlementChanged).toHaveBeenCalledTimes(1);
    expect(onSettlementChanged).toHaveBeenCalledWith(settlementId);

    fake.channels[0].emitStatus('SUBSCRIBED');
    fake.channels[0].emitStatus('CHANNEL_ERROR');
    expect(onConnection).toHaveBeenCalledWith('connected');
    expect(onConnection).toHaveBeenCalledWith('reconnecting');

    fake.emitAuth('SIGNED_OUT', null);
    await flushMicrotasks();
    expect(fake.removeChannel).toHaveBeenCalledTimes(1);
    expect(onConnection).toHaveBeenCalledWith('signed_out');
    stop();
    expect(fake.authUnsubscribe).toHaveBeenCalledTimes(1);
  });

  it('retries a failed initial auth read and a permanently closed channel with backoff', async () => {
    vi.useFakeTimers();
    const getSession = vi.fn()
      .mockResolvedValueOnce({ data: { session: null }, error: new Error('temporary auth outage') })
      .mockResolvedValue({ data: { session: testSession }, error: null });
    const fake = fakeClient(getSession);
    const onConnection = vi.fn();
    const stop = createSettlementBroadcastSource(fake.client)(userId, {
      onSettlementChanged: vi.fn(),
      onConnection
    });
    await flushMicrotasks();
    expect(fake.channel).not.toHaveBeenCalled();
    expect(onConnection).toHaveBeenCalledWith('reconnecting');

    await vi.advanceTimersByTimeAsync(1_000);
    await flushMicrotasks();
    expect(fake.channel).toHaveBeenCalledTimes(1);
    fake.channels[0].emitStatus('SUBSCRIBED');
    fake.channels[0].emitStatus('CHANNEL_ERROR');
    fake.channels[0].emitStatus('TIMED_OUT');
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fake.channel).toHaveBeenCalledTimes(1);

    fake.channels[0].emitStatus('CLOSED');
    await vi.advanceTimersByTimeAsync(1_000);
    await flushMicrotasks();
    expect(fake.channel).toHaveBeenCalledTimes(2);
    stop();
  });

  it('waits for the matching signed-in session after startup without joining another owner topic', async () => {
    vi.useFakeTimers();
    const fake = fakeClient(async () => ({ data: { session: null }, error: null }));
    const onConnection = vi.fn();
    const stop = createSettlementBroadcastSource(fake.client)(userId, {
      onSettlementChanged: vi.fn(),
      onConnection
    });
    await flushMicrotasks();
    expect(fake.channel).not.toHaveBeenCalled();
    expect(onConnection).toHaveBeenCalledWith('signed_out');

    fake.emitAuth('SIGNED_IN', { ...testSession, user: { id: 'another-user' } });
    await flushMicrotasks();
    expect(fake.channel).not.toHaveBeenCalled();
    fake.emitAuth('SIGNED_IN', testSession);
    await flushMicrotasks();
    expect(fake.channel).toHaveBeenCalledWith(`settlements:${userId}`, { config: { private: true } });
    stop();
  });
});
