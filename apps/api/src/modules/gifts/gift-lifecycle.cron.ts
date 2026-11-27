import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ENV } from '../../config/config.module.js';
import type { Env } from '../../config/env.js';
import { GiftLifecycleService } from './gift-lifecycle.service.js';

/** Daily jobs. They only schedule: the work, and what makes it safe to repeat, is in the service. */
@Injectable()
export class GiftLifecycleCron {
  private readonly logger = new Logger('GiftLifecycle');

  constructor(
    private readonly lifecycle: GiftLifecycleService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  @Cron('15 3 * * *', { name: 'delete-expired-gifts', timeZone: 'UTC' })
  async deleteExpired(): Promise<void> {
    await this.run('Expired gifts deleted', () => this.lifecycle.deleteExpired());
  }

  @Cron('0 9 * * *', { name: 'send-anniversary-emails', timeZone: 'UTC' })
  async sendAnniversaryEmails(): Promise<void> {
    await this.run('Anniversary emails sent', () => this.lifecycle.sendAnniversaryEmails());
  }

  /** A failed job must not take the process down; the next day's run picks up what was left. */
  private async run(what: string, job: () => Promise<number>): Promise<void> {
    // Off in automated tests, which call the service themselves and must not be surprised by a
    // job firing at its hour against their database.
    if (!this.env.SCHEDULED_JOBS) return;
    try {
      this.logger.log(`${what}: ${await job()}`);
    } catch (error) {
      this.logger.error(`${what}: failed. ${String(error)}`);
    }
  }
}
