import { describe, expect, it } from 'vitest';
import { createSeed, ME, mulberry32 } from './seed';

const NOW = new Date(2026, 9, 8, 18, 0).getTime();

describe('createSeed', () => {
  it('is deterministic for the same seed and time', () => {
    const a = createSeed(NOW);
    const b = createSeed(NOW);
    expect(JSON.stringify(a.threads)).toBe(JSON.stringify(b.threads));
    expect(JSON.stringify([...a.messages])).toBe(JSON.stringify([...b.messages]));
  });

  it('creates 24 DMs and 6 groups with unique ids', () => {
    const { threads } = createSeed(NOW);
    expect(threads).toHaveLength(30);
    expect(threads.filter((t) => t.isGroup)).toHaveLength(6);
    expect(new Set(threads.map((t) => t.id)).size).toBe(30);
  });

  it('gives the three most recent threads 120 messages for paging', () => {
    const { threads, messages } = createSeed(NOW);
    for (const t of threads.slice(0, 3)) expect(messages.get(t.id)).toHaveLength(120);
  });

  it('keeps messages in ascending time order ending at lastActivityAt', () => {
    const { threads, messages } = createSeed(NOW);
    for (const t of threads) {
      const list = messages.get(t.id)!;
      for (let i = 1; i < list.length; i++) expect(list[i]!.timestamp).toBeGreaterThanOrEqual(list[i - 1]!.timestamp);
      expect(list[list.length - 1]!.timestamp).toBe(t.lastActivityAt);
      expect(list.every((m) => m.timestamp <= NOW)).toBe(true);
    }
  });

  it('only references earlier messages in replies and real senders everywhere', () => {
    const { threads, messages } = createSeed(NOW);
    for (const t of threads) {
      const list = messages.get(t.id)!;
      const members = new Set([ME.id, ...t.participants.map((p) => p.id)]);
      list.forEach((m, i) => {
        expect(members.has(m.senderId)).toBe(true);
        if (m.replyTo) expect(list.slice(0, i).some((x) => x.id === m.replyTo!.messageId)).toBe(true);
      });
    }
  });

  it('mulberry32 produces numbers in [0, 1)', () => {
    const r = mulberry32(1);
    for (let i = 0; i < 100; i++) {
      const v = r();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});
