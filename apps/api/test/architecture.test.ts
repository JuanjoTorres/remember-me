import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const srcDir = resolve(dirname(fileURLToPath(import.meta.url)), '../src');
const modulesDir = join(srcDir, 'modules');
const EXPECTED_MODULES = ['gifts', 'media', 'payments', 'qr'];

function listFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    return statSync(path).isDirectory() ? listFiles(path) : path.endsWith('.ts') ? [path] : [];
  });
}

function importsOf(file: string): string[] {
  const source = readFileSync(file, 'utf8');
  const specifiers = [
    ...source.matchAll(/(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]/g),
    ...source.matchAll(/import\s*\(\s*['"]([^'"]+)['"]\s*\)/g),
    ...source.matchAll(/import\s*['"]([^'"]+)['"]/g),
  ];
  return specifiers.map((match) => match[1] as string);
}

/** Top-level folder under src/ that a relative import resolves to, e.g. "modules/gifts" or "shared". */
function areaOf(path: string): string {
  const parts = relative(srcDir, path).split(sep);
  return parts[0] === 'modules' ? `modules/${parts[1]}` : (parts[0] as string);
}

function violations(isForbidden: (fromArea: string, toArea: string) => boolean, roots: string[]) {
  return roots
    .flatMap(listFiles)
    .flatMap((file) =>
      importsOf(file)
        .filter((specifier) => specifier.startsWith('.'))
        .map((specifier) => ({ file, target: resolve(dirname(file), specifier) })),
    )
    .filter(({ file, target }) => isForbidden(areaOf(file), areaOf(target)))
    .map(({ file, target }) => `${relative(srcDir, file)} -> ${relative(srcDir, target)}`);
}

describe('backend architecture', () => {
  it('has exactly the agreed modules', () => {
    expect(readdirSync(modulesDir).sort()).toEqual(EXPECTED_MODULES);
  });

  it('modules never import from another module', () => {
    expect(
      violations(
        (from, to) => from.startsWith('modules/') && to.startsWith('modules/') && from !== to,
        [modulesDir],
      ),
    ).toEqual([]);
  });

  it('shared and config code never depend on a module', () => {
    expect(
      violations(
        (_from, to) => to.startsWith('modules/'),
        [join(srcDir, 'shared'), join(srcDir, 'config')],
      ),
    ).toEqual([]);
  });

  it('only payments talks to Stripe', () => {
    const offenders = listFiles(srcDir)
      .filter((file) => areaOf(file) !== 'modules/payments')
      .filter((file) => importsOf(file).some((s) => s === 'stripe' || s.startsWith('stripe/')));
    expect(offenders.map((file) => relative(srcDir, file))).toEqual([]);
  });
});
