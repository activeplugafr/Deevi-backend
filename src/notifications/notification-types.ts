/**
 * Every notification the product emits. Adding a type means adding a template
 * below; the delivery pipeline itself never changes.
 */
export const NotificationType = {
  ARTISAN_APPLICATION_SUBMITTED: 'ARTISAN_APPLICATION_SUBMITTED',
  ARTISAN_APPLICATION_UNDER_REVIEW: 'ARTISAN_APPLICATION_UNDER_REVIEW',
  ARTISAN_APPROVED: 'ARTISAN_APPROVED',
  ARTISAN_REJECTED: 'ARTISAN_REJECTED',
  ARTISAN_SUSPENDED: 'ARTISAN_SUSPENDED',

  JOB_PUBLISHED: 'JOB_PUBLISHED',
  JOB_MATCHING_ARTISANS: 'JOB_MATCHING_ARTISANS',
  APPLICATION_RECEIVED: 'APPLICATION_RECEIVED',
  APPLICATION_SHORTLISTED: 'APPLICATION_SHORTLISTED',
  APPLICATION_REJECTED: 'APPLICATION_REJECTED',
  APPLICATION_WITHDRAWN: 'APPLICATION_WITHDRAWN',
  ARTISAN_SELECTED: 'ARTISAN_SELECTED',
  JOB_ACCEPTED_BY_ARTISAN: 'JOB_ACCEPTED_BY_ARTISAN',
  JOB_DECLINED_BY_ARTISAN: 'JOB_DECLINED_BY_ARTISAN',
  JOB_STATUS_CHANGED: 'JOB_STATUS_CHANGED',
  JOB_COMPLETED: 'JOB_COMPLETED',
  JOB_CANCELLED: 'JOB_CANCELLED',

  NEW_MESSAGE: 'NEW_MESSAGE',
  REVIEW_REMINDER: 'REVIEW_REMINDER',
  REVIEW_RECEIVED: 'REVIEW_RECEIVED',

  REPORT_SUBMITTED: 'REPORT_SUBMITTED',
  REPORT_UPDATED: 'REPORT_UPDATED',
  DISPUTE_OPENED: 'DISPUTE_OPENED',
  DISPUTE_UPDATED: 'DISPUTE_UPDATED',

  SUBSCRIPTION_ACTIVATED: 'SUBSCRIPTION_ACTIVATED',
  SUBSCRIPTION_CANCELLED: 'SUBSCRIPTION_CANCELLED',
  SUBSCRIPTION_PAYMENT_FAILED: 'SUBSCRIPTION_PAYMENT_FAILED',

  ACCOUNT_SUSPENDED: 'ACCOUNT_SUSPENDED',
  SYSTEM_ANNOUNCEMENT: 'SYSTEM_ANNOUNCEMENT',
} as const;
export type NotificationType = (typeof NotificationType)[keyof typeof NotificationType];

export interface NotificationChannels {
  inApp: boolean;
  email: boolean;
  push: boolean;
}

/**
 * Channel policy per type. In-app is always on -- it is the durable record
 * the user sees in the app; email/push are best-effort amplification.
 */
export const NOTIFICATION_CHANNEL_POLICY: Partial<Record<NotificationType, NotificationChannels>> = {
  ARTISAN_APPROVED: { inApp: true, email: true, push: true },
  ARTISAN_REJECTED: { inApp: true, email: true, push: false },
  ARTISAN_SUSPENDED: { inApp: true, email: true, push: false },
  APPLICATION_RECEIVED: { inApp: true, email: true, push: true },
  ARTISAN_SELECTED: { inApp: true, email: true, push: true },
  JOB_ACCEPTED_BY_ARTISAN: { inApp: true, email: true, push: true },
  JOB_DECLINED_BY_ARTISAN: { inApp: true, email: true, push: true },
  JOB_COMPLETED: { inApp: true, email: true, push: true },
  JOB_CANCELLED: { inApp: true, email: true, push: true },
  NEW_MESSAGE: { inApp: true, email: false, push: true },
  REVIEW_REMINDER: { inApp: true, email: true, push: true },
  DISPUTE_OPENED: { inApp: true, email: true, push: false },
  SUBSCRIPTION_ACTIVATED: { inApp: true, email: true, push: false },
  SUBSCRIPTION_PAYMENT_FAILED: { inApp: true, email: true, push: true },
  ACCOUNT_SUSPENDED: { inApp: true, email: true, push: false },
};

export const DEFAULT_CHANNELS: NotificationChannels = { inApp: true, email: false, push: true };

export const channelsFor = (type: string): NotificationChannels =>
  NOTIFICATION_CHANNEL_POLICY[type as NotificationType] ?? DEFAULT_CHANNELS;
