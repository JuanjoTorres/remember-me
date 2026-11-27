import {
  Body,
  Controller,
  createParamDecorator,
  Delete,
  type ExecutionContext,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
} from '@nestjs/common';
import {
  type CardInput,
  CardInputSchema,
  type ChangeSlugRequest,
  ChangeSlugRequestSchema,
  type CreateGiftRequest,
  CreateGiftRequestSchema,
  type CreateGiftResponse,
  EDIT_SESSION_HEADER,
  EDIT_TOKEN_HEADER,
  type GiftEditorView,
  type ReorderCardsRequest,
  ReorderCardsRequestSchema,
  type UpdateGiftRequest,
  UpdateGiftRequestSchema,
} from '@remember-me/shared-types';
import { ZodPipe } from '../../shared/http/zod.pipe.js';
import { type EditAccess, GiftsService } from './gifts.service.js';

const GiftId = () => Param('giftId', new ParseUUIDPipe());
/** What the request presents: the edit token and, when the editor sends it back, its last grant. */
const Access = createParamDecorator((_: unknown, context: ExecutionContext): EditAccess => {
  const { headers } = context.switchToHttp().getRequest<{
    headers: Record<string, string | string[] | undefined>;
  }>();
  const one = (name: string) => {
    const value = headers[name];
    return typeof value === 'string' ? value : undefined;
  };
  return { editToken: one(EDIT_TOKEN_HEADER), session: one(EDIT_SESSION_HEADER) };
});

/** Editor endpoints. Everything except creation needs the gift's edit token. */
@Controller('gifts')
export class GiftsController {
  constructor(private readonly gifts: GiftsService) {}

  @Post()
  create(
    @Body(new ZodPipe(CreateGiftRequestSchema)) body: CreateGiftRequest,
  ): Promise<CreateGiftResponse> {
    return this.gifts.create(body);
  }

  @Get(':giftId')
  get(@GiftId() giftId: string, @Access() access: EditAccess): Promise<GiftEditorView> {
    return this.gifts.get(giftId, access);
  }

  @Patch(':giftId')
  update(
    @GiftId() giftId: string,
    @Body(new ZodPipe(UpdateGiftRequestSchema)) body: UpdateGiftRequest,
    @Access() access: EditAccess,
  ): Promise<GiftEditorView> {
    return this.gifts.update(giftId, access, body);
  }

  @Delete(':giftId')
  @HttpCode(204)
  remove(@GiftId() giftId: string, @Access() access: EditAccess): Promise<void> {
    return this.gifts.remove(giftId, access);
  }

  @Post(':giftId/publish')
  @HttpCode(200)
  publish(@GiftId() giftId: string, @Access() access: EditAccess): Promise<GiftEditorView> {
    return this.gifts.publish(giftId, access);
  }

  @Put(':giftId/slug')
  changeSlug(
    @GiftId() giftId: string,
    @Body(new ZodPipe(ChangeSlugRequestSchema)) body: ChangeSlugRequest,
    @Access() access: EditAccess,
  ): Promise<GiftEditorView> {
    return this.gifts.changeSlug(giftId, access, body.name);
  }

  @Post(':giftId/cards')
  addCard(
    @GiftId() giftId: string,
    @Body(new ZodPipe(CardInputSchema)) body: CardInput,
    @Access() access: EditAccess,
  ): Promise<GiftEditorView> {
    return this.gifts.addCard(giftId, access, body);
  }

  @Put(':giftId/cards/order')
  reorderCards(
    @GiftId() giftId: string,
    @Body(new ZodPipe(ReorderCardsRequestSchema)) body: ReorderCardsRequest,
    @Access() access: EditAccess,
  ): Promise<GiftEditorView> {
    return this.gifts.reorderCards(giftId, access, body.cardIds);
  }

  @Patch(':giftId/cards/:cardId')
  updateCard(
    @GiftId() giftId: string,
    @Param('cardId', new ParseUUIDPipe()) cardId: string,
    @Body(new ZodPipe(CardInputSchema)) body: CardInput,
    @Access() access: EditAccess,
  ): Promise<GiftEditorView> {
    return this.gifts.updateCard(giftId, access, cardId, body);
  }

  @Delete(':giftId/cards/:cardId')
  removeCard(
    @GiftId() giftId: string,
    @Param('cardId', new ParseUUIDPipe()) cardId: string,
    @Access() access: EditAccess,
  ): Promise<GiftEditorView> {
    return this.gifts.removeCard(giftId, access, cardId);
  }
}
