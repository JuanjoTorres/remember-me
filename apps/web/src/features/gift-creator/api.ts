import type {
  CardInput,
  CreateGiftResponse,
  GiftEditorView,
  Locale,
  MediaUploadResponse,
  QrFormat,
  UpdateGiftRequest,
} from '@remember-me/shared-types';
import { apiBlob, apiJson } from '@/features/shared/api/client';

export function createGift(locale: Locale): Promise<CreateGiftResponse> {
  return apiJson('/gifts', { method: 'POST', body: { locale } });
}

/** Every editor call of one gift, bound to its edit token. Each returns the updated gift. */
export function giftApi(giftId: string, editToken: string) {
  const call = <T = GiftEditorView>(
    path: string,
    method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE',
    body?: unknown,
  ) => apiJson<T>(`/gifts/${giftId}${path}`, { method, body, editToken });
  return {
    get: () => call('', 'GET'),
    update: (changes: UpdateGiftRequest) => call('', 'PATCH', changes),
    remove: () => call<void>('', 'DELETE'),
    publish: () => call('/publish', 'POST'),
    changeSlug: (slug: string) => call('/slug', 'PUT', { slug }),
    addCard: (card: CardInput) => call('/cards', 'POST', card),
    updateCard: (cardId: string, card: CardInput) => call(`/cards/${cardId}`, 'PATCH', card),
    removeCard: (cardId: string) => call(`/cards/${cardId}`, 'DELETE'),
    reorderCards: (cardIds: string[]) => call('/cards/order', 'PUT', { cardIds }),
  };
}
export type GiftApi = ReturnType<typeof giftApi>;

export function uploadMedia(
  grant: string,
  kind: 'images' | 'audio',
  file: Blob,
  name: string,
): Promise<MediaUploadResponse> {
  const form = new FormData();
  form.append('file', file, name);
  return apiJson(`/media/${kind}`, { method: 'POST', body: form, grant });
}

export function downloadQr(grant: string, format: QrFormat): Promise<Blob> {
  return apiBlob(`/qr?format=${format}`, { grant });
}
