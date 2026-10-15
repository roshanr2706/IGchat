import { describe, expect, it } from 'vitest';
import { EDIT_WINDOW_MS } from '../../../shared/types';
import { makeImage, makeText } from '../../../shared/test/factories';
import { canEdit, canUnsend, lastEditable } from './editWindow';

const now = 1_800_000_000_000;

describe('edit/unsend rules', () => {
  it('allows editing own sent text within the window', () => {
    expect(canEdit(makeText({ senderId: 'me', timestamp: now - 60_000 }), 'me', now)).toBe(true);
    expect(canEdit(makeText({ senderId: 'me', timestamp: now - EDIT_WINDOW_MS - 1 }), 'me', now)).toBe(false);
    expect(canEdit(makeText({ senderId: 'other', timestamp: now }), 'me', now)).toBe(false);
    expect(canEdit(makeText({ senderId: 'me', timestamp: now, status: 'pending' }), 'me', now)).toBe(false);
    expect(canEdit(makeImage({ senderId: 'me', timestamp: now }), 'me', now)).toBe(false);
  });

  it('allows unsending any own sent message', () => {
    expect(canUnsend(makeImage({ senderId: 'me' }), 'me')).toBe(true);
    expect(canUnsend(makeText({ senderId: 'other' }), 'me')).toBe(false);
    expect(canUnsend(makeText({ senderId: 'me', status: 'failed' }), 'me')).toBe(false);
  });

  it('finds the last own message only if it is editable', () => {
    const mine = makeText({ senderId: 'me', timestamp: now - 1000 });
    const theirs = makeText({ senderId: 'other', timestamp: now });
    expect(lastEditable([mine, theirs], 'me', now)).toBe(mine);
    const myImage = makeImage({ senderId: 'me', timestamp: now });
    expect(lastEditable([mine, myImage], 'me', now)).toBeNull();
  });
});
