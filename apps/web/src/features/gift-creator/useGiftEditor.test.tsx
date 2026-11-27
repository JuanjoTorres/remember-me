import type { GiftEditorView } from '@remember-me/shared-types';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { giftView } from '../../../test/render';
import { useGiftEditor } from './useGiftEditor';

describe('useGiftEditor', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('sends the grant of the last answer back with every call, so that its session goes on', async () => {
    // The server answers every call with a new grant.
    let answers = 0;
    const fetchMock = vi.fn<(url: string, init: RequestInit) => Promise<Response>>(async () => {
      answers += 1;
      return Response.json(giftView({ grant: `grant-${answers}` }));
    });
    vi.stubGlobal('fetch', fetchMock);
    const sessionOf = (call: number) =>
      (fetchMock.mock.calls[call]![1].headers as Record<string, string>)['x-edit-session'];

    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = renderHook(() => useGiftEditor(giftView().id, 'secret-token'), {
      wrapper: ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      ),
    });
    await waitFor(() => expect(result.current.gift?.grant).toBe('grant-1'));
    expect(sessionOf(0)).toBeUndefined();

    const save = (senderName: string): Promise<GiftEditorView | null> =>
      act(() => result.current.run((api) => api.update({ senderName })));
    await save('Tom');
    expect(sessionOf(1)).toBe('grant-1');
    await save('Tomas');
    expect(sessionOf(2)).toBe('grant-2');
    // A reload of the gift carries the session on as well.
    await act(() => result.current.api.get());
    expect(sessionOf(3)).toBe('grant-3');
  });
});
