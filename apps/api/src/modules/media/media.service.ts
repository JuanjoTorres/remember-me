import { randomUUID } from 'node:crypto';
import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import {
  type MediaKind,
  type MediaUploadResponse,
  PLAN_CAPABILITIES,
} from '@remember-me/shared-types';
import { ENV } from '../../config/config.module.js';
import type { Env } from '../../config/env.js';
import type { GiftGrantClaims } from '../../shared/auth/gift-grant.service.js';
import { GiftDeletedEvent } from '../../shared/events/contracts.js';
import { EventBus } from '../../shared/events/event-bus.js';
import { AppError } from '../../shared/http/app-error.js';
import { PrismaService } from '../../shared/prisma/prisma.service.js';
import { processAudio, processImage } from './media-processing.js';
import { ObjectStorage } from './object-storage.js';

/** Technical ceiling of stored files per gift; protects the bucket from abuse. */
export const MAX_ASSETS_PER_GIFT = 200;

@Injectable()
export class MediaService implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: ObjectStorage,
    private readonly events: EventBus,
    @Inject(ENV) private readonly env: Env,
  ) {}

  onModuleInit(): void {
    this.events.subscribe(GiftDeletedEvent, 'media', ({ giftId }) => this.deleteAllOf(giftId));
  }

  async upload(
    grant: GiftGrantClaims,
    kind: MediaKind,
    file: Buffer | undefined,
  ): Promise<MediaUploadResponse> {
    if (!file || file.length === 0) throw new AppError('VALIDATION_ERROR', 'A file is required');
    // A draft may use every feature; the plan is settled when it is published. From then on a
    // free gift cannot gain a voice note.
    const planApplies = grant.published;
    if (
      kind === 'AUDIO' &&
      planApplies &&
      !PLAN_CAPABILITIES[grant.plan].cardTypes.includes('AUDIO_NOTE')
    ) {
      throw new AppError('PREMIUM_REQUIRED', 'Voice notes are part of the full experience', {
        capability: 'AUDIO_UPLOAD',
      });
    }
    const media = kind === 'IMAGE' ? await processImage(file) : processAudio(file);
    // The path encodes the gift, which is how the gifts module checks ownership of a URL.
    const storageKey = `gifts/${grant.giftId}/${randomUUID()}.${media.extension}`;

    // The row is reserved first, under a per-gift lock, so that parallel uploads cannot pass the
    // ceiling and every stored object is tracked (and therefore deleted with the gift).
    const asset = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${grant.giftId}))`;
      if ((await tx.mediaAsset.count({ where: { giftId: grant.giftId } })) >= MAX_ASSETS_PER_GIFT) {
        throw new AppError('CONFLICT', 'This gift has reached its storage limit');
      }
      return tx.mediaAsset.create({
        data: {
          giftId: grant.giftId,
          kind,
          storageKey,
          contentType: media.contentType,
          bytes: media.body.length,
        },
      });
    });
    try {
      await this.storage.put(storageKey, media.body, media.contentType);
    } catch (error) {
      await this.prisma.mediaAsset.delete({ where: { id: asset.id } });
      throw error;
    }
    return {
      url: `${this.env.MEDIA_PUBLIC_URL}/${storageKey}`,
      kind,
      contentType: media.contentType,
      bytes: media.body.length,
    };
  }

  /**
   * Idempotent and resumable: each file is forgotten only after it left storage, so a failure
   * half-way is finished by the next delivery of the event.
   */
  async deleteAllOf(giftId: string): Promise<void> {
    const assets = await this.prisma.mediaAsset.findMany({ where: { giftId } });
    for (const asset of assets) {
      await this.storage.delete([asset.storageKey]);
      await this.prisma.mediaAsset.deleteMany({ where: { id: asset.id } });
    }
  }
}
