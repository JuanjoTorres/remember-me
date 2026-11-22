import { Global, Module } from '@nestjs/common';
import { GiftGrantGuard } from './gift-grant.guard.js';
import { GiftGrantService } from './gift-grant.service.js';

@Global()
@Module({
  providers: [GiftGrantService, GiftGrantGuard],
  exports: [GiftGrantService, GiftGrantGuard],
})
export class AuthModule {}
