import { Controller, Get, Param } from '@nestjs/common';
import type { PublicGift } from '@remember-me/shared-types';
import { GiftsService } from './gifts.service.js';

/** What the QR code opens. No credentials: the slug is the secret. */
@Controller('public/gifts')
export class PublicGiftsController {
  constructor(private readonly gifts: GiftsService) {}

  @Get(':slug')
  get(@Param('slug') slug: string): Promise<PublicGift> {
    return this.gifts.getPublic(slug);
  }
}
