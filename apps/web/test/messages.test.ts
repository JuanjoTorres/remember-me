import { describe, expect, it } from 'vitest';
import en from '../messages/en.json';
import es from '../messages/es.json';

function keysOf(value: unknown, prefix = ''): string[] {
  if (typeof value !== 'object' || value === null) return [prefix];
  return Object.entries(value).flatMap(([key, child]) =>
    keysOf(child, prefix ? `${prefix}.${key}` : key),
  );
}

describe('translations', () => {
  it('has the same keys in English and Spanish', () => {
    expect(keysOf(es).sort()).toEqual(keysOf(en).sort());
  });

  it('uses the same placeholders in both languages', () => {
    const placeholders = (text: string) =>
      [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();
    const flat = (value: unknown, prefix = ''): [string, string][] =>
      typeof value === 'string'
        ? [[prefix, value]]
        : Object.entries(value as object).flatMap(([key, child]) =>
            flat(child, `${prefix}.${key}`),
          );
    const spanish = new Map(flat(es));
    for (const [key, text] of flat(en)) {
      expect(placeholders(spanish.get(key) ?? ''), key).toEqual(placeholders(text));
    }
  });
});
