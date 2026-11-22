import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  Logger,
} from '@nestjs/common';
import type { ApiError } from '@remember-me/shared-types';
import type { Response } from 'express';
import { AppError, codeForStatus } from './app-error.js';

/** Turns every failure into the shared `ApiError` body. Unexpected errors never leak details. */
@Catch()
export class AppExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('Http');

  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    const { status, body } = this.toResponse(exception);
    response.status(status).json(body);
  }

  private toResponse(exception: unknown): { status: number; body: ApiError } {
    if (exception instanceof AppError) {
      return {
        status: exception.status,
        body: { code: exception.code, message: exception.message, details: exception.details },
      };
    }
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      return { status, body: { code: codeForStatus(status), message: exception.message } };
    }
    this.logger.error(
      exception instanceof Error ? (exception.stack ?? exception.message) : exception,
    );
    return { status: 500, body: { code: 'INTERNAL', message: 'Something went wrong' } };
  }
}
