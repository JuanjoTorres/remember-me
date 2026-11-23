import { Inject, Injectable } from '@nestjs/common';
import { checkQrFormat, PLAN_CAPABILITIES, type QrFormat } from '@remember-me/shared-types';
import QRCode from 'qrcode';
import { ENV } from '../../config/config.module.js';
import type { Env } from '../../config/env.js';
import type { GiftGrantClaims } from '../../shared/auth/gift-grant.service.js';
import { AppError } from '../../shared/http/app-error.js';

export interface QrImage {
  body: Buffer;
  contentType: string;
  fileName: string;
}

@Injectable()
export class QrService {
  constructor(@Inject(ENV) private readonly env: Env) {}

  /** The address a recipient lands on when scanning the code. */
  targetUrl(slug: string): string {
    return `${this.env.WEB_ORIGIN}/for/${slug}`;
  }

  async render(grant: GiftGrantClaims, format: QrFormat): Promise<QrImage> {
    if (!grant.published) {
      // The link is only final once the gift is published; a code printed earlier would break.
      throw new AppError('CONFLICT', 'Publish the gift to get its QR code');
    }
    const check = checkQrFormat(grant.plan, format);
    if (!check.allowed) {
      throw new AppError('PREMIUM_REQUIRED', 'This download is part of the full experience', {
        capability: check.capability,
      });
    }

    const url = this.targetUrl(grant.slug);
    const options = { errorCorrectionLevel: 'Q', margin: 2 } as const;
    const fileName = `remember-me-${grant.slug}.${format}`;
    if (format === 'svg') {
      const svg = await QRCode.toString(url, { ...options, type: 'svg' });
      return { body: Buffer.from(svg), contentType: 'image/svg+xml', fileName };
    }
    const png = await QRCode.toBuffer(url, {
      ...options,
      type: 'png',
      width: PLAN_CAPABILITIES[grant.plan].qrPngSize,
    });
    return { body: png, contentType: 'image/png', fileName };
  }
}
