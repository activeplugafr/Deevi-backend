import { NotificationType } from './notification-types.js';

export interface TemplateInput {
  actorName?: string;
  jobTitle?: string;
  serviceName?: string;
  reason?: string;
  amount?: string;
  status?: string;
  messagePreview?: string;
  reference?: string;
  [key: string]: unknown;
}

export interface RenderedNotification {
  title: string;
  body: string;
  emailSubject: string;
  emailBody: string;
}

const name = (v?: string) => v ?? 'Someone';
const job = (v?: string) => v ?? 'your job';

/**
 * Copy lives in one place so in-app, email and push always say the same
 * thing. Deliberately plain English -- this is read on small screens.
 */
export const renderNotification = (
  type: string,
  input: TemplateInput = {},
): RenderedNotification => {
  switch (type) {
    case NotificationType.ARTISAN_APPLICATION_SUBMITTED:
      return wrap(
        'Application submitted',
        'Your artisan application is in the queue. We will let you know once it has been reviewed.',
      );
    case NotificationType.ARTISAN_APPLICATION_UNDER_REVIEW:
      return wrap('Application under review', 'A Deevi verification officer is reviewing your application now.');
    case NotificationType.ARTISAN_APPROVED:
      return wrap(
        'You are approved on Deevi',
        'Your artisan account is verified. You can now see matching jobs and start applying.',
      );
    case NotificationType.ARTISAN_REJECTED:
      return wrap(
        'Application not approved',
        input.reason
          ? `Your application was not approved. Reason: ${input.reason}`
          : 'Your application was not approved. You can update your details and apply again.',
      );
    case NotificationType.ARTISAN_SUSPENDED:
      return wrap(
        'Account suspended',
        input.reason ? `Your artisan account was suspended: ${input.reason}` : 'Your artisan account was suspended.',
      );

    case NotificationType.JOB_PUBLISHED:
      return wrap('Job published', `"${job(input.jobTitle)}" is live. Matching artisans can now see it and apply.`);
    case NotificationType.APPLICATION_RECEIVED:
      return wrap(
        'New application received',
        `${name(input.actorName)} applied to "${job(input.jobTitle)}".`,
      );
    case NotificationType.APPLICATION_SHORTLISTED:
      return wrap('You have been shortlisted', `You were shortlisted for "${job(input.jobTitle)}".`);
    case NotificationType.APPLICATION_REJECTED:
      return wrap(
        'Application not selected',
        `The customer chose another artisan for "${job(input.jobTitle)}". More jobs are waiting in your feed.`,
      );
    case NotificationType.APPLICATION_WITHDRAWN:
      return wrap(
        'Application withdrawn',
        `${name(input.actorName)} withdrew their application for "${job(input.jobTitle)}".`,
      );
    case NotificationType.ARTISAN_SELECTED:
      return wrap(
        'You got the job',
        `${name(input.actorName)} selected you for "${job(input.jobTitle)}". Accept it to get started.`,
      );
    case NotificationType.JOB_ACCEPTED_BY_ARTISAN:
      return wrap('Artisan accepted the job', `${name(input.actorName)} accepted "${job(input.jobTitle)}".`);
    case NotificationType.JOB_DECLINED_BY_ARTISAN:
      return wrap(
        'Artisan declined the job',
        `${name(input.actorName)} declined "${job(input.jobTitle)}". Your job is open for applications again.`,
      );
    case NotificationType.JOB_STATUS_CHANGED:
      return wrap('Job updated', `"${job(input.jobTitle)}" is now ${String(input.status ?? 'updated').toLowerCase().replace(/_/g, ' ')}.`);
    case NotificationType.JOB_COMPLETED:
      return wrap('Job completed', `"${job(input.jobTitle)}" is marked complete.`);
    case NotificationType.JOB_CANCELLED:
      return wrap(
        'Job cancelled',
        input.reason ? `"${job(input.jobTitle)}" was cancelled: ${input.reason}` : `"${job(input.jobTitle)}" was cancelled.`,
      );

    case NotificationType.NEW_MESSAGE:
      return wrap(
        `New message from ${name(input.actorName)}`,
        input.messagePreview ? String(input.messagePreview) : 'You have a new message.',
      );
    case NotificationType.REVIEW_REMINDER:
      return wrap('How did it go?', `Leave a review for "${job(input.jobTitle)}" to help other customers.`);
    case NotificationType.REVIEW_RECEIVED:
      return wrap('You received a review', `${name(input.actorName)} reviewed your work on "${job(input.jobTitle)}".`);

    case NotificationType.REPORT_SUBMITTED:
      return wrap('Report received', `We received your report${input.reference ? ` (${input.reference})` : ''}. Our team will look into it.`);
    case NotificationType.REPORT_UPDATED:
      return wrap('Report update', `Your report${input.reference ? ` (${input.reference})` : ''} is now ${String(input.status ?? 'updated').toLowerCase().replace(/_/g, ' ')}.`);
    case NotificationType.DISPUTE_OPENED:
      return wrap('Dispute opened', `A dispute was opened on "${job(input.jobTitle)}". Deevi support will be in touch.`);
    case NotificationType.DISPUTE_UPDATED:
      return wrap('Dispute update', `The dispute on "${job(input.jobTitle)}" is now ${String(input.status ?? 'updated').toLowerCase().replace(/_/g, ' ')}.`);

    case NotificationType.SUBSCRIPTION_ACTIVATED:
      return wrap('Premium is active', 'Your Deevi Premium subscription is active. Enjoy unlimited applications.');
    case NotificationType.SUBSCRIPTION_CANCELLED:
      return wrap('Subscription cancelled', 'Your Deevi Premium subscription has been cancelled.');
    case NotificationType.SUBSCRIPTION_PAYMENT_FAILED:
      return wrap('Payment failed', 'We could not process your subscription payment. Please update your payment details.');

    case NotificationType.ACCOUNT_SUSPENDED:
      return wrap(
        'Account suspended',
        input.reason ? `Your Deevi account was suspended: ${input.reason}` : 'Your Deevi account was suspended.',
      );

    default:
      return wrap('Deevi update', String(input.messagePreview ?? 'You have a new update on Deevi.'));
  }
};

const wrap = (title: string, body: string): RenderedNotification => ({
  title,
  body,
  emailSubject: `Deevi - ${title}`,
  emailBody: `${title}\n\n${body}\n\n-- \nDeevi`,
});
