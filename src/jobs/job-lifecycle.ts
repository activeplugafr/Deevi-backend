import { HttpStatus } from '@nestjs/common';
import { DomainException } from '../common/errors/domain.exception.js';

export const JobPostStatus = {
  DRAFT: 'DRAFT',
  PUBLISHED: 'PUBLISHED',
  RECEIVING_APPLICATIONS: 'RECEIVING_APPLICATIONS',
  ARTISAN_SELECTED: 'ARTISAN_SELECTED',
  ACCEPTED: 'ACCEPTED',
  IN_PROGRESS: 'IN_PROGRESS',
  COMPLETED: 'COMPLETED',
  CANCELLED: 'CANCELLED',
  DISPUTED: 'DISPUTED',
  EXPIRED: 'EXPIRED',
} as const;
export type JobPostStatus = (typeof JobPostStatus)[keyof typeof JobPostStatus];

export const JobStatus = {
  PENDING_ACCEPTANCE: 'PENDING_ACCEPTANCE',
  ACCEPTED: 'ACCEPTED',
  IN_PROGRESS: 'IN_PROGRESS',
  COMPLETED: 'COMPLETED',
  CANCELLED: 'CANCELLED',
  DISPUTED: 'DISPUTED',
} as const;
export type JobStatus = (typeof JobStatus)[keyof typeof JobStatus];

export type Actor = 'CUSTOMER' | 'ARTISAN' | 'ADMIN' | 'SYSTEM';

/**
 * The job post state machine, written out explicitly.
 *
 * Encoding transitions as data rather than scattering `if (status === ...)`
 * across services means an invalid move is impossible to express, and the
 * rules are reviewable in one place.
 */
export const JOB_POST_TRANSITIONS: Record<JobPostStatus, Partial<Record<JobPostStatus, Actor[]>>> = {
  DRAFT: {
    PUBLISHED: ['CUSTOMER', 'ADMIN'],
    CANCELLED: ['CUSTOMER', 'ADMIN'],
  },
  PUBLISHED: {
    RECEIVING_APPLICATIONS: ['SYSTEM'],
    ARTISAN_SELECTED: ['CUSTOMER'],
    CANCELLED: ['CUSTOMER', 'ADMIN'],
    EXPIRED: ['SYSTEM'],
    DRAFT: ['CUSTOMER'],
  },
  RECEIVING_APPLICATIONS: {
    ARTISAN_SELECTED: ['CUSTOMER'],
    CANCELLED: ['CUSTOMER', 'ADMIN'],
    EXPIRED: ['SYSTEM'],
  },
  ARTISAN_SELECTED: {
    ACCEPTED: ['ARTISAN', 'SYSTEM'],
    // The artisan declining returns the post to the market.
    RECEIVING_APPLICATIONS: ['ARTISAN', 'SYSTEM', 'ADMIN'],
    CANCELLED: ['CUSTOMER', 'ADMIN'],
    DISPUTED: ['CUSTOMER', 'ARTISAN', 'ADMIN'],
  },
  ACCEPTED: {
    IN_PROGRESS: ['ARTISAN', 'CUSTOMER'],
    CANCELLED: ['CUSTOMER', 'ARTISAN', 'ADMIN'],
    DISPUTED: ['CUSTOMER', 'ARTISAN', 'ADMIN'],
  },
  IN_PROGRESS: {
    COMPLETED: ['CUSTOMER', 'ADMIN'],
    CANCELLED: ['CUSTOMER', 'ARTISAN', 'ADMIN'],
    DISPUTED: ['CUSTOMER', 'ARTISAN', 'ADMIN'],
  },
  COMPLETED: {
    DISPUTED: ['CUSTOMER', 'ARTISAN', 'ADMIN'],
  },
  CANCELLED: {},
  DISPUTED: {
    // Only an admin resolves a dispute, in either direction.
    COMPLETED: ['ADMIN'],
    CANCELLED: ['ADMIN'],
    IN_PROGRESS: ['ADMIN'],
  },
  EXPIRED: {
    PUBLISHED: ['CUSTOMER'],
    CANCELLED: ['CUSTOMER', 'ADMIN'],
  },
};

/** Mirror of the above for the engagement record. */
export const JOB_TRANSITIONS: Record<JobStatus, Partial<Record<JobStatus, Actor[]>>> = {
  PENDING_ACCEPTANCE: {
    ACCEPTED: ['ARTISAN'],
    CANCELLED: ['CUSTOMER', 'ARTISAN', 'ADMIN'],
  },
  ACCEPTED: {
    IN_PROGRESS: ['ARTISAN', 'CUSTOMER'],
    CANCELLED: ['CUSTOMER', 'ARTISAN', 'ADMIN'],
    DISPUTED: ['CUSTOMER', 'ARTISAN', 'ADMIN'],
  },
  IN_PROGRESS: {
    COMPLETED: ['CUSTOMER', 'ADMIN'],
    CANCELLED: ['CUSTOMER', 'ARTISAN', 'ADMIN'],
    DISPUTED: ['CUSTOMER', 'ARTISAN', 'ADMIN'],
  },
  COMPLETED: { DISPUTED: ['CUSTOMER', 'ARTISAN', 'ADMIN'] },
  CANCELLED: {},
  DISPUTED: { COMPLETED: ['ADMIN'], CANCELLED: ['ADMIN'], IN_PROGRESS: ['ADMIN'] },
};

export const canTransitionJobPost = (from: JobPostStatus, to: JobPostStatus, actor: Actor): boolean =>
  Boolean(JOB_POST_TRANSITIONS[from]?.[to]?.includes(actor));

export const canTransitionJob = (from: JobStatus, to: JobStatus, actor: Actor): boolean =>
  Boolean(JOB_TRANSITIONS[from]?.[to]?.includes(actor));

/** Throws a precise, actionable error instead of a generic 400. */
export const assertJobPostTransition = (from: JobPostStatus, to: JobPostStatus, actor: Actor): void => {
  if (canTransitionJobPost(from, to, actor)) return;

  const allowed = Object.keys(JOB_POST_TRANSITIONS[from] ?? {});
  const allowedForActor = allowed.filter((next) =>
    JOB_POST_TRANSITIONS[from]?.[next as JobPostStatus]?.includes(actor));

  throw new DomainException(
    'INVALID_STATUS_TRANSITION',
    allowedForActor.length
      ? `A ${from} job cannot move to ${to}. You can move it to: ${allowedForActor.join(', ')}.`
      : `A ${from} job cannot be changed by a ${actor.toLowerCase()}.`,
    HttpStatus.CONFLICT,
  );
};

export const assertJobTransition = (from: JobStatus, to: JobStatus, actor: Actor): void => {
  if (canTransitionJob(from, to, actor)) return;

  const allowedForActor = Object.keys(JOB_TRANSITIONS[from] ?? {})
    .filter((next) => JOB_TRANSITIONS[from]?.[next as JobStatus]?.includes(actor));

  throw new DomainException(
    'INVALID_STATUS_TRANSITION',
    allowedForActor.length
      ? `A ${from} job cannot move to ${to}. You can move it to: ${allowedForActor.join(', ')}.`
      : `A ${from} job cannot be changed by a ${actor.toLowerCase()}.`,
    HttpStatus.CONFLICT,
  );
};

/** Statuses at which a job post is still open to applications. */
export const OPEN_JOB_POST_STATUSES: JobPostStatus[] = ['PUBLISHED', 'RECEIVING_APPLICATIONS'];
