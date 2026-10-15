import { describe, expect, it } from 'vitest';
import type { Message } from '../../../shared/types';
import { makeText } from '../../../shared/test/factories';
import { buildRows, type ListRow } from './grouping';

const t0 = new Date(2026, 9, 8, 12, 0).getTime();
const dayLabel = (ts: number): string => new Date(ts).toDateString();
const headers = (rows: ListRow[]): boolean[] => rows.filter((r) => r.type === 'message').map((r) => (r.type === 'message' ? r.showHeader : false));

describe('buildRows', () => {
  it('groups consecutive messages from the same sender within 7 minutes', () => {
    const msgs = [
      makeText({ senderId: 'a', timestamp: t0 }),
      makeText({ senderId: 'a', timestamp: t0 + 60_000 }),
      makeText({ senderId: 'a', timestamp: t0 + 9 * 60_000 }),
      makeText({ senderId: 'b', timestamp: t0 + 10 * 60_000 })
    ];
    expect(headers(buildRows(msgs, { dayLabel }))).toEqual([true, false, true, true]);
  });

  it('inserts a day divider when the date changes and starts a new group', () => {
    const msgs = [makeText({ senderId: 'a', timestamp: t0 }), makeText({ senderId: 'a', timestamp: t0 + 86_400_000 })];
    const rows = buildRows(msgs, { dayLabel });
    expect(rows.map((r) => r.type)).toEqual(['day', 'message', 'day', 'message']);
    expect(headers(rows)).toEqual([true, true]);
  });

  it('shows a header on replies and after action logs; action logs never get headers', () => {
    const log: Message = { ...makeText({ senderId: 'a', timestamp: t0 + 1000 }), kind: 'actionLog', text: 'x changed the name' } as Message;
    const msgs = [
      makeText({ senderId: 'a', timestamp: t0 }),
      log,
      makeText({ senderId: 'a', timestamp: t0 + 2000 }),
      makeText({ senderId: 'a', timestamp: t0 + 3000, replyTo: { messageId: 'x', senderId: 'b', preview: 'p' } })
    ];
    expect(headers(buildRows(msgs, { dayLabel }))).toEqual([true, false, true, true]);
  });

  it('inserts the unread marker before the first unread message', () => {
    const a = makeText({ senderId: 'a', timestamp: t0 });
    const b = makeText({ senderId: 'a', timestamp: t0 + 1000 });
    const rows = buildRows([a, b], { dayLabel, firstUnreadId: b.id });
    expect(rows.map((r) => r.type)).toEqual(['day', 'message', 'unread', 'message']);
    expect(headers(rows)).toEqual([true, true]);
  });

  it('keys rows by clientTempId when present so optimistic rows keep identity', () => {
    const m = makeText({ timestamp: t0, clientTempId: 'temp-1' });
    const row = buildRows([m], { dayLabel })[1]!;
    expect(row.key).toBe('temp-1');
  });
});
