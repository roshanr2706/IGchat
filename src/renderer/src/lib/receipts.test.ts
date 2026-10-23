import { describe, expect, it } from 'vitest';
import { makeText, makeThread, makeUser } from '../../../shared/test/factories';
import { readLabels } from './receipts';

const now = new Date(2026, 9, 8, 18, 0).getTime();
const alex = makeUser({ id: 'alex', fullName: 'Alex' });
const sam = makeUser({ id: 'sam', fullName: 'Sam' });
const users = new Map([alex, sam].map((u) => [u.id, u]));
const msgs = [
  makeText({ id: 'a', senderId: 'me', timestamp: now - 3000 }),
  makeText({ id: 'b', senderId: 'alex', timestamp: now - 2500 }),
  makeText({ id: 'c', senderId: 'me', timestamp: now - 2000 }),
  makeText({ id: 'd', senderId: 'me', timestamp: now - 1000 })
];

describe('readLabels', () => {
  it('in a DM, gives the newest read message the read time and earlier ones a plain "Read"', () => {
    const at = new Date(2026, 9, 8, 15, 42).getTime();
    const thread = makeThread({ participants: [alex], readReceipts: [{ userId: 'alex', watermark: now - 2000, at }] });
    const labels = readLabels(thread, msgs, 'me', users, now);
    expect(labels.get('a')).toBe('Read');
    expect(labels.get('c')).toMatch(/^Read at 3:42\sPM$/);
    expect(labels.has('b')).toBe(false);
    expect(labels.has('d')).toBe(false);
  });

  it('in a group, names who has read each message', () => {
    const thread = makeThread({
      participants: [alex, sam],
      isGroup: true,
      readReceipts: [
        { userId: 'alex', watermark: now, at: now },
        { userId: 'sam', watermark: now - 2000, at: now }
      ]
    });
    const labels = readLabels(thread, msgs, 'me', users, now);
    expect(labels.get('c')).toBe('Read by everyone');
    expect(labels.get('d')).toBe('Read by Alex');
  });

  it('is empty without receipts', () => {
    expect(readLabels(makeThread({ participants: [alex] }), msgs, 'me', users, now).size).toBe(0);
  });
});
