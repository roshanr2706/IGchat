import { describe, expect, it } from 'vitest';
import { messagePreview } from './preview';

describe('messagePreview', () => {
  it('describes every message kind', () => {
    expect(messagePreview({ kind: 'text', text: 'hi' })).toBe('hi');
    expect(messagePreview({ kind: 'image', url: 'x', width: 1, height: 1 })).toBe('Sent a photo');
    expect(messagePreview({ kind: 'video', url: 'x', thumbUrl: 'y', width: 1, height: 1 })).toBe('Sent a video');
    expect(messagePreview({ kind: 'sharedPost', postUrl: 'x', thumbUrl: 'y' })).toBe('Shared a post');
    expect(messagePreview({ kind: 'reel', postUrl: 'x', thumbUrl: 'y' })).toBe('Shared a reel');
    expect(messagePreview({ kind: 'link', text: 'look', url: 'https://a.b' })).toBe('look');
    expect(messagePreview({ kind: 'link', text: '', url: 'https://a.b' })).toBe('https://a.b');
    expect(messagePreview({ kind: 'like' })).toBe('❤️');
    expect(messagePreview({ kind: 'actionLog', text: 'Sam left' })).toBe('Sam left');
    expect(messagePreview({ kind: 'unsupported', rawType: 'voice_media' })).toBe('Sent a message');
  });
});
