import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';

/**
 * The QR route is the critical path on a recipient's phone. It must never pull in the editor,
 * the checkout flow or Stripe.
 */
const recipientPathRestrictions = {
  patterns: [
    {
      group: ['@/features/gift-creator', '@/features/gift-creator/**'],
      message: 'The recipient path must not import the gift editor.',
    },
    {
      group: ['@/features/checkout', '@/features/checkout/**'],
      message: 'The recipient path must not import the checkout flow.',
    },
    {
      group: ['stripe', 'stripe/**', '@stripe/**'],
      message: 'The recipient path must not import Stripe.',
    },
    {
      group: ['../**/gift-creator/**', '../**/checkout/**'],
      message: 'Use the @/features alias so that feature boundaries can be checked.',
    },
  ],
};

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    files: [
      'src/app/for/**/*.{ts,tsx}',
      'src/features/gift-experience/**/*.{ts,tsx}',
      'src/features/gift-reveal/**/*.{ts,tsx}',
    ],
    rules: { 'no-restricted-imports': ['error', recipientPathRestrictions] },
  },
  globalIgnores(['.next/**', 'out/**', 'build/**', 'next-env.d.ts', 'playwright-report/**']),
]);
