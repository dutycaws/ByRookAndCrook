/** Replace only generated local values; preserve all unrelated lines verbatim. */
export function mergeEnvironment(existing: string, values: Record<string, string>): string {
  const remaining = new Map(Object.entries(values));
  const lines = existing.split('\n').filter((line) => {
    const key = line.match(/^(?:export\s+)?([A-Z_][A-Z_0-9]*)\s*=/)?.[1];
    return !key || !remaining.has(key);
  });
  while (lines.at(-1) === '') lines.pop();
  return [...lines, ...[...remaining].map(([key, value]) => `${key}=${JSON.stringify(value)}`), ''].join('\n');
}
