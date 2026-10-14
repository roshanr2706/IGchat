import type { Reaction } from './types';

export function withoutReaction(reactions: Reaction[], userId: string): Reaction[] {
  return reactions
    .map((r) => ({ emoji: r.emoji, userIds: r.userIds.filter((id) => id !== userId) }))
    .filter((r) => r.userIds.length > 0);
}

/** Instagram allows one reaction per user per message, so reacting replaces any previous reaction. */
export function withReaction(reactions: Reaction[], userId: string, emoji: string): Reaction[] {
  const rest = withoutReaction(reactions, userId);
  const existing = rest.find((r) => r.emoji === emoji);
  if (existing) return rest.map((r) => (r === existing ? { emoji, userIds: [...r.userIds, userId] } : r));
  return [...rest, { emoji, userIds: [userId] }];
}
