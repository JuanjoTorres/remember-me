import { Controller, Post, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { MEDIA_LIMITS, type MediaUploadResponse } from '@remember-me/shared-types';
import { GiftGrantGuard, Grant } from '../../shared/auth/gift-grant.guard.js';
import type { GiftGrantClaims } from '../../shared/auth/gift-grant.service.js';
import { MediaService } from './media.service.js';

const singleFile = (maxBytes: number) =>
  FileInterceptor('file', { limits: { fileSize: maxBytes, files: 1 } });

/** Uploads for one gift, authorized by its grant. The guard runs before the body is read. */
@Controller('media')
@UseGuards(GiftGrantGuard)
export class MediaController {
  constructor(private readonly media: MediaService) {}

  @Post('images')
  @UseInterceptors(singleFile(MEDIA_LIMITS.imageMaxBytes))
  uploadImage(
    @Grant() grant: GiftGrantClaims,
    @UploadedFile() file?: Express.Multer.File,
  ): Promise<MediaUploadResponse> {
    return this.media.upload(grant, 'IMAGE', file?.buffer);
  }

  @Post('audio')
  @UseInterceptors(singleFile(MEDIA_LIMITS.audioMaxBytes))
  uploadAudio(
    @Grant() grant: GiftGrantClaims,
    @UploadedFile() file?: Express.Multer.File,
  ): Promise<MediaUploadResponse> {
    return this.media.upload(grant, 'AUDIO', file?.buffer);
  }
}
