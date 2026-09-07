import { expect } from 'vitest';

type RpcResponse = {
  status: number;
  error: { code?: string | null; message?: string | null; details?: string | null; hint?: string | null } | null;
};

// Only emit bounded error fields; never serialize a client, session, or response data.
function sanitize(value: string | null | undefined): string | null {
  if (value == null) return null;
  let safe = value;
  for (const [key, secret] of Object.entries(process.env)) {
    if (/password|token|secret|key/i.test(key) && secret && secret.length >= 6) {
      safe = safe.split(secret).join('[REDACTED]');
    }
  }
  return safe
    .replace(/Bearer\s+\S+/gi, 'Bearer [REDACTED]')
    .replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '[REDACTED]')
    .replace(/sb_(?:secret|publishable)_[A-Za-z0-9_-]+/g, '[REDACTED]')
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[REDACTED EMAIL]')
    .slice(0, 2000);
}

export function assertRpcSuccess(rpc: string, responses: readonly RpcResponse[]): void {
  const summaries = responses.map(({ status, error }, index) => ({
    call: index + 1,
    status,
    code: sanitize(error?.code),
    message: sanitize(error?.message),
    details: sanitize(error?.details),
    hint: sanitize(error?.hint)
  }));
  // Include the whole batch in every assertion so the first failure preserves its peers.
  const diagnostic = `${rpc}: ${JSON.stringify(summaries)}`;
  responses.forEach(({ error }, index) => {
    expect(error === null, `${rpc} call ${index + 1}; ${diagnostic}`).toBe(true);
  });
}
