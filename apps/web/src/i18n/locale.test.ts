import { describe, expect, it } from 'vitest';
import { resolveLocale } from './locale';

describe('resolveLocale', () => {
  it('prefers the cookie', () => {
    expect(resolveLocale('es', 'en-US,en;q=0.9')).toBe('es');
  });

  it('follows the Accept-Language weights', () => {
    expect(resolveLocale(undefined, 'fr-FR,fr;q=0.9,es-ES;q=0.8,en;q=0.7')).toBe('es');
    expect(resolveLocale(undefined, 'en;q=0.5,es;q=0.9')).toBe('es');
  });

  it('ignores an unsupported cookie and falls back to English', () => {
    expect(resolveLocale('de', 'de-DE,de;q=0.9')).toBe('en');
    expect(resolveLocale(undefined, null)).toBe('en');
  });
});
