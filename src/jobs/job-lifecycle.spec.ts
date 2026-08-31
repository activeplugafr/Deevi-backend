import { describe, expect, it } from 'vitest';
import {
  assertJobPostTransition, assertJobTransition, canTransitionJob, canTransitionJobPost,
  JOB_POST_TRANSITIONS, type JobPostStatus,
} from './job-lifecycle.js';

describe('job post state machine', () => {
  describe('valid transitions', () => {
    it('lets a customer publish a draft', () => {
      expect(canTransitionJobPost('DRAFT', 'PUBLISHED', 'CUSTOMER')).toBe(true);
    });

    it('lets a customer select an artisan on an open post', () => {
      expect(canTransitionJobPost('PUBLISHED', 'ARTISAN_SELECTED', 'CUSTOMER')).toBe(true);
      expect(canTransitionJobPost('RECEIVING_APPLICATIONS', 'ARTISAN_SELECTED', 'CUSTOMER')).toBe(true);
    });

    it('returns a declined job to the market instead of killing it', () => {
      expect(canTransitionJobPost('ARTISAN_SELECTED', 'RECEIVING_APPLICATIONS', 'ARTISAN')).toBe(true);
    });

    it('lets the system expire an open post', () => {
      expect(canTransitionJobPost('PUBLISHED', 'EXPIRED', 'SYSTEM')).toBe(true);
    });
  });

  describe('invalid transitions', () => {
    it('refuses to skip straight from DRAFT to COMPLETED', () => {
      expect(canTransitionJobPost('DRAFT', 'COMPLETED', 'CUSTOMER')).toBe(false);
      expect(() => assertJobPostTransition('DRAFT', 'COMPLETED', 'CUSTOMER')).toThrow(/cannot move to COMPLETED/);
    });

    it('refuses to reopen a cancelled job', () => {
      expect(canTransitionJobPost('CANCELLED', 'PUBLISHED', 'CUSTOMER')).toBe(false);
      expect(canTransitionJobPost('CANCELLED', 'RECEIVING_APPLICATIONS', 'ADMIN')).toBe(false);
    });

    it('treats CANCELLED as terminal for every actor', () => {
      const actors = ['CUSTOMER', 'ARTISAN', 'ADMIN', 'SYSTEM'] as const;
      const targets = Object.keys(JOB_POST_TRANSITIONS) as JobPostStatus[];
      for (const actor of actors) {
        for (const target of targets) {
          expect(canTransitionJobPost('CANCELLED', target, actor)).toBe(false);
        }
      }
    });

    it('refuses to un-complete a job', () => {
      expect(canTransitionJobPost('COMPLETED', 'IN_PROGRESS', 'CUSTOMER')).toBe(false);
      expect(canTransitionJobPost('COMPLETED', 'PUBLISHED', 'ADMIN')).toBe(false);
    });

    it('refuses to apply-select on a job that is already accepted', () => {
      expect(canTransitionJobPost('ACCEPTED', 'ARTISAN_SELECTED', 'CUSTOMER')).toBe(false);
    });
  });

  describe('actor permissions', () => {
    it('does not let an artisan publish or cancel the post itself', () => {
      expect(canTransitionJobPost('DRAFT', 'PUBLISHED', 'ARTISAN')).toBe(false);
      expect(canTransitionJobPost('PUBLISHED', 'CANCELLED', 'ARTISAN')).toBe(false);
    });

    it('does not let an artisan select themselves', () => {
      expect(canTransitionJobPost('RECEIVING_APPLICATIONS', 'ARTISAN_SELECTED', 'ARTISAN')).toBe(false);
    });

    it('does not let an artisan mark the job complete', () => {
      expect(canTransitionJobPost('IN_PROGRESS', 'COMPLETED', 'ARTISAN')).toBe(false);
      expect(canTransitionJobPost('IN_PROGRESS', 'COMPLETED', 'CUSTOMER')).toBe(true);
    });

    it('only lets an admin resolve a dispute', () => {
      expect(canTransitionJobPost('DISPUTED', 'COMPLETED', 'ADMIN')).toBe(true);
      expect(canTransitionJobPost('DISPUTED', 'COMPLETED', 'CUSTOMER')).toBe(false);
      expect(canTransitionJobPost('DISPUTED', 'CANCELLED', 'ARTISAN')).toBe(false);
    });
  });

  describe('error messages', () => {
    it('tells the caller what they can do instead', () => {
      expect(() => assertJobPostTransition('IN_PROGRESS', 'PUBLISHED', 'CUSTOMER'))
        .toThrow(/You can move it to: COMPLETED, CANCELLED, DISPUTED/);
    });

    it('says plainly when an actor cannot touch the job at all', () => {
      expect(() => assertJobPostTransition('COMPLETED', 'CANCELLED', 'SYSTEM'))
        .toThrow(/cannot be changed by a system/);
    });
  });
});

describe('engagement state machine', () => {
  it('requires the artisan to accept before work starts', () => {
    expect(canTransitionJob('PENDING_ACCEPTANCE', 'ACCEPTED', 'ARTISAN')).toBe(true);
    expect(canTransitionJob('PENDING_ACCEPTANCE', 'IN_PROGRESS', 'ARTISAN')).toBe(false);
    expect(canTransitionJob('PENDING_ACCEPTANCE', 'COMPLETED', 'CUSTOMER')).toBe(false);
  });

  it('does not let the customer accept on the artisan behalf', () => {
    expect(canTransitionJob('PENDING_ACCEPTANCE', 'ACCEPTED', 'CUSTOMER')).toBe(false);
  });

  it('reserves completion for the customer and admins', () => {
    expect(canTransitionJob('IN_PROGRESS', 'COMPLETED', 'CUSTOMER')).toBe(true);
    expect(canTransitionJob('IN_PROGRESS', 'COMPLETED', 'ADMIN')).toBe(true);
    expect(canTransitionJob('IN_PROGRESS', 'COMPLETED', 'ARTISAN')).toBe(false);
  });

  it('lets either party cancel or dispute a live engagement', () => {
    expect(canTransitionJob('ACCEPTED', 'CANCELLED', 'ARTISAN')).toBe(true);
    expect(canTransitionJob('ACCEPTED', 'DISPUTED', 'CUSTOMER')).toBe(true);
  });

  it('throws on an invalid engagement transition', () => {
    expect(() => assertJobTransition('COMPLETED', 'IN_PROGRESS', 'CUSTOMER')).toThrow();
    expect(() => assertJobTransition('CANCELLED', 'ACCEPTED', 'ADMIN')).toThrow();
  });
});
