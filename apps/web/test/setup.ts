import '@testing-library/jest-dom/vitest';
import { cleanup, configure } from '@testing-library/react';
import { afterEach } from 'vitest';

// `findBy…` and `waitFor` give up after 1 s by default, which a busy CI runner has exceeded. Waiting
// longer only delays a real failure; it never turns one into a pass.
configure({ asyncUtilTimeout: 5_000 });

afterEach(() => cleanup());
