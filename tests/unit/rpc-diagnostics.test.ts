import { expect, it } from 'vitest';
import { assertRpcSuccess } from '../helpers/rpc-diagnostics';

it('preserves both RPC failures and redacts credentials in assertion output', () => {
  const secret = 'diagnostic-password-fixture';
  process.env.LOCAL_DIAGNOSTIC_PASSWORD = secret;
  try {
    let failure = '';
    try {
      assertRpcSuccess('create_tavern', [
        { status: 409, error: { code: '23505', message: `conflict ${secret}` } },
        { status: 401, error: { code: 'PGRST301', details: 'Bearer private-token', hint: 'retry' } }
      ]);
    } catch (error) {
      failure = (error as Error).message;
    }
    expect(failure).toContain('create_tavern call 1');
    expect(failure).toContain('23505');
    expect(failure).toContain('409');
    expect(failure).toContain('PGRST301');
    expect(failure).toContain('401');
    expect(failure).not.toContain(secret);
    expect(failure).not.toContain('private-token');
  } finally {
    delete process.env.LOCAL_DIAGNOSTIC_PASSWORD;
  }
});
