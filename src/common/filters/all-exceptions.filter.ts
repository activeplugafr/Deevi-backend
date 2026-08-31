import {
  ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { DomainException } from '../errors/domain.exception.js';

/**
 * One error shape for the entire API. Internal details (Postgres messages,
 * stack traces) never reach the client; they are logged against a requestId
 * the client can quote to support.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('Http');

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse();
    const request = ctx.getRequest();
    const requestId = request?.headers?.['x-request-id'] ?? randomUUID();

    let statusCode = HttpStatus.INTERNAL_SERVER_ERROR;
    let code = 'INTERNAL_ERROR';
    let message = 'Something went wrong. Please try again.';
    let details: string[] | undefined;

    if (exception instanceof DomainException) {
      statusCode = exception.getStatus();
      code = exception.code;
      message = exception.message;
      details = exception.details;
    } else if (exception instanceof HttpException) {
      statusCode = exception.getStatus();
      const body = exception.getResponse();

      if (typeof body === 'string') {
        message = body;
      } else if (body && typeof body === 'object') {
        const payload = body as Record<string, unknown>;
        const raw = payload.message;
        if (Array.isArray(raw)) {
          details = raw.map(String);
          message = details[0] ?? 'Validation failed';
          code = 'VALIDATION_FAILED';
        } else if (typeof raw === 'string') {
          message = raw;
        }
        if (typeof payload.code === 'string') code = payload.code;
      }

      if (code === 'INTERNAL_ERROR') code = defaultCodeForStatus(statusCode);
    } else if (exception instanceof Error) {
      this.logger.error(`[${requestId}] ${exception.message}`, exception.stack);
    }

    if (statusCode >= 500) {
      this.logger.error(
        `[${requestId}] ${request?.method} ${request?.url} -> ${statusCode}`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    } else {
      this.logger.warn(`[${requestId}] ${request?.method} ${request?.url} -> ${statusCode} ${code}`);
    }

    response.status(statusCode).json({
      statusCode,
      code,
      message,
      ...(details ? { details } : {}),
      path: request?.url ?? '',
      timestamp: new Date().toISOString(),
      requestId,
    });
  }
}

const defaultCodeForStatus = (status: number): string => {
  switch (status) {
    case HttpStatus.BAD_REQUEST: return 'BAD_REQUEST';
    case HttpStatus.UNAUTHORIZED: return 'UNAUTHENTICATED';
    case HttpStatus.FORBIDDEN: return 'FORBIDDEN';
    case HttpStatus.NOT_FOUND: return 'NOT_FOUND';
    case HttpStatus.CONFLICT: return 'CONFLICT';
    case HttpStatus.UNPROCESSABLE_ENTITY: return 'UNPROCESSABLE';
    case HttpStatus.TOO_MANY_REQUESTS: return 'RATE_LIMITED';
    default: return status >= 500 ? 'INTERNAL_ERROR' : 'REQUEST_FAILED';
  }
};
