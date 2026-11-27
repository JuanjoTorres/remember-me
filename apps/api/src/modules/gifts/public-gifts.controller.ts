import { Controller, Get, Ip, Param } from '@nestjs/common';
import type { PublicGift } from '@remember-me/shared-types';
import { AppError } from '../../shared/http/app-error.js';
import { GiftsService } from './gifts.service.js';
import { LinkGuessGuard } from './link-guess-guard.js';

/** What the QR code opens. No credentials: the slug is the secret. */
@Controller('public/gifts')
export class PublicGiftsController {
  constructor(
    private readonly gifts: GiftsService,
    private readonly guesses: LinkGuessGuard,
  ) {}

  @Get(':slug')
  async get(@Param('slug') slug: string, @Ip() client: string): Promise<PublicGift> {
    this.guesses.assertMayOpen(client);
    try {
      return await this.gifts.getPublic(slug);
    } catch (error) {
      // A link that leads nowhere is what guessing looks like; a real recipient rarely has one.
      if (error instanceof AppError && error.code === 'NOT_FOUND') this.guesses.missed(client);
      throw error;
    }
  }
}
