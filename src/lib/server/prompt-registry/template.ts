import { createHash } from 'node:crypto';
import { PromptTemplateError, type PromptManifestEntry } from './contracts';

export const MAX_PROMPT_TEMPLATE_BYTES = 32 * 1024;
const VARIABLE = /{{([a-z][a-z0-9_]*)}}/g;

export function sha256Hex(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

export function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

export function templateVariables(body: string): string[] {
  return [...body.matchAll(VARIABLE)].map((match) => match[1]);
}

/** Validates a candidate without treating arbitrary braces as template syntax. */
export function validatePromptTemplate(entry: Pick<PromptManifestEntry, 'key' | 'templateVariables'>, body: string): void {
  if (utf8ByteLength(body) > MAX_PROMPT_TEMPLATE_BYTES) throw new PromptTemplateError('too_large', `${entry.key} exceeds the 32 KiB prompt body limit.`);
  const found = templateVariables(body);
  const permitted = new Set(entry.templateVariables);
  for (const variable of found) {
    if (!permitted.has(variable)) throw new PromptTemplateError('unknown_variable', `${entry.key} cannot use {{${variable}}}.`);
  }
  for (const variable of entry.templateVariables) {
    const count = found.filter((candidate) => candidate === variable).length;
    if (count === 0) throw new PromptTemplateError('missing_variable', `${entry.key} requires {{${variable}}}.`);
    if (count > 1) throw new PromptTemplateError('duplicate_required_variable', `${entry.key} may use {{${variable}}} exactly once.`);
  }
}

/** Strict render: callers must supply every and only the registered variable. */
export function renderPromptTemplate(entry: Pick<PromptManifestEntry, 'key' | 'templateVariables'>, body: string, values: Readonly<Record<string, string>>): string {
  validatePromptTemplate(entry, body);
  const expected = new Set(entry.templateVariables);
  for (const [key, value] of Object.entries(values)) {
    if (!expected.has(key) || typeof value !== 'string') throw new PromptTemplateError('invalid_value', `${entry.key} received an invalid template value.`);
  }
  for (const variable of entry.templateVariables) {
    if (!(variable in values)) throw new PromptTemplateError('missing_variable', `${entry.key} is missing {{${variable}}}.`);
  }
  return body.replace(VARIABLE, (_match, variable: string) => values[variable]);
}
