import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  Ip,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import {
  type CardInput,
  CardInputSchema,
  type ChangeSlugRequest,
  ChangeSlugRequestSchema,
  type CreateGiftRequest,
  CreateGiftRequestSchema,
  type CreateGiftResponse,
  EDIT_TOKEN_HEADER,
  type GiftEditorView,
  type ReorderCardsRequest,
  ReorderCardsRequestSchema,
  type SlugAvailability,
  type UpdateGiftRequest,
  UpdateGiftRequestSchema,
} from '@remember-me/shared-types';
import { z } from 'zod';
import { ZodPipe } from '../../shared/http/zod.pipe.js';
import { GiftsService } from './gifts.service.js';
import { LinkGuessGuard } from './link-guess-guard.js';

const GiftId = () => Param('giftId', new ParseUUIDPipe());
const EditToken = () => Headers(EDIT_TOKEN_HEADER);

/** Editor endpoints. Everything except creation needs the gift's edit token. */
@Controller('gifts')
export class GiftsController {
  constructor(
    private readonly gifts: GiftsService,
    private readonly guesses: LinkGuessGuard,
  ) {}

  @Post()
  create(
    @Body(new ZodPipe(CreateGiftRequestSchema)) body: CreateGiftRequest,
  ): Promise<CreateGiftResponse> {
    return this.gifts.create(body);
  }

  @Get('check-slug')
  checkSlug(
    @Query('slug', new ZodPipe(z.string().max(200))) slug: string,
    @Ip() client: string,
  ): Promise<SlugAvailability> {
    // The answer says whether a link exists, so it must not be a way to look for gifts.
    this.guesses.countCheck(client);
    return this.gifts.checkSlug(slug);
  }

  @Get(':giftId')
  get(@GiftId() giftId: string, @EditToken() token?: string): Promise<GiftEditorView> {
    return this.gifts.get(giftId, token);
  }

  @Patch(':giftId')
  update(
    @GiftId() giftId: string,
    @Body(new ZodPipe(UpdateGiftRequestSchema)) body: UpdateGiftRequest,
    @EditToken() token?: string,
  ): Promise<GiftEditorView> {
    return this.gifts.update(giftId, token, body);
  }

  @Delete(':giftId')
  @HttpCode(204)
  remove(@GiftId() giftId: string, @EditToken() token?: string): Promise<void> {
    return this.gifts.remove(giftId, token);
  }

  @Post(':giftId/publish')
  @HttpCode(200)
  publish(@GiftId() giftId: string, @EditToken() token?: string): Promise<GiftEditorView> {
    return this.gifts.publish(giftId, token);
  }

  @Put(':giftId/slug')
  changeSlug(
    @GiftId() giftId: string,
    @Body(new ZodPipe(ChangeSlugRequestSchema)) body: ChangeSlugRequest,
    @EditToken() token?: string,
  ): Promise<GiftEditorView> {
    return this.gifts.changeSlug(giftId, token, body.slug);
  }

  @Post(':giftId/cards')
  addCard(
    @GiftId() giftId: string,
    @Body(new ZodPipe(CardInputSchema)) body: CardInput,
    @EditToken() token?: string,
  ): Promise<GiftEditorView> {
    return this.gifts.addCard(giftId, token, body);
  }

  @Put(':giftId/cards/order')
  reorderCards(
    @GiftId() giftId: string,
    @Body(new ZodPipe(ReorderCardsRequestSchema)) body: ReorderCardsRequest,
    @EditToken() token?: string,
  ): Promise<GiftEditorView> {
    return this.gifts.reorderCards(giftId, token, body.cardIds);
  }

  @Patch(':giftId/cards/:cardId')
  updateCard(
    @GiftId() giftId: string,
    @Param('cardId', new ParseUUIDPipe()) cardId: string,
    @Body(new ZodPipe(CardInputSchema)) body: CardInput,
    @EditToken() token?: string,
  ): Promise<GiftEditorView> {
    return this.gifts.updateCard(giftId, token, cardId, body);
  }

  @Delete(':giftId/cards/:cardId')
  removeCard(
    @GiftId() giftId: string,
    @Param('cardId', new ParseUUIDPipe()) cardId: string,
    @EditToken() token?: string,
  ): Promise<GiftEditorView> {
    return this.gifts.removeCard(giftId, token, cardId);
  }
}
