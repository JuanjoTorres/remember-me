import {
  type CanActivate,
  createParamDecorator,
  type ExecutionContext,
  Injectable,
} from '@nestjs/common';
import type { Request } from 'express';
import { AppError } from '../http/app-error.js';
import { type GiftGrantClaims, GiftGrantService } from './gift-grant.service.js';

type RequestWithGrant = Request & { giftGrant?: GiftGrantClaims };

/** Requires `Authorization: Bearer <grant>` and exposes the verified claims through `@Grant()`. */
@Injectable()
export class GiftGrantGuard implements CanActivate {
  constructor(private readonly grants: GiftGrantService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<RequestWithGrant>();
    const [scheme, token] = (request.headers.authorization ?? '').split(' ');
    if (scheme !== 'Bearer' || !token)
      throw new AppError('UNAUTHORIZED', 'A gift grant is required');
    request.giftGrant = this.grants.verify(token);
    return true;
  }
}

export const Grant = createParamDecorator((_data: unknown, context: ExecutionContext) => {
  const grant = context.switchToHttp().getRequest<RequestWithGrant>().giftGrant;
  if (!grant) throw new AppError('UNAUTHORIZED', 'A gift grant is required');
  return grant;
});
