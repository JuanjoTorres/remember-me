import { Controller, Get, HttpStatus, Res } from '@nestjs/common';
import type { HealthResponse } from '@remember-me/shared-types';
import type { Response } from 'express';
import { PrismaService } from '../shared/prisma/prisma.service.js';

@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async check(@Res({ passthrough: true }) res: Response): Promise<HealthResponse> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return { status: 'ok', database: 'up' };
    } catch {
      res.status(HttpStatus.SERVICE_UNAVAILABLE);
      return { status: 'ok', database: 'down' };
    }
  }
}
