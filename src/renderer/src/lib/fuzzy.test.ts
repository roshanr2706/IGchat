import { describe, expect, it } from 'vitest';
import { makeThread, makeUser } from '../../../shared/test/factories';
import { fuzzyScore, searchThreads } from './fuzzy';

describe('fuzzyScore', () => {
  it('returns null when characters are missing', () => {
    expect(fuzzyScore('xyz', 'alex_r')).toBeNull();
  });

  it('matches subsequences', () => {
    expect(fuzzyScore('alx', 'alex_r')).not.toBeNull();
  });

  it('ranks prefix > substring > scattered', () => {
    const prefix = fuzzyScore('ale', 'alex')!;
    const substring = fuzzyScore('lex', 'alex')!;
    const scattered = fuzzyScore('ax', 'alex')!;
    expect(prefix).toBeGreaterThan(substring);
    expect(substring).toBeGreaterThan(scattered);
  });

  it('is case-insensitive and treats empty query as a match', () => {
    expect(fuzzyScore('ALEX', 'alex')).not.toBeNull();
    expect(fuzzyScore('', 'anything')).toBe(0);
  });
});

describe('searchThreads', () => {
  const alex = makeUser({ username: 'alex_r', fullName: 'Alex Rivera' });
  const sam = makeUser({ username: 'sam.kim', fullName: 'Sam Kim' });
  const dmAlex = makeThread({ title: 'Alex Rivera', participants: [alex], lastActivityAt: 10 });
  const dmSam = makeThread({ title: 'Sam Kim', participants: [sam], lastActivityAt: 30 });
  const group = makeThread({ title: 'weekend plans', participants: [alex, sam], lastActivityAt: 20 });
  const all = [dmAlex, dmSam, group];

  it('returns recent threads for an empty query', () => {
    expect(searchThreads(all, '').map((t) => t.title)).toEqual(['Sam Kim', 'weekend plans', 'Alex Rivera']);
  });

  it('matches titles, usernames and member names', () => {
    expect(searchThreads(all, 'sam.k').map((t) => t.title)).toEqual(['Sam Kim', 'weekend plans']);
    expect(searchThreads(all, 'weekend').map((t) => t.title)).toEqual(['weekend plans']);
  });

  it('respects the limit', () => {
    expect(searchThreads(all, '', 1)).toHaveLength(1);
  });

  it('is fast enough for 1000 threads', () => {
    const many = Array.from({ length: 1000 }, (_, i) => makeThread({ title: `Person ${i}`, participants: [makeUser({ username: `person_${i}` })] }));
    const start = performance.now();
    for (const q of ['p', 'pe', 'per', 'pers', 'perso', 'person', 'person_', 'person_9', 'person_99', 'person_999']) searchThreads(many, q);
    expect((performance.now() - start) / 10).toBeLessThan(16);
  });
});
