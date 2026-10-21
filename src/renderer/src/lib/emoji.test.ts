import { beforeAll, describe, expect, it } from 'vitest';
import { EMOJI_GROUPS, emojiIndex, findEmoji, loadEmoji, parseReactCommand, shortcodeAt, type EmojiIndex } from './emoji';

let index: EmojiIndex;
beforeAll(async () => {
  index = await loadEmoji();
});

describe('emoji search', () => {
  it('fills :wilt and :gri with the closest emoji', () => {
    expect(findEmoji(index, 'wilt')[0]?.emoji).toBe('🥀');
    expect(findEmoji(index, 'gri')[0]?.emoji).toBe('😁');
  });

  it('ranks an exact shortcode first, then shorter prefix matches', () => {
    expect(findEmoji(index, 'heart')[0]?.emoji).toBe('❤️');
    const codes = findEmoji(index, 'gri', 5).map((e) => e.codes[0]);
    expect(codes[0]).toBe('grin');
    expect(codes).toContain('grinning');
  });

  it('matches words inside shortcodes and names, and tolerates a leading colon and case', () => {
    expect(findEmoji(index, 'flower').map((e) => e.emoji)).toContain('🥀');
    expect(findEmoji(index, ':GRIN')[0]?.emoji).toBe('😁');
  });

  it('returns nothing for empty or junk queries and caps the count', () => {
    expect(findEmoji(index, '')).toEqual([]);
    expect(findEmoji(index, '%%%')).toEqual([]);
    expect(findEmoji(index, 'a', 8)).toHaveLength(8);
  });

  it('skips skin-tone components and keeps picker groups in order', () => {
    expect(index.all.some((e) => e.name.includes('skin tone') && !e.name.includes(':'))).toBe(false);
    expect(EMOJI_GROUPS.map((g) => g.id)[0]).toBe(0);
    expect(index.byGroup.get(0)?.length).toBeGreaterThan(50);
  });

  it('looks up exact shortcodes', () => {
    expect(index.byCode.get('wilted_flower')).toBe('🥀');
    expect(emojiIndex()).toBe(index);
  });
});

describe('composer shortcodes', () => {
  it('finds the :token being typed at the caret', () => {
    expect(shortcodeAt('hi :wil', 7)).toEqual({ start: 3, query: 'wil' });
    expect(shortcodeAt(':gr', 3)).toEqual({ start: 0, query: 'gr' });
    expect(shortcodeAt('+:fire', 6)).toEqual({ start: 1, query: 'fire' });
  });

  it('needs two characters, a word boundary, and no closing colon', () => {
    expect(shortcodeAt('hi :w', 5)).toBeNull();
    expect(shortcodeAt('http://x', 8)).toBeNull();
    expect(shortcodeAt('a:bc', 4)).toBeNull();
    expect(shortcodeAt('hi :wilt: ok', 12)).toBeNull();
    expect(shortcodeAt('hi :wi lt', 9)).toBeNull();
  });
});

describe('+:emoji reactions', () => {
  it('turns "+emoji" and "+:code:" into a reaction', () => {
    expect(parseReactCommand('+🥀', index)).toBe('🥀');
    expect(parseReactCommand('+:wilted_flower:', index)).toBe('🥀');
    expect(parseReactCommand(' +❤️ ', index)).toBe('❤️');
  });

  it('leaves ordinary messages alone', () => {
    expect(parseReactCommand('+1 for this', index)).toBeNull();
    expect(parseReactCommand('+🥀 nice', index)).toBeNull();
    expect(parseReactCommand('+:not_a_real_code:', index)).toBeNull();
    expect(parseReactCommand('hello', index)).toBeNull();
  });
});
