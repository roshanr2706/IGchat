import { describe, expect, it } from 'vitest';
import { withReaction, withoutReaction } from './reactions';

describe('reactions', () => {
  it('adds a new emoji', () => {
    expect(withReaction([], 'me', '❤️')).toEqual([{ emoji: '❤️', userIds: ['me'] }]);
  });

  it('joins an existing emoji', () => {
    expect(withReaction([{ emoji: '❤️', userIds: ['a'] }], 'me', '❤️')).toEqual([{ emoji: '❤️', userIds: ['a', 'me'] }]);
  });

  it('moves the user from their previous emoji (one reaction per user)', () => {
    const r = withReaction([{ emoji: '😂', userIds: ['me'] }, { emoji: '❤️', userIds: ['a'] }], 'me', '❤️');
    expect(r).toEqual([{ emoji: '❤️', userIds: ['a', 'me'] }]);
  });

  it('removes the user and drops empty reactions', () => {
    const r = withoutReaction([{ emoji: '😂', userIds: ['me'] }, { emoji: '❤️', userIds: ['a', 'me'] }], 'me');
    expect(r).toEqual([{ emoji: '❤️', userIds: ['a'] }]);
  });

  it('does not mutate the input', () => {
    const input = [{ emoji: '😂', userIds: ['me'] }];
    withoutReaction(input, 'me');
    expect(input).toEqual([{ emoji: '😂', userIds: ['me'] }]);
  });
});
