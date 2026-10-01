import { expect, test } from 'bun:test';
import { InboxMessage, OutboxMessage } from '../../src/domain/messages';
import { WagerTransactionProcessed } from '../../src/domain/events';
import { WagerStatus } from '../../src/domain/constants/wager';

test('inbox acknowledgement and outbox publication cannot be applied twice', () => {
  const at = new Date('2026-09-30T00:00:00Z');

  const inbox = InboxMessage.receive({
    consumerName: 'test',
    messageId: 'id',
    payloadHash: 'hash',
    receivedAt: at,
  });

  expect(inbox.isProcessed()).toBe(false);

  inbox.markProcessed(at);

  expect(() => inbox.markProcessed(at)).toThrow('INBOX_ALREADY_PROCESSED');

  const event = WagerTransactionProcessed.from(
    { eventId: 'e', aggregateId: 'w', correlationId: 'c', occurredAt: at },
    {
      transactionId: 't',
      providerId: 'p',
      status: WagerStatus.PROCESSED,
      balance: { amount: '0.00', currency: 'BRL' },
    },
  );

  const outbox = OutboxMessage.enqueue(event);

  expect(Object.isFrozen(outbox.payload)).toBe(true);

  outbox.scheduleRetry(at);

  expect(outbox.attempts).toBe(1);
  expect(outbox.isDue(at)).toBe(false);
  expect(outbox.isDue(new Date(at.getTime() + 1000))).toBe(true);

  outbox.markPublished(at);

  expect(() => outbox.markPublished(at)).toThrow('OUTBOX_ALREADY_PUBLISHED');
  expect(() => outbox.scheduleRetry(at)).toThrow('OUTBOX_ALREADY_PUBLISHED');
});
