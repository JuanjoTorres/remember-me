import type { ReactNode } from 'react';
import { Providers } from '@/features/shared/Providers';

export default function CreateLayout({ children }: { children: ReactNode }) {
  return (
    <Providers>
      <main className="mx-auto min-h-dvh max-w-md px-5 pt-6">{children}</main>
    </Providers>
  );
}
