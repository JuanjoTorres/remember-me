import type { GiftEditorView } from '@remember-me/shared-types';
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useGiftPaymentStatus } from './useGiftPaymentStatus';

const gift = (plan: 'FREE' | 'PREMIUM') => ({ id: 'gift-1', plan }) as GiftEditorView;

describe('useGiftPaymentStatus', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('polls until the webhook has made the gift premium', async () => {
    const loadGift = vi
      .fn<() => Promise<GiftEditorView>>()
      .mockResolvedValueOnce(gift('FREE'))
      .mockResolvedValueOnce(gift('FREE'))
      .mockResolvedValue(gift('PREMIUM'));
    const { result } = renderHook(() => useGiftPaymentStatus(loadGift, { intervalMs: 1000 }));

    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(result.current.status).toBe('waiting');
    await act(() => vi.advanceTimersByTimeAsync(1000));
    expect(result.current.status).toBe('waiting');
    await act(() => vi.advanceTimersByTimeAsync(1000));
    expect(result.current).toMatchObject({ status: 'confirmed', gift: { plan: 'PREMIUM' } });

    // Confirmed is final: no more requests.
    await act(() => vi.advanceTimersByTimeAsync(10_000));
    expect(loadGift).toHaveBeenCalledTimes(3);
  });

  it('reports a slow webhook but keeps polling', async () => {
    const loadGift = vi.fn<() => Promise<GiftEditorView>>().mockResolvedValue(gift('FREE'));
    const { result } = renderHook(() =>
      useGiftPaymentStatus(loadGift, { intervalMs: 1000, delayedAfterMs: 3000 }),
    );
    await act(() => vi.advanceTimersByTimeAsync(2000));
    expect(result.current.status).toBe('waiting');
    await act(() => vi.advanceTimersByTimeAsync(2000));
    expect(result.current.status).toBe('delayed');

    loadGift.mockResolvedValue(gift('PREMIUM'));
    await act(() => vi.advanceTimersByTimeAsync(1000));
    expect(result.current.status).toBe('confirmed');
  });

  it('survives a network blip and gives up after repeated failures', async () => {
    const loadGift = vi
      .fn<() => Promise<GiftEditorView>>()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(gift('FREE'))
      .mockRejectedValue(new Error('gone'));
    const { result } = renderHook(() => useGiftPaymentStatus(loadGift, { intervalMs: 1000 }));

    await act(() => vi.advanceTimersByTimeAsync(1000));
    expect(result.current.status).toBe('waiting');
    await act(() => vi.advanceTimersByTimeAsync(3000));
    expect(result.current.status).toBe('failed');
    const calls = loadGift.mock.calls.length;
    await act(() => vi.advanceTimersByTimeAsync(5000));
    expect(loadGift).toHaveBeenCalledTimes(calls);
  });

  it('stops polling when unmounted', async () => {
    const loadGift = vi.fn<() => Promise<GiftEditorView>>().mockResolvedValue(gift('FREE'));
    const { unmount } = renderHook(() => useGiftPaymentStatus(loadGift, { intervalMs: 1000 }));
    await act(() => vi.advanceTimersByTimeAsync(0));
    unmount();
    await act(() => vi.advanceTimersByTimeAsync(5000));
    expect(loadGift).toHaveBeenCalledTimes(1);
  });
});
