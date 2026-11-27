import { afterEach, describe, expect, it, vi } from 'vitest';
import { giftApi } from './api';

describe('giftApi', () => {
  afterEach(() => vi.unstubAllGlobals());

  const answering = () => {
    const fetchMock = vi.fn<(url: string, init: RequestInit) => Promise<Response>>(async () =>
      Response.json({}),
    );
    vi.stubGlobal('fetch', fetchMock);
    return () => fetchMock.mock.lastCall![1].headers as Record<string, string>;
  };

  it('sends the edit token and the grant of the last answer with every call', async () => {
    const headers = answering();
    let grant: string | undefined;
    const api = giftApi('gift-1', 'secret-token', () => grant);

    await api.get();
    expect(headers()).toMatchObject({ 'x-edit-token': 'secret-token' });
    expect(headers()).not.toHaveProperty('x-edit-session');

    grant = 'grant-of-the-first-answer';
    await api.update({ senderName: 'Tom' });
    expect(headers()).toMatchObject({
      'x-edit-token': 'secret-token',
      'x-edit-session': 'grant-of-the-first-answer',
    });
    grant = 'grant-of-the-second-answer';
    await api.get();
    expect(headers()).toMatchObject({ 'x-edit-session': 'grant-of-the-second-answer' });
  });
});
