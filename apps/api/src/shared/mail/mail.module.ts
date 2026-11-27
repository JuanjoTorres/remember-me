import { Global, Module } from '@nestjs/common';
import { ENV } from '../../config/config.module.js';
import type { Env } from '../../config/env.js';
import { LogMailer } from './log-mailer.js';
import { Mailer } from './mailer.js';
import { ResendMailer } from './resend-mailer.js';

@Global()
@Module({
  providers: [
    {
      provide: Mailer,
      inject: [ENV],
      useFactory: (env: Env): Mailer =>
        env.MAIL_DRIVER === 'resend' && env.RESEND_API_KEY && env.MAIL_FROM
          ? new ResendMailer(env.RESEND_API_KEY, env.MAIL_FROM)
          : new LogMailer(),
    },
  ],
  exports: [Mailer],
})
export class MailModule {}
