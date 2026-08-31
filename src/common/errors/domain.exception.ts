import { HttpException, HttpStatus } from '@nestjs/common';

/**
 * Business-rule failures carry a stable `code` so the mobile/web client can
 * branch on the reason without string-matching English prose.
 */
export class DomainException extends HttpException {
  constructor(
    public readonly code: string,
    message: string,
    status: HttpStatus = HttpStatus.BAD_REQUEST,
    public readonly details?: string[],
  ) {
    super({ code, message }, status);
  }
}

export class NotFoundError extends DomainException {
  constructor(entity: string, code = `${entity.toUpperCase().replace(/\s+/g, '_')}_NOT_FOUND`) {
    super(code, `${entity} not found`, HttpStatus.NOT_FOUND);
  }
}

export class ForbiddenError extends DomainException {
  constructor(message = 'You do not have permission to perform this action', code = 'FORBIDDEN') {
    super(code, message, HttpStatus.FORBIDDEN);
  }
}

export class ConflictError extends DomainException {
  constructor(code: string, message: string) {
    super(code, message, HttpStatus.CONFLICT);
  }
}

export class InvalidStateError extends DomainException {
  constructor(message: string, code = 'INVALID_STATE') {
    super(code, message, HttpStatus.CONFLICT);
  }
}
