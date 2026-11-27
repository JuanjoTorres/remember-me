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
  it('run the clean-up when it fires', async () => {
    const lifecycle = { deleteExpired: vi.fn().mockResolvedValue(2) };
    await cron(true, lifecycle).deleteExpired();
    expect(lifecycle.deleteExpired).toHaveBeenCalledOnce();
  });

  it('do nothing on an instance where they are switched off', async () => {
    const lifecycle = { deleteExpired: vi.fn() };
    await cron(false, lifecycle).deleteExpired();
    expect(lifecycle.deleteExpired).not.toHaveBeenCalled();
  });

  it('do not send the anniversary email, which is switched off for now', () => {
    const scheduled = Object.getOwnPropertyNames(GiftLifecycleCron.prototype).filter(
      (name) => name !== 'constructor' && name !== 'run',
    );
    expect(scheduled).toEqual(['deleteExpired']);
  });

  it('survive a job that fails, so that the process keeps running', async () => {
    const lifecycle = { deleteExpired: vi.fn().mockRejectedValue(new Error('database is down')) };
    await expect(cron(true, lifecycle).deleteExpired()).resolves.toBeUndefined();
  });
});
