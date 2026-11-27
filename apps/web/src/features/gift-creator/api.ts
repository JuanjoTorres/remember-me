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

/**
 * Every editor call of one gift, bound to its edit token. Each returns the updated gift.
 * `lastGrant` gives the grant of the last answer, which every call sends back: the server lets an
 * editor that was opened in time go on saving after the correction window has ended.
 */
export function giftApi(giftId: string, editToken: string, lastGrant?: () => string | undefined) {
  const call = <T = GiftEditorView>(
    path: string,
    method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE',
    body?: unknown,
  ) =>
    apiJson<T>(`/gifts/${giftId}${path}`, {
      method,
      body,
      editToken,
      editSession: lastGrant?.(),
    });
  return {
    get: () => call('', 'GET'),
    update: (changes: UpdateGiftRequest) => call('', 'PATCH', changes),
    remove: () => call<void>('', 'DELETE'),
    publish: () => call('/publish', 'POST'),
    changeSlug: (name: string) => call('/slug', 'PUT', { name }),
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
