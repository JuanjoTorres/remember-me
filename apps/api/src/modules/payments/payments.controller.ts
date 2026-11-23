import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Post,
  type RawBodyRequest,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  type CheckoutSessionRequest,
  CheckoutSessionRequestSchema,
  type CheckoutSessionResponse,
  type PaymentConfirmation,
  type PricesResponse,
} from '@remember-me/shared-types';
import { SkipThrottle } from '@nestjs/throttler';
import type { Request } from 'express';
import { GiftGrantGuard, Grant } from '../../shared/auth/gift-grant.guard.js';
import type { GiftGrantClaims } from '../../shared/auth/gift-grant.service.js';
import { ZodPipe } from '../../shared/http/zod.pipe.js';
import { PaymentsService } from './payments.service.js';

@Controller('payments')
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @Get('prices')
  prices(): Promise<PricesResponse> {
    return this.payments.getPrices();
  }

  @Post('checkout-session')
  @UseGuards(GiftGrantGuard)
  createCheckoutSession(
    @Grant() grant: GiftGrantClaims,
    @Body(new ZodPipe(CheckoutSessionRequestSchema)) body: CheckoutSessionRequest,
  ): Promise<CheckoutSessionResponse> {
    return this.payments.createCheckoutSession(grant, body);
  }

  /** Called by the return page: checks with Stripe whether the gift's checkout was paid. */
  @Post('confirm')
  @HttpCode(200)
  @UseGuards(GiftGrantGuard)
  confirm(@Grant() grant: GiftGrantClaims): Promise<PaymentConfirmation> {
    return this.payments.confirm(grant);
  }

  /** Called by Stripe. Authenticated by the signature over the raw body, so never rate limited. */
  @Post('webhook')
  @SkipThrottle({ default: true, 'gift-creation': true })
  @HttpCode(200)
  async webhook(
    @Req() request: RawBodyRequest<Request>,
    @Headers('stripe-signature') signature?: string,
  ): Promise<{ received: true }> {
    await this.payments.handleWebhook(request.rawBody, signature);
    return { received: true };
  }
}
