import { describe, expect, it } from 'vitest';
import { ensureLocalPilotUsers } from '../../scripts/local-pilot-users.js';

describe('local pilot user fixture', () => {
  it('keeps matching confirmed pilot identities untouched on an idempotent rerun', async () => {
    const updates: unknown[] = [];
    const created: unknown[] = [];
    const result = await ensureLocalPilotUsers(
      {
        auth: {
          admin: {
            async listUsers() {
              return {
                data: { users: [{ id: 'keeper-one-id', email: 'keeper.one@example.test', email_confirmed_at: '2026-09-13T00:00:00.000Z' }] },
                error: null
              };
            },
            async updateUserById(...args: unknown[]) { updates.push(args); return { data: { user: null }, error: null }; },
            async createUser(input: unknown) { created.push(input); return { data: { user: { id: 'keeper-two-id' } }, error: null }; }
          }
        }
      },
      [
        { email: 'keeper.one@example.test', password: 'first-password' },
        { email: 'keeper.two@example.test', password: 'second-password' }
      ]
    );

    expect(updates).toEqual([]);
    expect(created).toEqual([{ email: 'keeper.two@example.test', password: 'second-password', email_confirm: true }]);
    expect(result.ids).toEqual(new Map([
      ['keeper.one@example.test', 'keeper-one-id'],
      ['keeper.two@example.test', 'keeper-two-id']
    ]));
    expect(result.created).toEqual(['keeper.two@example.test']);
  });

  it('confirms an older unconfirmed account without resetting its password', async () => {
    const updates: unknown[] = [];
    await ensureLocalPilotUsers(
      {
        auth: {
          admin: {
            async listUsers() {
              return { data: { users: [{ id: 'unconfirmed-id', email: 'keeper.one@example.test', email_confirmed_at: null }] }, error: null };
            },
            async updateUserById(...args: unknown[]) {
              updates.push(args);
              return { data: { user: { id: 'unconfirmed-id' } }, error: null };
            },
            async createUser() { return { data: { user: null }, error: new Error('not expected') }; }
          }
        }
      },
      [{ email: 'keeper.one@example.test', password: 'do-not-send-this' }]
    );

    expect(updates).toEqual([['unconfirmed-id', { email_confirm: true }]]);
  });
});
