// @vitest-environment node
import path from 'node:path';
import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

const eslint = new ESLint({ cwd: path.join(import.meta.dirname, '..') });

async function restrictedImports(filePath: string, code: string): Promise<string[]> {
  const [result] = await eslint.lintText(code, { filePath });
  return (result?.messages ?? [])
    .filter((message) => message.ruleId === 'no-restricted-imports')
    .map((message) => message.message);
}

const RECIPIENT_FILES = [
  'src/app/for/[slug]/page.tsx',
  'src/features/gift-experience/Stories.tsx',
  'src/features/gift-reveal/ScratchCard.tsx',
];

describe('recipient path boundaries (lint rule)', () => {
  it.each(RECIPIENT_FILES)('%s cannot import the editor, the checkout or Stripe', async (file) => {
    for (const source of [
      '@/features/gift-creator',
      '@/features/gift-creator/components/CardEditor',
      '@/features/checkout/PremiumUpgradeSheet',
      '@stripe/stripe-js',
      'stripe',
    ]) {
      const messages = await restrictedImports(
        file,
        `import x from '${source}';\nexport default x;\n`,
      );
      expect(messages, `${file} importing ${source}`).toHaveLength(1);
    }
  });

  it('lets the recipient path use its own features and shared code', async () => {
    const code = `import a from '@/features/gift-reveal/Reveal';\nimport b from '@/features/shared/api';\nexport default [a, b];\n`;
    expect(await restrictedImports('src/app/for/[slug]/page.tsx', code)).toEqual([]);
  });

  it('does not restrict the editor', async () => {
    const code = `import a from '@/features/checkout/PremiumUpgradeSheet';\nexport default a;\n`;
    expect(await restrictedImports('src/features/gift-creator/Editor.tsx', code)).toEqual([]);
  });
});
