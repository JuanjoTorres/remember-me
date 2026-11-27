import type { Locale } from '@remember-me/shared-types';
import type { MailMessage } from '../../shared/mail/mailer.js';

interface AnniversaryEmailInput {
  locale: Locale;
  recipientName: string;
  /** Public page of the gift. */
  giftUrl: string;
  /** Where a new gift is started. */
  createUrl: string;
  /** Name of the site, as people know it. */
  brand: string;
}

const TEXTS = {
  en: {
    subject: (name: string) =>
      name ? `One year ago you surprised ${name}` : 'One year ago you gave a surprise',
    intro: (name: string) =>
      name
        ? `A year ago you gave ${name} a gift made of memories.`
        : 'A year ago you gave someone a gift made of memories.',
    relive: 'It is still there, exactly as you made it. Open it again:',
    reliveLink: 'Relive the gift',
    again: 'Is there someone you would like to surprise this year?',
    cta: 'Create a new gift',
    footer: (brand: string) =>
      `You receive this single email because you bought this gift on ${brand}. We will not write to you again about it.`,
  },
  es: {
    subject: (name: string) =>
      name ? `Hace un año sorprendiste a ${name}` : 'Hace un año regalaste una sorpresa',
    intro: (name: string) =>
      name
        ? `Hace un año le hiciste a ${name} un regalo lleno de recuerdos.`
        : 'Hace un año hiciste un regalo lleno de recuerdos.',
    relive: 'Sigue ahí, tal como lo creaste. Vuelve a abrirlo:',
    reliveLink: 'Revivir el regalo',
    again: '¿Hay alguien a quien te gustaría sorprender este año?',
    cta: 'Crear un regalo nuevo',
    footer: (brand: string) =>
      `Recibes este único correo porque compraste este regalo en ${brand}. No volveremos a escribirte sobre él.`,
  },
} as const;

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

/** The one email a buyer gets, a year after their gift was published. */
export function anniversaryEmail(input: AnniversaryEmailInput): Omit<MailMessage, 'to'> {
  const t = TEXTS[input.locale];
  // The name was typed by the creator: it is text, never markup.
  const name = input.recipientName.trim();
  const intro = t.intro(name);
  const footer = t.footer(input.brand);
  const giftUrl = escapeHtml(input.giftUrl);
  const createUrl = escapeHtml(input.createUrl);

  const text = [
    intro,
    '',
    t.relive,
    input.giftUrl,
    '',
    t.again,
    `${t.cta}: ${input.createUrl}`,
    '',
    footer,
  ].join('\n');

  const html = `<!doctype html>
<html lang="${input.locale}">
  <body style="margin:0;padding:24px;background:#faf7f2;font-family:Helvetica,Arial,sans-serif;color:#2b2330">
    <div style="max-width:480px;margin:0 auto;background:#ffffff;border-radius:16px;padding:32px">
      <p style="margin:0 0 16px;font-size:14px;color:#8a7f8f">${escapeHtml(input.brand)}</p>
      <p style="margin:0 0 16px;font-size:18px;line-height:1.5">${escapeHtml(intro)}</p>
      <p style="margin:0 0 8px;font-size:16px;line-height:1.5">${escapeHtml(t.relive)}</p>
      <p style="margin:0 0 24px;font-size:16px"><a href="${giftUrl}" style="color:#b4436c">${escapeHtml(t.reliveLink)}</a></p>
      <p style="margin:0 0 16px;font-size:16px;line-height:1.5">${escapeHtml(t.again)}</p>
      <p style="margin:0 0 32px">
        <a href="${createUrl}" style="display:inline-block;background:#b4436c;color:#ffffff;text-decoration:none;font-weight:bold;padding:14px 24px;border-radius:999px">${escapeHtml(t.cta)}</a>
      </p>
      <p style="margin:0;font-size:12px;line-height:1.5;color:#8a7f8f">${escapeHtml(footer)}</p>
    </div>
  </body>
</html>`;

  return { subject: t.subject(name), html, text };
}
