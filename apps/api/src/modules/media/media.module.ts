import { Module } from '@nestjs/common';
import { MediaController } from './media.controller.js';
import { MediaService } from './media.service.js';
import { ObjectStorage } from './object-storage.js';
import { S3ObjectStorage } from './s3-object-storage.js';

@Module({
  controllers: [MediaController],
  providers: [MediaService, { provide: ObjectStorage, useClass: S3ObjectStorage }],
})
export class MediaModule {}
