import { describe, expect, it } from 'vitest';
import threadList from './__fixtures__/threadList.json';
import messageList from './__fixtures__/messageList.json';
import { normalizeMessage, normalizeThread, normalizeUser, type MessageContext } from './normalize';

const threadNodes = threadList.data.fetch__SlideMailbox.threads_by_folder.edges.map((e) => e.node.as_ig_direct_thread);
const messageNodes = messageList.data.fetch__SlideThread.as_ig_direct_thread.slide_messages.edges.map((e) => e.node);
const fbidToIgid: Record<string, string> = { '900000000000001': '9000000001', '900000000000002': '9000000002' };
const ctx: MessageContext = { threadId: '1000000000000001', viewerIgid: '9000000001', viewerFbid: '900000000000001', igidForFbid: (f) => fbidToIgid[f] };
const byId = (id: string) => normalizeMessage(messageNodes.find((n) => n.message_id === id), ctx);

describe('normalizeUser', () => {
  it('maps fields and rejects junk', () => {
    expect(normalizeUser(threadNodes[0]!.users[0])).toEqual({
      user: { id: '9000000002', username: 'alex_r', fullName: 'Alex Rivera', avatarUrl: expect.stringMatching(/^igmedia:\/\/m\//), verified: true },
      fbid: '900000000000002'
    });
    expect(normalizeUser(null)).toBeNull();
    expect(normalizeUser({ username: 'no-id' })).toBeNull();
  });
});

describe('normalizeThread', () => {
  it('maps a DM thread with both ids, preview and read state', () => {
    const n = normalizeThread(threadNodes[0], null)!;
    expect(n.fbid).toBe('1000000000000001');
    expect(n.threadKey).toBe('340282366841710300949128000000000000001');
    expect(n.viewerFbid).toBe('900000000000001');
    expect(n.thread).toMatchObject({
      id: '1000000000000001',
      title: 'Alex Rivera',
      isGroup: false,
      lastActivityAt: 1792100000000,
      lastMessagePreview: 'see you soon',
      unread: true,
      muted: false
    });
    expect(n.thread.participants.map((p) => p.id)).toEqual(['9000000002']);
  });

  it('maps a group thread with title, admins, own-message preview and image', () => {
    const n = normalizeThread(threadNodes[1], '9000000001')!;
    expect(n.thread).toMatchObject({ title: 'weekend plans', isGroup: true, muted: true, unread: false, adminIds: ['9000000001'], lastMessagePreview: 'You: on my way' });
    expect(n.thread.avatarUrls).toHaveLength(1);
    expect(n.thread.participants.find((p) => p.id === '9000000003')!.avatarUrl).toBe('');
  });

  it('returns null without an id', () => {
    expect(normalizeThread({ thread_title: 'x' }, null)).toBeNull();
  });
});

describe('normalizeMessage', () => {
  it('maps text with grouped reactions, edits, otid and item id', () => {
    const n = byId('mid.$m1')!;
    expect(n.itemId).toBe('item-1');
    expect(n.otid).toBe('7300000000000000001');
    expect(n.threadFbid).toBe('1000000000000001');
    expect(n.message).toMatchObject({ id: 'mid.$m1', threadId: '1000000000000001', senderId: '9000000001', timestamp: 1792090000000, kind: 'text', text: 'hey!', status: 'sent', editedAt: 1792090060000 });
    expect(n.message.reactions).toEqual([{ emoji: '❤️', userIds: ['9000000002', '9000000001'] }]);
  });

  it('maps replies', () => {
    expect(byId('mid.$m2')!.message.replyTo).toEqual({ messageId: 'mid.$m1', senderId: '9000000001', preview: 'hey!' });
  });

  it('maps images, videos, reels, posts and links', () => {
    expect(byId('mid.$m3')!.message).toMatchObject({ kind: 'image', width: 1080, height: 1350, url: expect.stringMatching(/^igmedia:/) });
    expect(byId('mid.$m10')!.message).toMatchObject({ kind: 'video', width: 720, height: 1280, thumbUrl: expect.stringMatching(/^igmedia:/) });
    expect(byId('mid.$m4')!.message).toMatchObject({ kind: 'reel', postUrl: 'https://www.instagram.com/reel/ABC123/', author: 'natgeo', caption: 'look at this' });
    expect(byId('mid.$m5')!.message).toMatchObject({ kind: 'sharedPost', postUrl: 'https://www.instagram.com/p/XYZ789/', author: 'nasa', caption: 'a galaxy' });
    expect(byId('mid.$m6')!.message).toMatchObject({ kind: 'link', url: 'https://example.com/article', title: 'An article', text: 'https://example.com/article' });
  });

  it('hides reaction logs and unsent messages, keeps other admin text, stubs unknown and view-once', () => {
    expect(byId('mid.$m7')).toBeNull();
    expect(byId('mid.$m12')).toBeNull();
    expect(byId('mid.$m9')!.message).toMatchObject({ kind: 'actionLog', text: 'Alex created the group' });
    expect(byId('mid.$m8')!.message).toMatchObject({ kind: 'unsupported', rawType: 'view_once' });
    expect(byId('mid.$m11')!.message).toMatchObject({ kind: 'unsupported', rawType: 'SOMETHING_NEW' });
  });

  it('tolerates junk input', () => {
    expect(normalizeMessage(undefined, ctx)).toBeNull();
    expect(normalizeMessage({ content_type: 'TEXT' }, ctx)).toBeNull();
    expect(normalizeMessage({ message_id: 'x', content_type: 'TEXT', content: {} }, ctx)).toBeNull();
  });
});
