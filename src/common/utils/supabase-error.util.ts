import { HttpStatus, InternalServerErrorException, Logger } from '@nestjs/common';
import type { PostgrestError } from '@supabase/supabase-js';
import { ConflictError, DomainException, NotFoundError } from '../errors/domain.exception.js';

const logger = new Logger('Database');

/**
 * Translates Postgres/PostgREST failures into the API's error vocabulary.
 * Raw driver messages are logged, never returned -- they leak schema details.
 */
export const translateDbError = (error: PostgrestError | null, context: string): never => {
  if (!error) throw new InternalServerErrorException('Unknown database error');

  logger.error(`${context}: [${error.code}] ${error.message} ${error.details ?? ''}`);

  switch (error.code) {
    case '23505': // unique_violation
      throw new ConflictError('DUPLICATE_RECORD', friendlyUniqueMessage(error.message));
    case '23503': // foreign_key_violation
      throw new DomainException('INVALID_REFERENCE', 'A referenced record does not exist', HttpStatus.BAD_REQUEST);
    case '23514': // check_violation
      throw new DomainException('CONSTRAINT_VIOLATION', 'The submitted values are not allowed', HttpStatus.BAD_REQUEST);
    case '23502': // not_null_violation
      throw new DomainException('MISSING_REQUIRED_FIELD', 'A required field is missing', HttpStatus.BAD_REQUEST);
    case 'PGRST116': // no rows for .single()
      throw new NotFoundError('Record');
    case '42501':
      throw new DomainException('DATABASE_PERMISSION_DENIED', 'Operation not permitted', HttpStatus.FORBIDDEN);
    case '40001':
    case '40P01':
      throw new ConflictError('CONCURRENT_MODIFICATION', 'Another update happened first. Please retry.');
    default:
      break;
  }

  // Errors raised deliberately by our own PL/pgSQL functions.
  const raised = extractRaisedCode(error.message);
  if (raised) throw mapRaisedCode(raised);

  throw new InternalServerErrorException('A database error occurred');
};

const friendlyUniqueMessage = (message: string): string => {
  if (message.includes('job_applications_unique_bid_idx')) return 'You have already applied to this job';
  if (message.includes('job_applications_single_accepted_idx')) return 'An artisan has already been selected for this job';
  if (message.includes('reviews_unique_per_job_idx')) return 'You have already reviewed this job';
  if (message.includes('conversations_unique_pair_idx')) return 'A conversation already exists for this job and artisan';
  if (message.includes('artisan_applications_one_open_idx')) return 'You already have an application in progress';
  if (message.includes('subscriptions_one_live_per_artisan_idx')) return 'You already have an active subscription';
  if (message.includes('users_email_unique_idx')) return 'An account with this email already exists';
  if (message.includes('locations_one_default_per_user')) return 'You already have a default location';
  if (message.includes('disputes_one_open_per_job_idx')) return 'A dispute is already open for this job';
  return 'This record already exists';
};

const extractRaisedCode = (message: string): string | null => {
  const match = message.match(/([A-Z_]{4,}(?::[A-Z_]+)?)/);
  return match ? match[1] : null;
};

const mapRaisedCode = (raised: string): DomainException => {
  const [code, detail] = raised.split(':');
  switch (code) {
    case 'JOB_POST_NOT_FOUND':
      return new NotFoundError('Job post', 'JOB_POST_NOT_FOUND');
    case 'APPLICATION_NOT_FOUND':
      return new NotFoundError('Application', 'APPLICATION_NOT_FOUND');
    case 'CONVERSATION_NOT_FOUND':
      return new NotFoundError('Conversation', 'CONVERSATION_NOT_FOUND');
    case 'NOT_JOB_OWNER':
      return new DomainException('NOT_JOB_OWNER', 'You do not own this job post', HttpStatus.FORBIDDEN);
    case 'NOT_CONVERSATION_PARTICIPANT':
      return new DomainException('NOT_CONVERSATION_PARTICIPANT', 'You are not part of this conversation', HttpStatus.FORBIDDEN);
    case 'ARTISAN_ALREADY_SELECTED':
      return new ConflictError('ARTISAN_ALREADY_SELECTED', 'An artisan has already been selected for this job');
    case 'INVALID_JOB_STATUS':
      return new ConflictError('INVALID_JOB_STATUS', `This job cannot accept a selection while it is ${detail ?? 'in its current state'}`);
    case 'INVALID_APPLICATION_STATUS':
      return new ConflictError('INVALID_APPLICATION_STATUS', `This application cannot be accepted while it is ${detail ?? 'in its current state'}`);
    default:
      return new DomainException('DATABASE_ERROR', 'A database error occurred', HttpStatus.INTERNAL_SERVER_ERROR);
  }
};
