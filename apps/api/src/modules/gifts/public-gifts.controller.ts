import { Controller, Get, Ip, Param } from '@nestjs/common';
import { customLink, GiftLinkSchema, type PublicGift } from '@remember-me/shared-types';
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

  /** A generated link: `kardoo.me/x9k2bd7m`. */
  @Get(':code')
  generated(@Param('code') code: string, @Ip() client: string): Promise<PublicGift> {
    return this.open(code, client);
  }

  /** A custom link: `kardoo.me/7k2m/for/ana-luis`. */
  @Get(':code/for/:name')
  custom(
    @Param('code') code: string,
    @Param('name') name: string,
    @Ip() client: string,
  ): Promise<PublicGift> {
    return this.open(customLink(code, name), client);
  }

  private async open(slug: string, client: string): Promise<PublicGift> {
    this.guesses.assertMayOpen(client);
    // Not even the shape of a link (a mistyped page, a crawler asking for a file): it is no guess
    // at a gift, so it is not held against the visitor, and no gift is looked up.
    if (!GiftLinkSchema.safeParse(slug).success) throw new AppError('NOT_FOUND', 'Gift not found');
    try {
      return await this.gifts.getPublic(slug);
    } catch (error) {
      // A link that leads nowhere is what guessing looks like; a real recipient rarely has one.
      if (error instanceof AppError && error.code === 'NOT_FOUND') this.guesses.missed(client);
      throw error;
    }
  }
}
