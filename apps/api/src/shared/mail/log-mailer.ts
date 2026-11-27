import { Logger } from '@nestjs/common';
import { type MailMessage, Mailer } from './mailer.js';

/** Stand-in for local work and tests: nothing leaves the machine. The address is not logged. */
export class LogMailer extends Mailer {
  readonly delivers = false;
  private readonly logger = new Logger('Mail');

  send(message: MailMessage): Promise<void> {
    this.logger.log(`Not sent (MAIL_DRIVER=log): "${message.subject}"`);
    return Promise.resolve();
  }
}
