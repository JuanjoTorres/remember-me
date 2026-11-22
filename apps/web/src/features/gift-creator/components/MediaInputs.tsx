'use client';

import { MEDIA_LIMITS } from '@remember-me/shared-types';
import { useTranslations } from 'next-intl';
import { useRef, useState } from 'react';
import { isApiError } from '@/features/shared/api/client';
import { Button } from '@/features/shared/ui/Button';
import { uploadMedia } from '../api';
import { compressImage } from '../compress-image';
import type { GiftEditor } from '../useGiftEditor';

interface MediaInputProps {
  editor: Pick<GiftEditor, 'withGrant' | 'openUpgrade'>;
  value: string | null;
  onChange: (url: string | null) => void;
}

function useUpload(editor: MediaInputProps['editor']) {
  const t = useTranslations('creator');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function upload(
    kind: 'images' | 'audio',
    file: Blob,
    name: string,
  ): Promise<string | null> {
    setBusy(true);
    setError(null);
    try {
      return (await editor.withGrant((grant) => uploadMedia(grant, kind, file, name))).url;
    } catch (cause) {
      if (isApiError(cause, 'PREMIUM_REQUIRED')) editor.openUpgrade('AUDIO_UPLOAD');
      else if (isApiError(cause, 'UNSUPPORTED_MEDIA'))
        setError(t(kind === 'images' ? 'imageUnsupported' : 'audioUnsupported'));
      else if (isApiError(cause, 'PAYLOAD_TOO_LARGE')) setError(t('fileTooLarge'));
      else setError(t('uploadError'));
      return null;
    } finally {
      setBusy(false);
    }
  }
  return { busy, error, setError, upload };
}

/** Photo picker: compresses in the browser, uploads, and shows the stored image. */
export function ImagePicker({ editor, value, onChange }: MediaInputProps) {
  const t = useTranslations('creator');
  const input = useRef<HTMLInputElement>(null);
  const { busy, error, upload } = useUpload(editor);

  async function onFile(file: File | undefined) {
    if (!file) return;
    const url = await upload('images', await compressImage(file), 'photo.jpg');
    if (url) onChange(url);
  }

  return (
    <div>
      <input
        ref={input}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="sr-only"
        aria-label={t('choosePhoto')}
        onChange={(event) => {
          void onFile(event.target.files?.[0]);
          event.target.value = '';
        }}
      />
      {value ? (
        <div className="relative overflow-hidden rounded-2xl">
          {/* eslint-disable-next-line @next/next/no-img-element -- user media from object storage */}
          <img src={value} alt="" className="aspect-[4/3] w-full object-cover" />
          <div className="absolute right-2 bottom-2 flex gap-2">
            <Button
              variant="secondary"
              className="min-h-9 px-3 text-sm"
              busy={busy}
              onClick={() => input.current?.click()}
            >
              {t('changePhoto')}
            </Button>
            <Button
              variant="secondary"
              className="min-h-9 px-3 text-sm"
              onClick={() => onChange(null)}
            >
              {t('removePhoto')}
            </Button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          disabled={busy}
          onClick={() => input.current?.click()}
          className="border-ink/20 text-ink-soft flex aspect-[4/3] w-full flex-col items-center justify-center gap-1 rounded-2xl border-2 border-dashed bg-white text-sm font-medium"
        >
          <span aria-hidden className="text-2xl">
            ＋
          </span>
          {busy ? t('uploading') : t('choosePhoto')}
        </button>
      )}
      {error && (
        <p role="alert" className="text-ember-deep mt-2 text-sm">
          {error}
        </p>
      )}
    </div>
  );
}

const RECORDING_TYPE = 'audio/mp4';
const MAX_RECORDING_MS = 120_000;

function canRecord(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.MediaRecorder !== 'undefined' &&
    window.MediaRecorder.isTypeSupported(RECORDING_TYPE) &&
    Boolean(navigator.mediaDevices?.getUserMedia)
  );
}

/** Voice note: record in the browser (where it can produce M4A) or pick an M4A/MP3 file. */
export function AudioInput({ editor, value, onChange }: MediaInputProps) {
  const t = useTranslations('creator');
  const input = useRef<HTMLInputElement>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const [recording, setRecording] = useState(false);
  const { busy, error, setError, upload } = useUpload(editor);

  async function store(file: Blob, name: string) {
    if (file.size > MEDIA_LIMITS.audioMaxBytes) return setError(t('fileTooLarge'));
    const url = await upload('audio', file, name);
    if (url) onChange(url);
  }

  async function startRecording() {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const chunks: Blob[] = [];
      const active = new MediaRecorder(stream, { mimeType: RECORDING_TYPE });
      const limit = setTimeout(() => active.stop(), MAX_RECORDING_MS);
      active.ondataavailable = (event) => chunks.push(event.data);
      active.onstop = () => {
        clearTimeout(limit);
        stream.getTracks().forEach((track) => track.stop());
        setRecording(false);
        void store(new Blob(chunks, { type: RECORDING_TYPE }), 'voice.m4a');
      };
      recorder.current = active;
      active.start();
      setRecording(true);
    } catch {
      setError(t('microphoneError'));
    }
  }

  return (
    <div>
      <input
        ref={input}
        type="file"
        accept="audio/mp4,audio/x-m4a,audio/mpeg,.m4a,.mp3"
        className="sr-only"
        aria-label={t('chooseAudio')}
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void store(file, file.name);
          event.target.value = '';
        }}
      />
      {value && <audio controls src={value} className="mb-3 w-full" />}
      <div className="flex flex-wrap gap-2">
        {canRecord() &&
          (recording ? (
            <Button
              variant="danger"
              className="border-ember border"
              onClick={() => recorder.current?.stop()}
            >
              ■ {t('stopRecording')}
            </Button>
          ) : (
            <Button variant="secondary" busy={busy} onClick={startRecording}>
              ● {t(value ? 'recordAgain' : 'record')}
            </Button>
          ))}
        {!recording && (
          <Button variant="secondary" busy={busy} onClick={() => input.current?.click()}>
            {t('chooseAudio')}
          </Button>
        )}
      </div>
      <p className="text-ink-soft mt-2 text-sm">{t('audioHint')}</p>
      {error && (
        <p role="alert" className="text-ember-deep mt-2 text-sm">
          {error}
        </p>
      )}
    </div>
  );
}
