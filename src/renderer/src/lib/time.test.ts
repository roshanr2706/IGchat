import { describe, expect, it } from 'vitest';
import { formatDayLabel, formatHeaderTimestamp, formatRelativeShort, formatTime, sameDay } from './time';

const now = new Date(2026, 9, 8, 18, 0).getTime();
const at = (d: number, h: number, m: number): number => new Date(2026, 9, d, h, m).getTime();

describe('time formatting', () => {
  it('formats clock time', () => {
    expect(formatTime(at(8, 16, 12))).toMatch(/^4:12\sPM$/);
  });

  it('labels days', () => {
    expect(formatDayLabel(at(8, 9, 0), now)).toBe('Today');
    expect(formatDayLabel(at(7, 23, 59), now)).toBe('Yesterday');
    expect(formatDayLabel(at(1, 12, 0), now)).toBe('October 1, 2026');
  });

  it('formats message header timestamps', () => {
    expect(formatHeaderTimestamp(at(8, 16, 12), now)).toMatch(/^Today at 4:12\sPM$/);
    expect(formatHeaderTimestamp(at(7, 9, 5), now)).toMatch(/^Yesterday at 9:05\sAM$/);
    expect(formatHeaderTimestamp(at(1, 9, 5), now)).toMatch(/^10\/01\/2026 9:05\sAM$/);
  });

  it('formats relative short times for the sidebar', () => {
    expect(formatRelativeShort(now - 20_000, now)).toBe('now');
    expect(formatRelativeShort(now - 5 * 60_000, now)).toBe('5m');
    expect(formatRelativeShort(now - 3 * 3_600_000, now)).toBe('3h');
    expect(formatRelativeShort(now - 2 * 86_400_000, now)).toBe('2d');
    expect(formatRelativeShort(at(1, 12, 0) - 30 * 86_400_000, now)).toBe('Sep 1');
  });

  it('compares calendar days', () => {
    expect(sameDay(at(8, 0, 1), at(8, 23, 59))).toBe(true);
    expect(sameDay(at(7, 23, 59), at(8, 0, 1))).toBe(false);
  });
});
