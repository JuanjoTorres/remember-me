import { describe, expect, it, vi } from 'vitest';
import type { Env } from '../src/config/env.js';
import { GiftLifecycleCron } from '../src/modules/gifts/gift-lifecycle.cron.js';
import type { GiftLifecycleService } from '../src/modules/gifts/gift-lifecycle.service.js';

function cron(scheduledJobs: boolean, lifecycle: Partial<GiftLifecycleService>) {
  return new GiftLifecycleCron(
    lifecycle as GiftLifecycleService,
    { SCHEDULED_JOBS: scheduledJobs } as Env,
  );
}

describe('daily jobs', () => {
  it('run the clean-up and the anniversary email when they fire', async () => {
    const lifecycle = {
      deleteExpired: vi.fn().mockResolvedValue(2),
      sendAnniversaryEmails: vi.fn().mockResolvedValue(1),
    };
    const jobs = cron(true, lifecycle);
    await jobs.deleteExpired();
    await jobs.sendAnniversaryEmails();
    expect(lifecycle.deleteExpired).toHaveBeenCalledOnce();
    expect(lifecycle.sendAnniversaryEmails).toHaveBeenCalledOnce();
  });

  it('do nothing on an instance where they are switched off', async () => {
    const lifecycle = { deleteExpired: vi.fn(), sendAnniversaryEmails: vi.fn() };
    const jobs = cron(false, lifecycle);
    await jobs.deleteExpired();
    await jobs.sendAnniversaryEmails();
    expect(lifecycle.deleteExpired).not.toHaveBeenCalled();
    expect(lifecycle.sendAnniversaryEmails).not.toHaveBeenCalled();
  });

  it('survive a job that fails, so that the process keeps running', async () => {
    const lifecycle = { deleteExpired: vi.fn().mockRejectedValue(new Error('database is down')) };
    await expect(cron(true, lifecycle).deleteExpired()).resolves.toBeUndefined();
  });
});
