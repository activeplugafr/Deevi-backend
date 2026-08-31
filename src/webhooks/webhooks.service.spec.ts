import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createHmac } from 'node:crypto';
import { WebhooksService } from './webhooks.service.js';
import { MockPaymentProvider } from '../subscriptions/providers/mock-payment.provider.js';
import { createMockDb, createMockQueue, type MockDb } from '../../test/helpers/mock-db.js';

const SECRET = process.env.PAYMENT_WEBHOOK_SECRET ?? 'deevi-mock-webhook-secret';
const sign = (body: string) => createHmac('sha512', SECRET).update(body).digest('hex');

describe('WebhooksService', () => {
  let db: MockDb;
  let queue: ReturnType<typeof createMockQueue>;
  let subscriptions: any;
  let service: WebhooksService;

  beforeEach(() => {
    db = createMockDb();
    queue = createMockQueue();
    subscriptions = {
      provider: new MockPaymentProvider(),
      providerName: 'MOCK',
      activateByReference: vi.fn().mockResolvedValue({ id: 'sub-1' }),
      markPaymentFailed: vi.fn().mockResolvedValue('sub-1'),
    };
    service = new WebhooksService(db as any, queue as any, subscriptions);
  });

  describe('ingestion', () => {
    const payload = { event: 'charge.success', data: { reference: 'ref-1' }, id: 'evt-1' };
    const body = JSON.stringify(payload);

    it('stores and queues a correctly signed event', async () => {
      db.from.mockReturnValue({
        insert: () => ({ select: () => ({ maybeSingle: () => Promise.resolve({ data: { id: 'we-1' }, error: null }) }) }),
      } as any);

      const result = await service.ingest('payments', body, sign(body), {}, payload);

      expect(result).toMatchObject({ received: true, duplicate: false, signatureValid: true });
      expect(queue.enqueue).toHaveBeenCalledWith('webhook.process',
        { webhookEventId: 'we-1' }, expect.objectContaining({ maxAttempts: 5 }));
    });

    it('records a badly signed event but never processes it', async () => {
      let stored: any;
      db.from.mockReturnValue({
        insert: (values: any) => {
          stored = values;
          return { select: () => ({ maybeSingle: () => Promise.resolve({ data: { id: 'we-2' }, error: null }) }) };
        },
      } as any);

      const result = await service.ingest('payments', body, 'wrong-signature', {}, payload);

      expect(result.signatureValid).toBe(false);
      expect(stored.status).toBe('REJECTED');
      // A run of bad signatures is a security signal, so it is kept, not dropped.
      expect(stored.signature_valid).toBe(false);
      expect(queue.enqueue).not.toHaveBeenCalled();
    });

    it('treats a repeat delivery as a duplicate rather than double-processing', async () => {
      db.from.mockReturnValue({
        insert: () => ({
          select: () => ({
            maybeSingle: () => Promise.resolve({ data: null, error: { code: '23505', message: 'duplicate key' } }),
          }),
        }),
      } as any);

      const result = await service.ingest('payments', body, sign(body), {}, payload);

      expect(result.duplicate).toBe(true);
      expect(queue.enqueue).not.toHaveBeenCalled();
    });

    it('rejects an unknown provider', async () => {
      db.from.mockReturnValue({
        insert: () => ({ select: () => ({ maybeSingle: () => Promise.resolve({ data: { id: 'we-3' }, error: null }) }) }),
      } as any);

      const result = await service.ingest('mystery-psp', body, sign(body), {}, payload);
      expect(result.signatureValid).toBe(false);
    });

    it('redacts sensitive headers before storing them', async () => {
      let stored: any;
      db.from.mockReturnValue({
        insert: (values: any) => {
          stored = values;
          return { select: () => ({ maybeSingle: () => Promise.resolve({ data: { id: 'we-4' }, error: null }) }) };
        },
      } as any);

      await service.ingest('payments', body, sign(body), {
        authorization: 'Bearer super-secret',
        cookie: 'session=abc',
        'x-request-id': 'req-1',
      }, payload);

      expect(stored.headers).not.toHaveProperty('authorization');
      expect(stored.headers).not.toHaveProperty('cookie');
      expect(stored.headers).toHaveProperty('x-request-id');
    });
  });

  describe('processing', () => {
    it('does nothing for an event already processed', async () => {
      db.maybeOne.mockResolvedValueOnce({ id: 'we-1', status: 'PROCESSED', event_type: 'charge.success' });
      await service.process('we-1');
      expect(subscriptions.activateByReference).not.toHaveBeenCalled();
    });

    it('activates the subscription on a successful charge', async () => {
      db.maybeOne.mockResolvedValueOnce({
        id: 'we-1', provider: 'MOCK', status: 'RECEIVED', attempts: 0,
        event_type: 'charge.success', payload: { data: { reference: 'ref-1' } },
      });

      await service.process('we-1');
      expect(subscriptions.activateByReference).toHaveBeenCalledWith('ref-1', undefined);
    });

    it('marks a failed charge as such', async () => {
      db.maybeOne.mockResolvedValueOnce({
        id: 'we-2', provider: 'MOCK', status: 'RECEIVED', attempts: 0,
        event_type: 'charge.failed', payload: { data: { reference: 'ref-2', gateway_response: 'Declined' } },
      });

      await service.process('we-2');
      expect(subscriptions.markPaymentFailed).toHaveBeenCalledWith('ref-2', 'Declined');
    });

    it('ignores an event that carries no reference', async () => {
      db.maybeOne.mockResolvedValueOnce({
        id: 'we-3', provider: 'MOCK', status: 'RECEIVED', attempts: 0,
        event_type: 'charge.success', payload: {},
      });

      await expect(service.process('we-3')).resolves.toBeUndefined();
      expect(subscriptions.activateByReference).not.toHaveBeenCalled();
    });

    it('rethrows so the queue can apply its backoff', async () => {
      db.maybeOne.mockResolvedValueOnce({
        id: 'we-4', provider: 'MOCK', status: 'RECEIVED', attempts: 1,
        event_type: 'charge.success', payload: { data: { reference: 'ref-4' } },
      });
      subscriptions.activateByReference.mockRejectedValueOnce(new Error('database down'));

      await expect(service.process('we-4')).rejects.toThrow(/database down/);
    });

    it('does not fall over on an unknown event type', async () => {
      db.maybeOne.mockResolvedValueOnce({
        id: 'we-5', provider: 'MOCK', status: 'RECEIVED', attempts: 0,
        event_type: 'customeridentification.success', payload: { data: { reference: 'ref-5' } },
      });

      await expect(service.process('we-5')).resolves.toBeUndefined();
    });
  });
});
