import { Controller, Get, Query, Res, StreamableFile, UseGuards } from '@nestjs/common';
import { type QrFormat, QrFormatSchema } from '@remember-me/shared-types';
import type { Response } from 'express';
import { GiftGrantGuard, Grant } from '../../shared/auth/gift-grant.guard.js';
import type { GiftGrantClaims } from '../../shared/auth/gift-grant.service.js';
import { ZodPipe } from '../../shared/http/zod.pipe.js';
import { QrService } from './qr.service.js';

@Controller('qr')
@UseGuards(GiftGrantGuard)
export class QrController {
  constructor(private readonly qr: QrService) {}

  /** QR code of the gift named by the grant, as a downloadable file. */
  @Get()
  async download(
    @Grant() grant: GiftGrantClaims,
    @Query('format', new ZodPipe(QrFormatSchema.default('png'))) format: QrFormat,
    @Res({ passthrough: true }) response: Response,
  ): Promise<StreamableFile> {
    const image = await this.qr.render(grant, format);
    response.set({ 'Cache-Control': 'private, no-store' });
    return new StreamableFile(image.body, {
      type: image.contentType,
      disposition: `attachment; filename="${image.fileName}"`,
    });
  }
}
